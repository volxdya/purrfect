import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { checkAchievements, levelFromXp, XP_SQL } from '../achievements.js';
import type { Ctx } from '../db.js';
import { HttpError, idParam, limit, requireUser, today } from '../http.js';
import { hydratePosts, notify, POST_SELECT, type PostRow } from './posts.js';

const swipeBody = z.object({ verdict: z.enum(['cat', 'supercat']) });
const voteBody = z.object({ winnerId: z.number().int().positive() });

const ELO_K = 32;

export function eloAfter(winner: number, loser: number): [number, number] {
  const expected = 1 / (1 + 10 ** ((loser - winner) / 400));
  const delta = Math.round(ELO_K * (1 - expected));
  return [winner + delta, loser - delta];
}

export function gameRoutes(app: FastifyInstance, ctx: Ctx) {
  const { db } = ctx;

  const postsByIds = (ids: number[], viewerId: number) => {
    const rows = db.prepare(`${POST_SELECT} WHERE p.id IN (${ids.map(() => '?').join(',')})`).all(...ids) as PostRow[];
    const hydrated = hydratePosts(db, rows, viewerId);
    return ids.map((id) => hydrated.find((p) => p.id === id));
  };

  app.get('/match/deck', async (req) => {
    const me = requireUser(req);
    const rows = db
      .prepare(
        `${POST_SELECT} WHERE p.user_id != ?
           AND NOT EXISTS (SELECT 1 FROM swipes s WHERE s.user_id = ? AND s.post_id = p.id)
         ORDER BY RANDOM() LIMIT 20`,
      )
      .all(me.id, me.id) as PostRow[];
    return { posts: hydratePosts(db, rows, me.id) };
  });

  app.post('/match/:id', limit(120), async (req) => {
    const me = requireUser(req);
    const { verdict } = swipeBody.parse(req.body);
    const post = db.prepare('SELECT id, user_id FROM posts WHERE id = ?').get(idParam(req)) as
      | { id: number; user_id: number }
      | undefined;
    if (!post) throw new HttpError(404, 'Котик убежал');
    if (post.user_id === me.id) throw new HttpError(400, 'Своего котика оценивать нельзя');
    const { changes } = db
      .prepare('INSERT OR IGNORE INTO swipes (user_id, post_id, verdict, created_at) VALUES (?, ?, ?, ?)')
      .run(me.id, post.id, verdict, Date.now());
    if (changes && verdict === 'supercat') notify(db, post.user_id, me.id, 'supercat', post.id);
    if (changes) checkAchievements(db, me.id);
    return { ok: true };
  });

  /**
   * The server picks the pair and remembers it, so a client can't invent matchups
   * or vote for the same pair twice to pump a cat's rating.
   */
  app.post('/battle/new', limit(120), async (req) => {
    const me = requireUser(req);
    const open = db.prepare('SELECT id, a_id, b_id FROM battles WHERE user_id = ? AND winner_id IS NULL LIMIT 1').get(me.id) as
      | { id: number; a_id: number; b_id: number }
      | undefined;
    if (open) return { battleId: open.id, posts: postsByIds([open.a_id, open.b_id], me.id) };

    const ids = (db.prepare('SELECT id FROM posts WHERE user_id != ? ORDER BY RANDOM() LIMIT 40').all(me.id) as { id: number }[]).map((r) => r.id);
    const fought = db.prepare('SELECT 1 FROM battles WHERE user_id = ? AND a_id = ? AND b_id = ?');
    for (let i = 0; i < ids.length; i++) {
      for (let j = i + 1; j < ids.length; j++) {
        const a = Math.min(ids[i]!, ids[j]!);
        const b = Math.max(ids[i]!, ids[j]!);
        if (fought.get(me.id, a, b)) continue;
        const info = db
          .prepare('INSERT INTO battles (user_id, a_id, b_id, created_at) VALUES (?, ?, ?, ?)')
          .run(me.id, a, b, Date.now());
        return { battleId: Number(info.lastInsertRowid), posts: postsByIds([a, b], me.id) };
      }
    }
    return { battleId: null, posts: [] };
  });

  app.post('/battle/:id/vote', limit(120), async (req) => {
    const me = requireUser(req);
    const { winnerId } = voteBody.parse(req.body);
    const battle = db.prepare('SELECT * FROM battles WHERE id = ? AND user_id = ?').get(idParam(req), me.id) as
      | { id: number; a_id: number; b_id: number; winner_id: number | null }
      | undefined;
    if (!battle) throw new HttpError(404, 'Битва не найдена');
    if (battle.winner_id) throw new HttpError(409, 'Ты уже проголосовал в этой битве');
    if (winnerId !== battle.a_id && winnerId !== battle.b_id) throw new HttpError(400, 'Этот котик не участвует в битве');
    const loserId = winnerId === battle.a_id ? battle.b_id : battle.a_id;

    const result = db.transaction(() => {
      const elo = db.prepare('SELECT elo FROM posts WHERE id = ?');
      const w = (elo.get(winnerId) as { elo: number }).elo;
      const l = (elo.get(loserId) as { elo: number }).elo;
      const [newW, newL] = eloAfter(w, l);
      db.prepare('UPDATE posts SET elo = ?, wins = wins + 1 WHERE id = ?').run(newW, winnerId);
      db.prepare('UPDATE posts SET elo = ?, losses = losses + 1 WHERE id = ?').run(newL, loserId);
      db.prepare('UPDATE battles SET winner_id = ? WHERE id = ?').run(winnerId, battle.id);
      return { winnerElo: newW, loserElo: newL };
    })();
    checkAchievements(db, me.id);
    return result;
  });

  app.get('/leaderboard', async (req) => {
    const viewer = req.user?.id;
    const topElo = db
      .prepare(`${POST_SELECT} WHERE p.wins + p.losses > 0 ORDER BY p.elo DESC, p.id LIMIT 10`)
      .all() as PostRow[];
    const topWeek = db
      .prepare(
        `${POST_SELECT} JOIN (SELECT winner_id, COUNT(*) AS n FROM battles
            WHERE winner_id IS NOT NULL AND created_at > ? GROUP BY winner_id) w ON w.winner_id = p.id
         ORDER BY w.n DESC, p.id LIMIT 10`,
      )
      .all(Date.now() - 7 * 86_400_000) as PostRow[];
    const topUsers = (
      db
        .prepare(
          `SELECT u.username, u.display_name AS displayName, u.avatar_emoji AS avatarEmoji, ${XP_SQL} AS xp
           FROM users u ORDER BY xp DESC, u.id LIMIT 10`,
        )
        .all() as { username: string; displayName: string; avatarEmoji: string; xp: number }[]
    ).map((u) => ({ ...u, level: levelFromXp(u.xp) }));
    return {
      topElo: hydratePosts(db, topElo, viewer),
      topWeek: hydratePosts(db, topWeek, viewer),
      topUsers,
    };
  });

  /** The pick is stored so the cat of the day stays the same until midnight UTC. */
  app.get('/daily', async (req) => {
    const date = today();
    let row = db.prepare('SELECT post_id FROM daily_cat WHERE date = ?').get(date) as { post_id: number } | undefined;
    if (!row) {
      const best = (db
        .prepare(
          `SELECT p.id FROM posts p JOIN reactions r ON r.post_id = p.id
           WHERE r.created_at > ? GROUP BY p.id ORDER BY COUNT(*) DESC, RANDOM() LIMIT 1`,
        )
        .get(Date.now() - 86_400_000) ?? db.prepare('SELECT id FROM posts ORDER BY RANDOM() LIMIT 1').get()) as
        | { id: number }
        | undefined;
      if (!best) return { date, post: null };
      db.prepare('INSERT INTO daily_cat (date, post_id) VALUES (?, ?)').run(date, best.id);
      row = { post_id: best.id };
    }
    const rows = db.prepare(`${POST_SELECT} WHERE p.id = ?`).all(row.post_id) as PostRow[];
    return { date, post: hydratePosts(db, rows, req.user?.id)[0] };
  });
}
