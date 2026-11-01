import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { checkAchievements } from '../achievements.js';
import type { Ctx } from '../db.js';
import { HttpError, idParam, limit, requireUser } from '../http.js';

const catBody = z.object({
  name: z.string().trim().min(1, 'Как зовут котика?').max(40),
  breed: z.string().trim().max(40).default(''),
  bio: z.string().trim().max(300).default(''),
  traits: z.array(z.string().trim().min(1).max(20)).max(6).default([]),
  emoji: z.string().min(1).max(8).default('🐱'),
});

interface CatRow {
  id: number;
  owner_id: number;
  name: string;
  breed: string;
  bio: string;
  traits: string;
  emoji: string;
  created_at: number;
}

export function catRoutes(app: FastifyInstance, ctx: Ctx) {
  const { db } = ctx;

  function getCat(id: number): CatRow {
    const cat = db.prepare('SELECT * FROM cats WHERE id = ?').get(id) as CatRow | undefined;
    if (!cat) throw new HttpError(404, 'Такого котика нет');
    return cat;
  }

  function ownCat(id: number, userId: number): CatRow {
    const cat = getCat(id);
    if (cat.owner_id !== userId) throw new HttpError(403, 'Это не твой котик');
    return cat;
  }

  app.get('/cats/:id', async (req) => {
    const cat = getCat(idParam(req));
    const owner = db
      .prepare('SELECT username, display_name AS displayName, avatar_emoji AS avatarEmoji FROM users WHERE id = ?')
      .get(cat.owner_id);
    const scores = db
      .prepare(
        `SELECT COUNT(*) AS posts, COALESCE(SUM(p.wins), 0) AS wins, COALESCE(MAX(p.elo), 1000) AS bestElo,
           (SELECT COUNT(*) FROM reactions r JOIN posts p2 ON p2.id = r.post_id WHERE p2.cat_id = ?1) AS reactions,
           (SELECT COUNT(*) FROM swipes s JOIN posts p3 ON p3.id = s.post_id WHERE p3.cat_id = ?1 AND s.verdict = 'supercat') AS supers
         FROM posts p WHERE p.cat_id = ?1`,
      )
      .get(cat.id) as { posts: number; wins: number; bestElo: number; reactions: number; supers: number };
    return {
      cat: {
        id: cat.id,
        name: cat.name,
        breed: cat.breed,
        bio: cat.bio,
        traits: JSON.parse(cat.traits) as string[],
        emoji: cat.emoji,
        owner,
        isMine: cat.owner_id === req.user?.id,
        karma: scores.reactions + scores.supers * 3 + scores.wins * 2,
        ...scores,
      },
    };
  });

  app.post('/cats', limit(20), async (req, reply) => {
    const me = requireUser(req);
    const body = catBody.parse(req.body);
    const info = db
      .prepare('INSERT INTO cats (owner_id, name, breed, bio, traits, emoji, created_at) VALUES (?, ?, ?, ?, ?, ?, ?)')
      .run(me.id, body.name, body.breed, body.bio, JSON.stringify(body.traits), body.emoji, Date.now());
    checkAchievements(db, me.id);
    return reply.code(201).send({ id: Number(info.lastInsertRowid) });
  });

  app.put('/cats/:id', async (req) => {
    const cat = ownCat(idParam(req), requireUser(req).id);
    const body = catBody.parse(req.body);
    db.prepare('UPDATE cats SET name = ?, breed = ?, bio = ?, traits = ?, emoji = ? WHERE id = ?').run(
      body.name,
      body.breed,
      body.bio,
      JSON.stringify(body.traits),
      body.emoji,
      cat.id,
    );
    return { ok: true };
  });

  app.delete('/cats/:id', async (req) => {
    const cat = ownCat(idParam(req), requireUser(req).id);
    db.prepare('DELETE FROM cats WHERE id = ?').run(cat.id);
    return { ok: true };
  });
}
