import { existsSync, mkdirSync } from 'node:fs';
import cookie from '@fastify/cookie';
import helmet from '@fastify/helmet';
import multipart from '@fastify/multipart';
import rateLimit from '@fastify/rate-limit';
import fastifyStatic from '@fastify/static';
import Fastify, { type FastifyError } from 'fastify';
import { ZodError } from 'zod';
import { openDb, type Ctx } from './db.js';
import { HttpError } from './http.js';
import { authRoutes, loadSessionUser } from './routes/auth.js';
import { catRoutes } from './routes/cats.js';
import { gameRoutes } from './routes/games.js';
import { postRoutes } from './routes/posts.js';
import { socialRoutes } from './routes/social.js';

export interface AppOptions {
  dbPath: string;
  uploadDir: string;
  secureCookies?: boolean;
  rateLimit?: boolean;
  clientDist?: string;
  logger?: boolean;
}

export async function buildApp(options: AppOptions) {
  mkdirSync(options.uploadDir, { recursive: true });
  const ctx: Ctx = {
    db: openDb(options.dbPath),
    uploadDir: options.uploadDir,
    secureCookies: options.secureCookies ?? false,
  };

  const app = Fastify({ logger: options.logger ?? false, bodyLimit: 64 * 1024 });
  app.addHook('onClose', async () => ctx.db.close());

  app.setErrorHandler((err: FastifyError, req, reply) => {
    if (err instanceof ZodError) {
      return reply.code(400).send({ error: err.issues[0]?.message ?? 'Неверные данные' });
    }
    const status = err.statusCode ?? 500;
    if (status >= 500) {
      req.log.error(err);
      return reply.code(500).send({ error: 'Что-то сломалось. Котик уже чинит' });
    }
    // Multipart and framework errors have English messages that mean nothing to users.
    const message =
      err instanceof HttpError || status === 429
        ? err.message
        : status === 413
          ? 'Файл слишком большой: максимум 10 МБ'
          : 'Неверный запрос';
    return reply.code(status).send({ error: message });
  });

  await app.register(helmet, {
    hsts: ctx.secureCookies,
    contentSecurityPolicy: {
      useDefaults: false,
      directives: {
        defaultSrc: ["'self'"],
        scriptSrc: ["'self'"],
        styleSrc: ["'self'", "'unsafe-inline'"],
        imgSrc: ["'self'", 'data:', 'blob:'],
        fontSrc: ["'self'"],
        connectSrc: ["'self'"],
        objectSrc: ["'none'"],
        baseUri: ["'self'"],
        formAction: ["'self'"],
        frameAncestors: ["'none'"],
      },
    },
  });
  await app.register(cookie);
  await app.register(multipart);
  if (options.rateLimit !== false) {
    await app.register(rateLimit, {
      global: true,
      max: 1000,
      timeWindow: '1 minute',
      errorResponseBuilder: () => Object.assign(new Error('Слишком много запросов, котик устал. Подожди минутку'), { statusCode: 429 }),
    });
  }

  app.decorateRequest('user', null);
  app.addHook('onRequest', async (req) => {
    if (!req.url.startsWith('/api/')) return;
    // A cross-site form can't set a custom header, and with no CORS enabled a
    // cross-site fetch can't either. Together with SameSite=Lax this stops CSRF.
    if (!['GET', 'HEAD', 'OPTIONS'].includes(req.method) && req.headers['x-requested-with'] !== 'purrfect') {
      throw new HttpError(403, 'Запрос отклонён');
    }
    req.user = loadSessionUser(ctx, req);
  });

  await app.register(
    async (api) => {
      authRoutes(api, ctx);
      postRoutes(api, ctx);
      socialRoutes(api, ctx);
      catRoutes(api, ctx);
      gameRoutes(api, ctx);
    },
    { prefix: '/api' },
  );

  await app.register(fastifyStatic, {
    root: options.uploadDir,
    prefix: '/uploads/',
    decorateReply: false,
    immutable: true,
    maxAge: '30d',
  });

  const dist = options.clientDist;
  if (dist && existsSync(dist)) {
    await app.register(fastifyStatic, { root: dist, wildcard: false });
    app.setNotFoundHandler((req, reply) => {
      if (req.method === 'GET' && !req.url.startsWith('/api/') && !req.url.startsWith('/uploads/')) {
        return reply.sendFile('index.html');
      }
      return reply.code(404).send({ error: 'Не найдено' });
    });
  } else {
    app.setNotFoundHandler((_req, reply) => reply.code(404).send({ error: 'Не найдено' }));
  }

  return { app, ctx };
}
