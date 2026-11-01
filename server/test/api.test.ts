import { mkdtempSync, readdirSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { FastifyInstance } from 'fastify';
import sharp from 'sharp';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { buildApp } from '../src/app.js';
import { eloAfter } from '../src/routes/games.js';

const dir = mkdtempSync(join(tmpdir(), 'purrfect-test-'));
const uploadDir = join(dir, 'uploads');
let app: FastifyInstance;

const HEADERS = { 'x-requested-with': 'purrfect' };

function client() {
  let cookie = '';
  const call = async (method: 'GET' | 'POST' | 'PUT' | 'PATCH' | 'DELETE', url: string, body?: object) => {
    const res = await app.inject({
      method,
      url: `/api${url}`,
      headers: { ...HEADERS, ...(cookie ? { cookie } : {}) },
      ...(body ? { payload: body } : {}),
    });
    const set = res.cookies.find((c) => c.name === 'purrfect_session');
    if (set) cookie = `purrfect_session=${set.value}`;
    return res;
  };
  return { call, cookie: () => cookie };
}

function form(meta: object, file: Buffer, filename = 'cat.png') {
  const boundary = 'testboundary';
  const payload = Buffer.concat([
    Buffer.from(`--${boundary}\r\nContent-Disposition: form-data; name="meta"\r\n\r\n${JSON.stringify(meta)}\r\n`),
    Buffer.from(`--${boundary}\r\nContent-Disposition: form-data; name="image"; filename="${filename}"\r\nContent-Type: image/png\r\n\r\n`),
    file,
    Buffer.from(`\r\n--${boundary}--\r\n`),
  ]);
  return { payload, headers: { 'content-type': `multipart/form-data; boundary=${boundary}` } };
}

const png = () =>
  sharp({ create: { width: 40, height: 60, channels: 3, background: '#ff5fa2' } })
    .withExif({ IFD0: { Copyright: 'secret-exif' } })
    .png()
    .toBuffer();

async function upload(cookie: string, meta: object, file?: Buffer) {
  const f = form(meta, file ?? (await png()));
  return app.inject({ method: 'POST', url: '/api/posts', payload: f.payload, headers: { ...HEADERS, ...f.headers, cookie } });
}

let n = 0;
async function user() {
  const c = client();
  const username = `user_${++n}`;
  const res = await c.call('POST', '/auth/register', { username, password: 'correct-horse' });
  expect(res.statusCode).toBe(201);
  return { ...c, username, id: res.json().user.id as number };
}

beforeAll(async () => {
  ({ app } = await buildApp({ dbPath: join(dir, 'test.db'), uploadDir, rateLimit: false }));
});
afterAll(async () => {
  await app.close();
  rmSync(dir, { recursive: true, force: true });
});

describe('auth', () => {
  it('sets an httpOnly lax cookie and never returns the password hash', async () => {
    const res = await app.inject({
      method: 'POST',
      url: '/api/auth/register',
      headers: HEADERS,
      payload: { username: 'cookie_check', password: 'correct-horse' },
    });
    const c = res.cookies.find((x) => x.name === 'purrfect_session')!;
    expect(c.httpOnly).toBe(true);
    expect(c.sameSite).toBe('Lax');
    expect(res.body).not.toContain('argon2');
  });

  it('rejects weak passwords, bad usernames and duplicates (case-insensitive)', async () => {
    const c = client();
    expect((await c.call('POST', '/auth/register', { username: 'okname', password: 'short' })).statusCode).toBe(400);
    expect((await c.call('POST', '/auth/register', { username: 'a b<script>', password: 'correct-horse' })).statusCode).toBe(400);
    const u = await user();
    expect((await c.call('POST', '/auth/register', { username: u.username.toUpperCase(), password: 'correct-horse' })).statusCode).toBe(409);
  });

  it('gives the same error for an unknown user and a wrong password', async () => {
    const u = await user();
    const c = client();
    const wrong = await c.call('POST', '/auth/login', { username: u.username, password: 'wrong-password' });
    const unknown = await c.call('POST', '/auth/login', { username: 'nobody_here', password: 'wrong-password' });
    expect(wrong.statusCode).toBe(401);
    expect(unknown.statusCode).toBe(401);
    expect(wrong.json()).toEqual(unknown.json());
  });

  it('logout kills the session on the server', async () => {
    const u = await user();
    await u.call('POST', '/auth/logout');
    expect((await u.call('GET', '/auth/me')).json().user).toBeNull();
  });

  it('changing the password revokes old sessions', async () => {
    const u = await user();
    const stolen = u.cookie();
    expect((await u.call('POST', '/auth/password', { current: 'correct-horse', next: 'new-password-1' })).statusCode).toBe(200);
    const res = await app.inject({ method: 'GET', url: '/api/auth/me', headers: { cookie: stolen } });
    expect(res.json().user).toBeNull();
  });
});

describe('csrf', () => {
  it('rejects state-changing requests without the custom header', async () => {
    const u = await user();
    const res = await app.inject({ method: 'POST', url: '/api/auth/logout', headers: { cookie: u.cookie() } });
    expect(res.statusCode).toBe(403);
    expect((await u.call('GET', '/auth/me')).json().user).not.toBeNull();
  });
});

describe('uploads', () => {
  it('requires login', async () => {
    expect((await upload('', { title: 'x' })).statusCode).toBe(401);
  });

  it('re-encodes to webp with a random name and strips metadata', async () => {
    const u = await user();
    const res = await upload(u.cookie(), { title: 'Котик', tags: ['#Рыжий', 'мем'] });
    expect(res.statusCode).toBe(201);
    const { post } = res.json();
    expect(post.imageUrl).toMatch(/^\/uploads\/[0-9a-f]{32}\.webp$/);
    expect(post.tags.sort()).toEqual(['мем', 'рыжий']);
    const file = await app.inject({ method: 'GET', url: post.imageUrl });
    expect(file.headers['x-content-type-options']).toBe('nosniff');
    const meta = await sharp(file.rawPayload).metadata();
    expect(meta.format).toBe('webp');
    expect(meta.exif).toBeUndefined();
  });

  it('rejects things that are not images, including svg with a script', async () => {
    const u = await user();
    expect((await upload(u.cookie(), { title: 'x' }, Buffer.from('<html><script>alert(1)</script>'))).statusCode).toBe(400);
    const svg = Buffer.from('<svg xmlns="http://www.w3.org/2000/svg" width="9" height="9"><script>alert(1)</script></svg>');
    expect((await upload(u.cookie(), { title: 'x' }, svg)).statusCode).toBe(400);
  });

  it('cannot read outside the upload folder', async () => {
    for (const url of ['/uploads/../test.db', '/uploads/..%2ftest.db', '/uploads/%2e%2e/test.db']) {
      const res = await app.inject({ method: 'GET', url });
      expect(res.statusCode).not.toBe(200);
    }
  });

  it('cannot attach a post to someone else\'s cat', async () => {
    const owner = await user();
    const cat = (await owner.call('POST', '/cats', { name: 'Чужой' })).json().id;
    const thief = await user();
    expect((await upload(thief.cookie(), { title: 'x', catId: cat })).statusCode).toBe(403);
  });
});

describe('authorization', () => {
  it('only the owner can delete a post, and the files go with it', async () => {
    const owner = await user();
    const other = await user();
    const { post } = (await upload(owner.cookie(), { title: 'mine' })).json();
    expect((await other.call('DELETE', `/posts/${post.id}`)).statusCode).toBe(403);
    expect((await owner.call('DELETE', `/posts/${post.id}`)).statusCode).toBe(200);
    expect(readdirSync(uploadDir)).not.toContain(post.imageUrl.replace('/uploads/', ''));
  });

  it('private collections are invisible to others and can\'t be modified', async () => {
    const owner = await user();
    const other = await user();
    const id = (await owner.call('POST', '/collections', { name: 'Секрет', isPrivate: true })).json().id;
    expect((await owner.call('GET', `/collections/${id}`)).statusCode).toBe(200);
    expect((await other.call('GET', `/collections/${id}`)).statusCode).toBe(404);
    expect((await other.call('DELETE', `/collections/${id}`)).statusCode).toBe(404);
    const profile = (await other.call('GET', `/users/${owner.username}`)).json().user;
    expect(profile.collections).toEqual([]);
  });

  it('comments can be removed by their author or the post owner only', async () => {
    const owner = await user();
    const author = await user();
    const stranger = await user();
    const { post } = (await upload(owner.cookie(), { title: 'p' })).json();
    const add = async () => (await author.call('POST', `/posts/${post.id}/comments`, { body: 'мяу' })).json().id;
    const first = await add();
    expect((await stranger.call('DELETE', `/comments/${first}`)).statusCode).toBe(403);
    expect((await author.call('DELETE', `/comments/${first}`)).statusCode).toBe(200);
    expect((await owner.call('DELETE', `/comments/${await add()}`)).statusCode).toBe(200);
  });

  it('notifications belong to their recipient', async () => {
    const a = await user();
    const b = await user();
    await a.call('PUT', `/users/${b.username}/follow`);
    expect((await b.call('GET', '/notifications')).json().notifications.some((x: { type: string }) => x.type === 'follow')).toBe(true);
    expect((await a.call('GET', '/notifications')).json().notifications.some((x: { type: string }) => x.type === 'follow')).toBe(false);
  });
});

describe('search', () => {
  it('treats SQL and LIKE wildcards as plain text', async () => {
    const u = await user();
    await upload(u.cookie(), { title: 'Уникальный 100% кот' });
    const search = async (q: string) =>
      (await u.call('GET', `/posts?q=${encodeURIComponent(q)}&username=${u.username}`)).json().posts.length;
    expect(await search('100%')).toBe(1);
    expect(await search('%')).toBe(1);
    expect(await search('_никальный')).toBe(0);
    expect(await search(`' OR 1=1 --`)).toBe(0);
  });
});

describe('reactions', () => {
  it('one reaction per user, can change and remove, and does not spam notifications', async () => {
    const owner = await user();
    const fan = await user();
    const { post } = (await upload(owner.cookie(), { title: 'r' })).json();
    await fan.call('PUT', `/posts/${post.id}/reaction`, { kind: 'love' });
    let updated = (await fan.call('PUT', `/posts/${post.id}/reaction`, { kind: 'fire' })).json().post;
    expect(updated.reactions).toEqual({ fire: 1 });
    expect(updated.myReaction).toBe('fire');
    await fan.call('DELETE', `/posts/${post.id}/reaction`);
    updated = (await fan.call('PUT', `/posts/${post.id}/reaction`, { kind: 'cute' })).json().post;
    expect(updated.reactions).toEqual({ cute: 1 });
    const notes = (await owner.call('GET', '/notifications')).json().notifications;
    expect(notes.filter((x: { type: string }) => x.type === 'reaction')).toHaveLength(1);
    expect((await fan.call('PUT', `/posts/${post.id}/reaction`, { kind: 'hack' })).statusCode).toBe(400);
  });

  it('own reactions do not give XP', async () => {
    const u = await user();
    const { post } = (await upload(u.cookie(), { title: 'self' })).json();
    const before = (await u.call('GET', `/users/${u.username}`)).json().user.stats.xp;
    await u.call('PUT', `/posts/${post.id}/reaction`, { kind: 'love' });
    expect((await u.call('GET', `/users/${u.username}`)).json().user.stats.xp).toBe(before);
  });
});

describe('games', () => {
  it('elo is zero-sum and favours upsets', () => {
    const [w, l] = eloAfter(1000, 1000);
    expect(w + l).toBe(2000);
    expect(w).toBe(1016);
    expect(eloAfter(800, 1200)[0] - 800).toBeGreaterThan(eloAfter(1200, 800)[0] - 1200);
  });

  it('swipes: no own cats, not shown twice', async () => {
    const owner = await user();
    const swiper = await user();
    const { post } = (await upload(owner.cookie(), { title: 's' })).json();
    expect((await owner.call('POST', `/match/${post.id}`, { verdict: 'cat' })).statusCode).toBe(400);
    expect((await owner.call('GET', '/match/deck')).json().posts.map((p: { id: number }) => p.id)).not.toContain(post.id);
    expect((await swiper.call('POST', `/match/${post.id}`, { verdict: 'supercat' })).statusCode).toBe(200);
    expect((await swiper.call('GET', '/match/deck')).json().posts.map((p: { id: number }) => p.id)).not.toContain(post.id);
  });

  it('battles: only the assigned pair, only once, only by the assigned user', async () => {
    const owner = await user();
    const voter = await user();
    const other = await user();
    await upload(owner.cookie(), { title: 'a' });
    await upload(owner.cookie(), { title: 'b' });
    const battle = (await voter.call('POST', '/battle/new')).json();
    const [a, b] = battle.posts;
    // An unfinished battle is returned again instead of a fresh pair to pick from.
    expect((await voter.call('POST', '/battle/new')).json().battleId).toBe(battle.battleId);
    expect((await other.call('POST', `/battle/${battle.battleId}/vote`, { winnerId: a.id })).statusCode).toBe(404);
    expect((await voter.call('POST', `/battle/${battle.battleId}/vote`, { winnerId: 999999 })).statusCode).toBe(400);
    const vote = await voter.call('POST', `/battle/${battle.battleId}/vote`, { winnerId: a.id });
    expect(vote.statusCode).toBe(200);
    expect(vote.json().winnerElo).toBeGreaterThan(a.elo);
    expect((await voter.call('POST', `/battle/${battle.battleId}/vote`, { winnerId: b.id })).statusCode).toBe(409);
  });

  it('cat of the day stays the same between requests', async () => {
    const u = await user();
    const first = (await u.call('GET', '/daily')).json();
    const second = (await u.call('GET', '/daily')).json();
    expect(first.post.id).toBe(second.post.id);
  });
});

describe('achievements', () => {
  it('unlocks on first post and notifies once', async () => {
    const u = await user();
    await upload(u.cookie(), { title: 'one' });
    await upload(u.cookie(), { title: 'two' });
    const profile = (await u.call('GET', `/users/${u.username}`)).json().user;
    expect(profile.achievements.find((a: { code: string }) => a.code === 'first_post').unlocked).toBe(true);
    const notes = (await u.call('GET', '/notifications')).json().notifications;
    expect(notes.filter((x: { meta: string }) => x.meta === 'first_post')).toHaveLength(1);
  });
});

describe('rate limiting', () => {
  it('blocks password guessing after 10 attempts a minute', async () => {
    const limited = await buildApp({ dbPath: join(dir, 'limit.db'), uploadDir });
    const attempt = () =>
      limited.app.inject({ method: 'POST', url: '/api/auth/login', headers: HEADERS, payload: { username: 'x_user', password: 'guess-guess' } });
    for (let i = 0; i < 10; i++) expect((await attempt()).statusCode).toBe(401);
    const blocked = await attempt();
    expect(blocked.statusCode).toBe(429);
    expect(blocked.json().error).toContain('Подожди');
    await limited.app.close();
  });
});
