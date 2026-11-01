import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { ACHIEVEMENTS, checkAchievements, grantAchievement, userStats } from '../achievements.js';
import type { Ctx } from '../db.js';
import { HttpError, idParam, limit, requireUser } from '../http.js';
import { hydratePosts, notify, POST_SELECT, type PostRow } from './posts.js';

const profileBody = z.object({
  displayName: z.string().trim().min(1).max(40).optional(),
  bio: z.string().trim().max(200).optional(),
  avatarEmoji: z.string().min(1).max(8).optional(),
});
const collectionBody = z.object({
  name: z.string().trim().min(1, 'Назови коллекцию').max(50),
  isPrivate: z.boolean().default(false),
});
const collectionPostBody = z.object({ postId: z.number().int().positive() });

interface CollectionRow {
  id: number;
  user_id: number;
  name: string;
  is_private: number;
}

export function socialRoutes(app: FastifyInstance, ctx: Ctx) {
  const { db } = ctx;

  function findUser(username: unknown) {
    const row = db
      .prepare('SELECT id, username, display_name, bio, avatar_emoji, streak, created_at FROM users WHERE username = ?')
      .get(String(username)) as
      | { id: number; username: string; display_name: string; bio: string; avatar_emoji: string; streak: number; created_at: number }
      | undefined;
    if (!row) throw new HttpError(404, 'Такого пользователя нет');
    return row;
  }

  /** Private collections answer 404 to strangers, so their existence doesn't leak. */
  function visibleCollection(id: number, viewerId?: number): CollectionRow {
    const row = db.prepare('SELECT * FROM collections WHERE id = ?').get(id) as CollectionRow | undefined;
    if (!row || (row.is_private && row.user_id !== viewerId)) throw new HttpError(404, 'Коллекция не найдена');
    return row;
  }

  function ownCollection(id: number, userId: number): CollectionRow {
    const row = visibleCollection(id, userId);
    if (row.user_id !== userId) throw new HttpError(403, 'Это чужая коллекция');
    return row;
  }

  function listCollections(ownerId: number, viewerId?: number) {
    return db
      .prepare(
        `SELECT c.id, c.name, c.is_private AS isPrivate,
           (SELECT COUNT(*) FROM collection_posts cp WHERE cp.collection_id = c.id) AS count,
           (SELECT p.thumb FROM collection_posts cp JOIN posts p ON p.id = cp.post_id
             WHERE cp.collection_id = c.id ORDER BY cp.created_at DESC LIMIT 1) AS cover
         FROM collections c WHERE c.user_id = ? AND (c.is_private = 0 OR c.user_id = ?) ORDER BY c.id DESC`,
      )
      .all(ownerId, viewerId ?? -1);
  }

  app.get('/users/:username', async (req) => {
    const user = findUser((req.params as { username: string }).username);
    const unlocked = db.prepare('SELECT code FROM achievements WHERE user_id = ?').all(user.id) as { code: string }[];
    const codes = new Set(unlocked.map((a) => a.code));
    const isFollowing = req.user
      ? Boolean(db.prepare('SELECT 1 FROM follows WHERE follower_id = ? AND followee_id = ?').get(req.user.id, user.id))
      : false;
    return {
      user: {
        id: user.id,
        username: user.username,
        displayName: user.display_name,
        bio: user.bio,
        avatarEmoji: user.avatar_emoji,
        streak: user.streak,
        createdAt: user.created_at,
        isFollowing,
        stats: userStats(db, user.id),
        achievements: ACHIEVEMENTS.map((a) => ({ ...a, unlocked: codes.has(a.code) })),
        cats: db.prepare('SELECT id, name, emoji, breed FROM cats WHERE owner_id = ? ORDER BY id').all(user.id),
        collections: listCollections(user.id, req.user?.id),
      },
    };
  });

  app.patch('/me', async (req) => {
    const user = requireUser(req);
    const body = profileBody.parse(req.body);
    db.prepare(
      `UPDATE users SET display_name = COALESCE(?, display_name), bio = COALESCE(?, bio), avatar_emoji = COALESCE(?, avatar_emoji) WHERE id = ?`,
    ).run(body.displayName ?? null, body.bio ?? null, body.avatarEmoji ?? null, user.id);
    return { ok: true };
  });

  app.post('/me/easter-egg', limit(10), async (req) => {
    grantAchievement(db, requireUser(req).id, 'konami');
    return { ok: true };
  });

  app.put('/users/:username/follow', limit(60), async (req) => {
    const me = requireUser(req);
    const target = findUser((req.params as { username: string }).username);
    if (target.id === me.id) throw new HttpError(400, 'На себя подписаться нельзя');
    const { changes } = db
      .prepare('INSERT OR IGNORE INTO follows (follower_id, followee_id, created_at) VALUES (?, ?, ?)')
      .run(me.id, target.id, Date.now());
    if (changes) {
      const notified = db
        .prepare(`SELECT 1 FROM notifications WHERE user_id = ? AND actor_id = ? AND type = 'follow'`)
        .get(target.id, me.id);
      if (!notified) notify(db, target.id, me.id, 'follow', null);
      checkAchievements(db, target.id);
    }
    return { ok: true };
  });

  app.delete('/users/:username/follow', limit(60), async (req) => {
    const me = requireUser(req);
    const target = findUser((req.params as { username: string }).username);
    db.prepare('DELETE FROM follows WHERE follower_id = ? AND followee_id = ?').run(me.id, target.id);
    return { ok: true };
  });

  app.get('/notifications', async (req) => {
    const me = requireUser(req);
    const notifications = db
      .prepare(
        `SELECT n.id, n.type, n.meta, n.is_read AS isRead, n.created_at AS createdAt, n.post_id AS postId,
           u.username AS actorUsername, u.display_name AS actorName, u.avatar_emoji AS actorEmoji, p.thumb
         FROM notifications n
         LEFT JOIN users u ON u.id = n.actor_id
         LEFT JOIN posts p ON p.id = n.post_id
         WHERE n.user_id = ? ORDER BY n.id DESC LIMIT 50`,
      )
      .all(me.id);
    return { notifications, achievements: ACHIEVEMENTS };
  });

  app.post('/notifications/read', async (req) => {
    db.prepare('UPDATE notifications SET is_read = 1 WHERE user_id = ?').run(requireUser(req).id);
    return { ok: true };
  });

  app.get('/me/collections', async (req) => {
    const me = requireUser(req);
    return { collections: listCollections(me.id, me.id) };
  });

  app.post('/collections', limit(30), async (req, reply) => {
    const me = requireUser(req);
    const body = collectionBody.parse(req.body);
    const info = db
      .prepare('INSERT INTO collections (user_id, name, is_private, created_at) VALUES (?, ?, ?, ?)')
      .run(me.id, body.name, body.isPrivate ? 1 : 0, Date.now());
    return reply.code(201).send({ id: Number(info.lastInsertRowid) });
  });

  app.get('/collections/:id', async (req) => {
    const c = visibleCollection(idParam(req), req.user?.id);
    const rows = db
      .prepare(
        `${POST_SELECT} JOIN collection_posts cp ON cp.post_id = p.id
         WHERE cp.collection_id = ? ORDER BY cp.created_at DESC LIMIT 200`,
      )
      .all(c.id) as PostRow[];
    const owner = db.prepare('SELECT username, display_name AS displayName FROM users WHERE id = ?').get(c.user_id);
    return {
      collection: { id: c.id, name: c.name, isPrivate: Boolean(c.is_private), owner, isMine: c.user_id === req.user?.id },
      posts: hydratePosts(db, rows, req.user?.id),
    };
  });

  app.delete('/collections/:id', async (req) => {
    const c = ownCollection(idParam(req), requireUser(req).id);
    db.prepare('DELETE FROM collections WHERE id = ?').run(c.id);
    return { ok: true };
  });

  app.post('/collections/:id/posts', limit(120), async (req) => {
    const c = ownCollection(idParam(req), requireUser(req).id);
    const { postId } = collectionPostBody.parse(req.body);
    if (!db.prepare('SELECT 1 FROM posts WHERE id = ?').get(postId)) throw new HttpError(404, 'Котик не найден');
    db.prepare('INSERT OR IGNORE INTO collection_posts (collection_id, post_id, created_at) VALUES (?, ?, ?)').run(
      c.id,
      postId,
      Date.now(),
    );
    return { ok: true };
  });

  app.delete('/collections/:id/posts/:postId', async (req) => {
    const c = ownCollection(idParam(req), requireUser(req).id);
    db.prepare('DELETE FROM collection_posts WHERE collection_id = ? AND post_id = ?').run(c.id, idParam(req, 'postId'));
    return { ok: true };
  });
}
