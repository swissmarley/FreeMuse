import { randomBytes, scrypt as _scrypt, timingSafeEqual } from 'node:crypto';
import { promisify } from 'node:util';
import { jwtVerify, SignJWT } from 'jose';
import type { FastifyReply, FastifyRequest } from 'fastify';
import type { Db } from '@muse/db';

const scrypt = promisify(_scrypt) as (pw: string, salt: Buffer, len: number, opts: object) => Promise<Buffer>;
const PARAMS = { N: 2 ** 15, r: 8, p: 1, maxmem: 64 * 1024 * 1024 };

export async function hashPassword(pw: string): Promise<string> {
  const salt = randomBytes(16);
  const key = await scrypt(pw, salt, 32, PARAMS);
  return `scrypt$${salt.toString('base64')}$${key.toString('base64')}`;
}

export async function verifyPassword(pw: string, stored: string): Promise<boolean> {
  const [alg, s, k] = stored.split('$');
  if (alg !== 'scrypt' || !s || !k) return false;
  const key = await scrypt(pw, Buffer.from(s, 'base64'), 32, PARAMS);
  const want = Buffer.from(k, 'base64');
  return want.length === key.length && timingSafeEqual(want, key);
}

export const SESSION_COOKIE = 'muse_session';
const SESSION_DAYS = 30;

export async function createSession(db: Db, secret: string, userId: string): Promise<string> {
  const s = await db.one(`INSERT INTO sessions(user_id, expires_at) VALUES ($1, now() + interval '${SESSION_DAYS} days') RETURNING id`, [userId]);
  return new SignJWT({ sid: s.id })
    .setProtectedHeader({ alg: 'HS256' })
    .setSubject(userId)
    .setIssuedAt()
    .setExpirationTime(`${SESSION_DAYS}d`)
    .sign(new TextEncoder().encode(secret));
}

export interface AuthedUser { id: string; sid: string }
declare module 'fastify' {
  interface FastifyRequest { user?: AuthedUser }
}

export function authGuard(db: Db, secret: string) {
  const key = new TextEncoder().encode(secret);
  return async (req: FastifyRequest, reply: FastifyReply) => {
    const header = req.headers.authorization;
    const viaCookie = !header;
    const token = header?.startsWith('Bearer ') ? header.slice(7) : req.cookies?.[SESSION_COOKIE];
    if (!token) return reply.code(401).send({ code: 'unauthenticated', message: 'Please sign in' });
    // CSRF: cookie-authenticated state changes must carry a custom header (cross-site requests can't add it without CORS).
    if (viaCookie && req.method !== 'GET' && req.method !== 'HEAD' && !req.headers['x-muse-client']) {
      return reply.code(403).send({ code: 'csrf', message: 'Missing client header' });
    }
    try {
      const { payload } = await jwtVerify(token, key, { algorithms: ['HS256'] });
      const sid = String(payload.sid);
      const s = await db.one('SELECT user_id FROM sessions WHERE id=$1 AND NOT revoked AND expires_at > now()', [sid]);
      if (!s || s.user_id !== payload.sub) return reply.code(401).send({ code: 'session_expired', message: 'Please sign in again' });
      req.user = { id: s.user_id, sid };
    } catch {
      return reply.code(401).send({ code: 'unauthenticated', message: 'Please sign in' });
    }
  };
}
