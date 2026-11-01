import { unlink } from 'node:fs/promises';
import { join } from 'node:path';
import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { checkAchievements } from '../achievements.js';
import type { Ctx, DB } from '../db.js';
import { HttpError, idParam, limit, requireUser } from '../http.js';
import { storeImage, type StoredImage } from '../images.js';

export const REACTION_KINDS = ['love', 'fire', 'cute', 'lol', 'king', 'fish'] as const;

export interface PostRow {
  id: number;
  user_id: number;
  cat_id: number | null;
  title: string;
  description: string;
  filename: string;
  thumb: string;
  width: number;
  height: number;
  color: string;
  elo: number;
  wins: number;
  losses: number;
  created_at: number;
  username: string;
  display_name: string;
  avatar_emoji: string;
  cat_name: string | null;
  cat_emoji: string | null;
}

export const POST_SELECT = `SELECT p.*, u.username, u.display_name, u.avatar_emoji, c.name AS cat_name, c.emoji AS cat_emoji
  FROM posts p JOIN users u ON u.id = p.user_id LEFT JOIN cats c ON c.id = p.cat_id`;

/** Adds reaction counts, tags and the viewer's own state to post rows without N+1 queries. */
export function hydratePosts(db: DB, rows: PostRow[], viewerId?: number) {
  if (!rows.length) return [];
  const ids = rows.map((r) => r.id);
  const marks = ids.map(() => '?').join(',');

  const counts = new Map<number, Record<string, number>>();
  for (const r of db
    .prepare(`SELECT post_id, kind, COUNT(*) AS n FROM reactions WHERE post_id IN (${marks}) GROUP BY post_id, kind`)
    .all(...ids) as { post_id: number; kind: string; n: number }[]) {
    counts.set(r.post_id, { ...counts.get(r.post_id), [r.kind]: r.n });
  }
  const tags = new Map<number, string[]>();
  for (const r of db.prepare(`SELECT post_id, tag FROM post_tags WHERE post_id IN (${marks})`).all(...ids) as {
    post_id: number;
    tag: string;
  }[]) {
    tags.set(r.post_id, [...(tags.get(r.post_id) ?? []), r.tag]);
  }
  const mine = new Map<number, string>();
  if (viewerId) {
    for (const r of db
      .prepare(`SELECT post_id, kind FROM reactions WHERE user_id = ? AND post_id IN (${marks})`)
      .all(viewerId, ...ids) as { post_id: number; kind: string }[]) {
      mine.set(r.post_id, r.kind);
    }
  }

  return rows.map((p) => ({
    id: p.id,
    title: p.title,
    description: p.description,
    imageUrl: `/uploads/${p.filename}`,
    thumbUrl: `/uploads/${p.thumb}`,
    width: p.width,
    height: p.height,
    color: p.color,
    elo: p.elo,
    wins: p.wins,
    losses: p.losses,
    createdAt: p.created_at,
    author: { id: p.user_id, username: p.username, displayName: p.display_name, avatarEmoji: p.avatar_emoji },
    cat: p.cat_id ? { id: p.cat_id, name: p.cat_name, emoji: p.cat_emoji } : null,
    tags: tags.get(p.id) ?? [],
    reactions: counts.get(p.id) ?? {},
    myReaction: mine.get(p.id) ?? null,
  }));
}

export function insertPost(
  db: DB,
  userId: number,
  meta: { title: string; description: string; catId: number | null; tags: string[] },
  image: StoredImage,
  createdAt = Date.now(),
): number {
  return db.transaction(() => {
    const info = db
      .prepare(
        `INSERT INTO posts (user_id, cat_id, title, description, filename, thumb, width, height, color, created_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      )
      .run(userId, meta.catId, meta.title, meta.description, image.filename, image.thumb, image.width, image.height, image.color, createdAt);
    const id = Number(info.lastInsertRowid);
    const addTag = db.prepare('INSERT OR IGNORE INTO post_tags (post_id, tag) VALUES (?, ?)');
    for (const tag of meta.tags) addTag.run(id, tag);
    return id;
  })();
}

export function notify(db: DB, userId: number, actorId: number, type: string, postId: number | null) {
  if (userId === actorId) return;
  db.prepare('INSERT INTO notifications (user_id, actor_id, type, post_id, created_at) VALUES (?, ?, ?, ?, ?)').run(
    userId,
    actorId,
    type,
    postId,
    Date.now(),
  );
}

const postMeta = z.object({
  title: z.string().trim().min(1, 'Дай котику заголовок').max(80),
  description: z.string().trim().max(500).default(''),
  catId: z.number().int().positive().nullable().default(null),
  tags: z
    .array(
      z
        .string()
        .trim()
        .toLowerCase()
        .transform((t) => t.replace(/^#/, ''))
        .pipe(z.string().regex(/^[\p{L}\p{N}_-]{1,24}$/u, 'Тег: буквы и цифры, до 24 символов')),
    )
    .max(8, 'Не больше 8 тегов')
    .default([]),
});

const feedQuery = z.object({
  sort: z.enum(['new', 'hot', 'following']).default('new'),
  tag: z.string().max(24).optional(),
  q: z.string().trim().max(60).optional(),
  username: z.string().max(24).optional(),
  catId: z.coerce.number().int().positive().optional(),
  offset: z.coerce.number().int().min(0).max(100_000).default(0),
  limit: z.coerce.number().int().min(1).max(50).default(24),
});

const reactionBody = z.object({ kind: z.enum(REACTION_KINDS) });
const commentBody = z.object({ body: z.string().trim().min(1, 'Напиши что-нибудь').max(500, 'Слишком длинно') });

function getPost(db: DB, id: number): PostRow {
  const row = db.prepare(`${POST_SELECT} WHERE p.id = ?`).get(id) as PostRow | undefined;
  if (!row) throw new HttpError(404, 'Котик убежал: такого поста нет');
  return row;
}

export function postRoutes(app: FastifyInstance, ctx: Ctx) {
  const { db } = ctx;

  app.get('/posts', async (req) => {
    const q = feedQuery.parse(req.query);
    const where: string[] = [];
    const args: unknown[] = [];
    if (q.tag) {
      where.push('EXISTS (SELECT 1 FROM post_tags t WHERE t.post_id = p.id AND t.tag = ?)');
      args.push(q.tag.toLowerCase());
    }
    if (q.q) {
      const like = `%${q.q.replace(/[\\%_]/g, '\\$&')}%`;
      where.push(`(p.title LIKE ? ESCAPE '\\' OR p.description LIKE ? ESCAPE '\\' OR c.name LIKE ? ESCAPE '\\' OR u.username LIKE ? ESCAPE '\\')`);
      args.push(like, like, like, like);
    }
    if (q.username) {
      where.push('u.username = ?');
      args.push(q.username);
    }
    if (q.catId) {
      where.push('p.cat_id = ?');
      args.push(q.catId);
    }
    if (q.sort === 'following') {
      where.push('p.user_id IN (SELECT followee_id FROM follows WHERE follower_id = ?)');
      args.push(requireUser(req).id);
    }
    const weekAgo = Date.now() - 7 * 86_400_000;
    const order =
      q.sort === 'hot'
        ? `((SELECT COUNT(*) FROM reactions r WHERE r.post_id = p.id AND r.created_at > ${weekAgo})
            + 3 * (SELECT COUNT(*) FROM swipes s WHERE s.post_id = p.id AND s.verdict = 'supercat' AND s.created_at > ${weekAgo})) DESC, p.id DESC`
        : 'p.id DESC';
    const rows = db
      .prepare(`${POST_SELECT} ${where.length ? `WHERE ${where.join(' AND ')}` : ''} ORDER BY ${order} LIMIT ? OFFSET ?`)
      .all(...args, q.limit + 1, q.offset) as PostRow[];
    return {
      posts: hydratePosts(db, rows.slice(0, q.limit), req.user?.id),
      nextOffset: rows.length > q.limit ? q.offset + q.limit : null,
    };
  });

  app.get('/posts/random', async () => {
    const row = db.prepare('SELECT id FROM posts ORDER BY RANDOM() LIMIT 1').get() as { id: number } | undefined;
    if (!row) throw new HttpError(404, 'Котиков пока нет');
    return row;
  });

  app.get('/tags/trending', async () => {
    const tags = db
      .prepare('SELECT tag, COUNT(*) AS count FROM post_tags GROUP BY tag ORDER BY count DESC, tag LIMIT 12')
      .all();
    return { tags };
  });

  app.get('/posts/:id', async (req) => {
    const [post] = hydratePosts(db, [getPost(db, idParam(req))], req.user?.id);
    return { post };
  });

  app.post('/posts', limit(20), async (req, reply) => {
    const user = requireUser(req);
    const file = await req.file({ limits: { fileSize: 10 * 1024 * 1024, files: 1, fields: 2, fieldSize: 4096 } });
    if (!file) throw new HttpError(400, 'Прикрепи фото котика');
    // The meta field has to come before the file in the form, or it isn't parsed yet.
    const raw = file.fields.meta;
    const metaValue = raw && !Array.isArray(raw) && raw.type === 'field' ? String(raw.value) : '{}';
    let json: unknown;
    try {
      json = JSON.parse(metaValue);
    } catch {
      throw new HttpError(400, 'Неверные данные поста');
    }
    const meta = postMeta.parse(json);
    if (meta.catId) {
      const own = db.prepare('SELECT 1 FROM cats WHERE id = ? AND owner_id = ?').get(meta.catId, user.id);
      if (!own) throw new HttpError(403, 'Это не твой котик');
    }
    const image = await storeImage(await file.toBuffer(), ctx.uploadDir);
    const id = insertPost(db, user.id, meta, image);
    checkAchievements(db, user.id);
    const [post] = hydratePosts(db, [getPost(db, id)], user.id);
    return reply.code(201).send({ post });
  });

  app.delete('/posts/:id', async (req) => {
    const user = requireUser(req);
    const post = getPost(db, idParam(req));
    if (post.user_id !== user.id) throw new HttpError(403, 'Можно удалять только своих котиков');
    db.prepare('DELETE FROM posts WHERE id = ?').run(post.id);
    await Promise.allSettled([post.filename, post.thumb].map((f) => unlink(join(ctx.uploadDir, f))));
    return { ok: true };
  });

  app.put('/posts/:id/reaction', limit(120), async (req) => {
    const user = requireUser(req);
    const post = getPost(db, idParam(req));
    const { kind } = reactionBody.parse(req.body);
    const existed = db.prepare('SELECT 1 FROM reactions WHERE post_id = ? AND user_id = ?').get(post.id, user.id);
    db.prepare(
      `INSERT INTO reactions (post_id, user_id, kind, created_at) VALUES (?, ?, ?, ?)
       ON CONFLICT (post_id, user_id) DO UPDATE SET kind = excluded.kind`,
    ).run(post.id, user.id, kind, Date.now());
    if (!existed) {
      // Un-reacting and reacting again shouldn't spam the author.
      const notified = db
        .prepare(`SELECT 1 FROM notifications WHERE actor_id = ? AND post_id = ? AND type = 'reaction'`)
        .get(user.id, post.id);
      if (!notified) notify(db, post.user_id, user.id, 'reaction', post.id);
      checkAchievements(db, post.user_id);
    }
    const [updated] = hydratePosts(db, [getPost(db, post.id)], user.id);
    return { post: updated };
  });

  app.delete('/posts/:id/reaction', limit(120), async (req) => {
    const user = requireUser(req);
    const post = getPost(db, idParam(req));
    db.prepare('DELETE FROM reactions WHERE post_id = ? AND user_id = ?').run(post.id, user.id);
    const [updated] = hydratePosts(db, [getPost(db, post.id)], user.id);
    return { post: updated };
  });

  app.get('/posts/:id/comments', async (req) => {
    const post = getPost(db, idParam(req));
    const rows = db
      .prepare(
        `SELECT c.id, c.body, c.created_at AS createdAt, u.id AS userId, u.username, u.display_name AS displayName, u.avatar_emoji AS avatarEmoji
         FROM comments c JOIN users u ON u.id = c.user_id WHERE c.post_id = ? ORDER BY c.id LIMIT 200`,
      )
      .all(post.id);
    return { comments: rows };
  });

  app.post('/posts/:id/comments', limit(20), async (req, reply) => {
    const user = requireUser(req);
    const post = getPost(db, idParam(req));
    const { body } = commentBody.parse(req.body);
    const info = db
      .prepare('INSERT INTO comments (post_id, user_id, body, created_at) VALUES (?, ?, ?, ?)')
      .run(post.id, user.id, body, Date.now());
    notify(db, post.user_id, user.id, 'comment', post.id);
    return reply.code(201).send({ id: Number(info.lastInsertRowid) });
  });

  app.delete('/comments/:id', async (req) => {
    const user = requireUser(req);
    const row = db
      .prepare('SELECT c.user_id, p.user_id AS owner_id FROM comments c JOIN posts p ON p.id = c.post_id WHERE c.id = ?')
      .get(idParam(req)) as { user_id: number; owner_id: number } | undefined;
    if (!row) throw new HttpError(404, 'Комментарий не найден');
    // The post's author can also clean up their own comment section.
    if (row.user_id !== user.id && row.owner_id !== user.id) throw new HttpError(403, 'Нельзя удалить чужой комментарий');
    db.prepare('DELETE FROM comments WHERE id = ?').run(idParam(req));
    return { ok: true };
  });
}
