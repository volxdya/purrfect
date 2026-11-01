import { createHash, randomBytes } from 'node:crypto';
import { hash, verify } from '@node-rs/argon2';
import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import { z } from 'zod';
import { checkAchievements } from '../achievements.js';
import type { Ctx } from '../db.js';
import { HttpError, limit, requireUser, today, type SessionUser } from '../http.js';

const COOKIE = 'purrfect_session';
const SESSION_MS = 30 * 24 * 60 * 60 * 1000;

const password = z.string().min(8, 'Пароль: минимум 8 символов').max(128, 'Пароль слишком длинный');
const registerBody = z.object({
  username: z.string().regex(/^[a-zA-Z0-9_]{3,24}$/, 'Ник: 3–24 символа, латиница, цифры и _'),
  password,
  displayName: z.string().trim().min(1).max(40).optional(),
});
const loginBody = z.object({ username: z.string().max(24), password: z.string().max(128) });
const passwordBody = z.object({ current: z.string().max(128), next: password });

const sha256 = (s: string) => createHash('sha256').update(s).digest('hex');

export function loadSessionUser(ctx: Ctx, req: FastifyRequest): SessionUser | null {
  const token = req.cookies[COOKIE];
  if (!token) return null;
  const user = ctx.db
    .prepare(
      `SELECT u.id, u.username, u.display_name, u.bio, u.avatar_emoji, u.streak, u.last_seen_date
       FROM sessions s JOIN users u ON u.id = s.user_id
       WHERE s.token_hash = ? AND s.expires_at > ?`,
    )
    .get(sha256(token), Date.now()) as SessionUser | undefined;
  return user ?? null;
}

function startSession(ctx: Ctx, reply: FastifyReply, userId: number) {
  const token = randomBytes(32).toString('base64url');
  const now = Date.now();
  // Only the hash is stored, so a leaked database doesn't expose live sessions.
  ctx.db.prepare('DELETE FROM sessions WHERE expires_at <= ?').run(now);
  ctx.db
    .prepare('INSERT INTO sessions (token_hash, user_id, expires_at) VALUES (?, ?, ?)')
    .run(sha256(token), userId, now + SESSION_MS);
  reply.setCookie(COOKIE, token, {
    path: '/',
    httpOnly: true,
    sameSite: 'lax',
    secure: ctx.secureCookies,
    maxAge: SESSION_MS / 1000,
  });
}

function touchStreak(ctx: Ctx, user: SessionUser): SessionUser {
  const date = today();
  if (user.last_seen_date === date) return user;
  const yesterday = today(Date.now() - 86_400_000);
  const streak = user.last_seen_date === yesterday ? user.streak + 1 : 1;
  ctx.db.prepare('UPDATE users SET streak = ?, last_seen_date = ? WHERE id = ?').run(streak, date, user.id);
  checkAchievements(ctx.db, user.id);
  return { ...user, streak, last_seen_date: date };
}

function publicMe(ctx: Ctx, user: SessionUser) {
  const { unread } = ctx.db
    .prepare('SELECT COUNT(*) AS unread FROM notifications WHERE user_id = ? AND is_read = 0')
    .get(user.id) as { unread: number };
  return {
    id: user.id,
    username: user.username,
    displayName: user.display_name,
    bio: user.bio,
    avatarEmoji: user.avatar_emoji,
    streak: user.streak,
    unread,
  };
}

export function authRoutes(app: FastifyInstance, ctx: Ctx) {
  // Lets login take the same time whether or not the username exists.
  const dummyHash = hash(randomBytes(16).toString('hex'));

  app.post('/auth/register', limit(10), async (req, reply) => {
    const body = registerBody.parse(req.body);
    const taken = ctx.db.prepare('SELECT 1 FROM users WHERE username = ?').get(body.username);
    if (taken) throw new HttpError(409, 'Этот ник уже занят');
    const info = ctx.db
      .prepare('INSERT INTO users (username, display_name, password_hash, created_at) VALUES (?, ?, ?, ?)')
      .run(body.username, body.displayName ?? body.username, await hash(body.password), Date.now());
    const id = Number(info.lastInsertRowid);
    startSession(ctx, reply, id);
    const user = ctx.db.prepare('SELECT * FROM users WHERE id = ?').get(id) as SessionUser;
    return reply.code(201).send({ user: publicMe(ctx, touchStreak(ctx, user)) });
  });

  app.post('/auth/login', limit(10), async (req, reply) => {
    const body = loginBody.parse(req.body);
    const row = ctx.db.prepare('SELECT * FROM users WHERE username = ?').get(body.username) as
      | (SessionUser & { password_hash: string })
      | undefined;
    const ok = await verify(row?.password_hash ?? (await dummyHash), body.password).catch(() => false);
    if (!row || !ok) throw new HttpError(401, 'Неверный ник или пароль');
    startSession(ctx, reply, row.id);
    return { user: publicMe(ctx, touchStreak(ctx, row)) };
  });

  app.post('/auth/logout', async (req, reply) => {
    const token = req.cookies[COOKIE];
    if (token) ctx.db.prepare('DELETE FROM sessions WHERE token_hash = ?').run(sha256(token));
    reply.clearCookie(COOKIE, { path: '/' });
    return { ok: true };
  });

  app.post('/auth/password', limit(10), async (req, reply) => {
    const user = requireUser(req);
    const body = passwordBody.parse(req.body);
    const { password_hash } = ctx.db.prepare('SELECT password_hash FROM users WHERE id = ?').get(user.id) as {
      password_hash: string;
    };
    if (!(await verify(password_hash, body.current))) throw new HttpError(401, 'Текущий пароль неверный');
    ctx.db.prepare('UPDATE users SET password_hash = ? WHERE id = ?').run(await hash(body.next), user.id);
    // Sign out every other device, then issue a fresh session for this one.
    ctx.db.prepare('DELETE FROM sessions WHERE user_id = ?').run(user.id);
    startSession(ctx, reply, user.id);
    return { ok: true };
  });

  app.get('/auth/me', async (req) => {
    return { user: req.user ? publicMe(ctx, touchStreak(ctx, req.user)) : null };
  });
}
