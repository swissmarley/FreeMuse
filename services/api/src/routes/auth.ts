import type { FastifyInstance } from 'fastify';
import { ageOn, DEFAULT_AVATAR, DEFAULT_SETTINGS, MIN_AGE, SignupInput } from '@muse/core';
import { appendAudit } from '@muse/db';
import { createSession, hashPassword, SESSION_COOKIE, verifyPassword } from '../auth.js';
import type { Deps } from '../deps.js';
import { loadMe } from './me.js';

export function authRoutes(app: FastifyInstance, d: Deps) {
  const cookieOpts = { httpOnly: true, sameSite: 'lax' as const, secure: d.cfg.secureCookies, path: '/', maxAge: 30 * 86400 };
  const limit = { config: { rateLimit: { max: 10, timeWindow: '1 minute' } } };

  app.post('/v1/auth/signup', limit, async (req, reply) => {
    const parsed = SignupInput.safeParse(req.body);
    if (!parsed.success) return reply.code(400).send({ code: 'invalid', message: parsed.error.issues[0]?.message ?? 'Invalid input' });
    const { email, password, birthDate } = parsed.data;
    const age = ageOn(birthDate);
    if (age < MIN_AGE || age > 120) return reply.code(403).send({ code: 'age_gate', message: `You must be at least ${MIN_AGE} to use this app.` });
    const exists = await d.db.one('SELECT 1 FROM users WHERE email=$1', [email]);
    if (exists) return reply.code(409).send({ code: 'exists', message: 'An account with this email already exists' });
    const hash = await hashPassword(password);
    // Data minimisation: only the birth year is stored, plus the verification time.
    const u = await d.db.one(
      'INSERT INTO users(email, password_hash, birth_year, age_verified_at, settings, avatar) VALUES ($1,$2,$3,now(),$4,$5) RETURNING id',
      [email, hash, Number(birthDate.slice(0, 4)), DEFAULT_SETTINGS, DEFAULT_AVATAR],
    );
    await d.db.tx((c) => appendAudit(c, { userId: u.id, kind: 'account.created', actor: 'user', summary: 'Account created (age verified 18+)' }));
    const token = await createSession(d.db, d.cfg.jwtSecret, u.id);
    reply.setCookie(SESSION_COOKIE, token, cookieOpts);
    return { token, me: await loadMe(d, u.id) };
  });

  app.post('/v1/auth/login', limit, async (req, reply) => {
    const { email, password } = (req.body ?? {}) as { email?: string; password?: string };
    const u = email ? await d.db.one('SELECT id, password_hash FROM users WHERE email=$1', [email]) : null;
    // Constant-ish time: always run a hash comparison.
    const ok = await verifyPassword(String(password ?? ''), u?.password_hash ?? 'scrypt$AAAAAAAAAAAAAAAAAAAAAA==$AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA=');
    if (!u || !ok) return reply.code(401).send({ code: 'bad_credentials', message: 'Email or password is incorrect' });
    const token = await createSession(d.db, d.cfg.jwtSecret, u.id);
    reply.setCookie(SESSION_COOKIE, token, cookieOpts);
    return { token, me: await loadMe(d, u.id) };
  });

  app.post('/v1/auth/logout', { preHandler: app.auth }, async (req, reply) => {
    await d.db.q('UPDATE sessions SET revoked=true WHERE id=$1', [req.user!.sid]);
    reply.clearCookie(SESSION_COOKIE, { path: '/' });
    return { ok: true };
  });
}
