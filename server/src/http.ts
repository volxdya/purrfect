import type { FastifyRequest } from 'fastify';
import { z } from 'zod';

export interface SessionUser {
  id: number;
  username: string;
  display_name: string;
  bio: string;
  avatar_emoji: string;
  streak: number;
  last_seen_date: string | null;
}

declare module 'fastify' {
  interface FastifyRequest {
    user: SessionUser | null;
  }
}

export class HttpError extends Error {
  constructor(
    public statusCode: number,
    message: string,
  ) {
    super(message);
  }
}

export function requireUser(req: FastifyRequest): SessionUser {
  if (!req.user) throw new HttpError(401, 'Сначала войди в аккаунт');
  return req.user;
}

const idSchema = z.coerce.number().int().positive();

export function idParam(req: FastifyRequest, name = 'id'): number {
  const parsed = idSchema.safeParse((req.params as Record<string, unknown>)[name]);
  if (!parsed.success) throw new HttpError(404, 'Не найдено');
  return parsed.data;
}

/** Per-route rate limit, per IP. Ignored when the plugin is disabled in tests. */
export function limit(max: number) {
  return { config: { rateLimit: { max, timeWindow: '1 minute' } } };
}

export function today(now = Date.now()): string {
  return new Date(now).toISOString().slice(0, 10);
}
