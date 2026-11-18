import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { DEFAULT_AVATAR, DEFAULT_SETTINGS, GLASSES, HATS, normalizeVoicePref, SCARVES, UserSettings, type AvatarSettings } from '@muse/core';
import type { Me } from '@muse/core';
import { appendAudit } from '@muse/db';
import { SESSION_COOKIE } from '../auth.js';
import type { Deps } from '../deps.js';

export async function loadMe(d: Deps, userId: string): Promise<Me> {
  const u = await d.db.one('SELECT id, email, created_at, avatar, settings, onboarded FROM users WHERE id=$1', [userId]);
  return {
    id: u.id,
    email: u.email,
    createdAt: new Date(u.created_at).toISOString(),
    onboarded: u.onboarded,
    avatar: { ...DEFAULT_AVATAR, ...u.avatar, personality: { ...DEFAULT_AVATAR.personality, ...u.avatar?.personality }, voice: normalizeVoicePref(u.avatar?.voice), outfit: { ...DEFAULT_AVATAR.outfit, ...u.avatar?.outfit } },
    settings: { ...DEFAULT_SETTINGS, ...u.settings },
  };
}

const color = z.string().regex(/^#[0-9a-fA-F]{6}$|^$/);
const slider = z.number().min(0).max(100);
const AvatarInput = z.object({
  name: z.string().trim().min(1).max(40),
  persona: z.string().max(1000),
  personality: z.object({ warmth: slider, playfulness: slider, verbosity: slider, proactivity: slider, formality: slider }),
  voice: z.object({ provider: z.enum(['auto', 'device', 'server']), voiceId: z.string().max(200), naturalVoice: z.string().max(40).default('af_heart'), rate: z.number().min(0.5).max(2), pitch: z.number().min(0.5).max(2) }),
  outfit: z.object({ hat: z.enum(HATS), hatColor: color, glasses: z.enum(GLASSES), scarf: z.enum(SCARVES), scarfColor: color, hoodieColor: color, furTint: color }),
});

const domain = z.string().trim().toLowerCase().regex(/^[a-z0-9.-]+\.[a-z]{2,}$/).max(253);
const SettingsPatch = UserSettings.partial().extend({ allowedDomains: z.array(domain).max(200).optional(), blockedDomains: z.array(domain).max(200).optional() });

export function meRoutes(app: FastifyInstance, d: Deps) {
  const auth = { preHandler: app.auth };

  app.get('/v1/me', auth, async (req) => loadMe(d, req.user!.id));

  app.post('/v1/me/onboarded', auth, async (req) => {
    await d.db.q('UPDATE users SET onboarded=true WHERE id=$1', [req.user!.id]);
    return loadMe(d, req.user!.id);
  });

  app.put('/v1/me/avatar', auth, async (req, reply) => {
    const p = AvatarInput.safeParse(req.body);
    if (!p.success) return reply.code(400).send({ code: 'invalid', message: p.error.issues[0]?.message });
    await d.db.q('UPDATE users SET avatar=$2 WHERE id=$1', [req.user!.id, p.data satisfies AvatarSettings]);
    await d.db.tx((c) => appendAudit(c, { userId: req.user!.id, kind: 'settings.avatar', actor: 'user', summary: `Avatar updated (name: ${p.data.name})` }));
    return { avatar: p.data };
  });

  app.patch('/v1/me/settings', auth, async (req, reply) => {
    const p = SettingsPatch.safeParse(req.body);
    if (!p.success) return reply.code(400).send({ code: 'invalid', message: p.error.issues[0]?.message });
    const me = await loadMe(d, req.user!.id);
    const next = { ...me.settings, ...p.data };
    await d.db.q('UPDATE users SET settings=$2 WHERE id=$1', [req.user!.id, next]);
    await d.db.tx((c) => appendAudit(c, { userId: req.user!.id, kind: 'settings.changed', actor: 'user', summary: `Settings changed: ${Object.keys(p.data).join(', ')}`, data: p.data }));
    return { settings: next };
  });

  /** GDPR Art. 15/20: export everything we hold about the user (secrets are never exported in clear). */
  app.get('/v1/me/export', auth, async (req, reply) => {
    const u = req.user!.id;
    const q = (sql: string) => d.db.q(sql, [u]);
    const data = {
      exportedAt: new Date().toISOString(),
      account: await d.db.one('SELECT id, email, birth_year, age_verified_at, created_at, settings, avatar FROM users WHERE id=$1', [u]),
      messages: await q('SELECT id, conversation_id, role, text, citations, created_at FROM messages WHERE user_id=$1 ORDER BY created_at'),
      tasks: await q('SELECT id, title, goal, status, plan, result, created_at, updated_at FROM tasks WHERE user_id=$1'),
      approvals: await q('SELECT id, title, action_class, connector, operation, preview, status, created_at, resolved_at FROM approvals WHERE user_id=$1'),
      auditTrail: await q('SELECT seq, kind, actor, summary, data, created_at, hash FROM audit_events WHERE user_id=$1 ORDER BY seq'),
      memories: await q('SELECT id, content, kind, source, importance, created_at FROM memories WHERE user_id=$1'),
      connections: await q('SELECT connector, scopes, account, status, created_at FROM connections WHERE user_id=$1'),
      savedLogins: await q("SELECT service, username, created_at FROM vault_items WHERE user_id=$1 AND kind='login'"),
      purchases: await q('SELECT merchant, description, amount_cents, currency, status, created_at FROM purchases WHERE user_id=$1'),
      notifications: await q('SELECT title, body, created_at FROM notifications WHERE user_id=$1'),
      demoMail: await q('SELECT folder, from_addr, to_addrs, subject, body, created_at FROM demo_mail WHERE user_id=$1'),
      demoEvents: await q('SELECT title, start_at, end_at, location FROM demo_events WHERE user_id=$1'),
      sentinelDecisions: await q('SELECT action_class, decision, reasons, created_at FROM sentinel_decisions WHERE user_id=$1'),
      egressLog: await q('SELECT host, allowed, reason, created_at FROM egress_log WHERE user_id=$1'),
    };
    reply.header('content-disposition', 'attachment; filename="my-data.json"');
    return data;
  });

  /** GDPR Art. 17: delete everything (revokes OAuth tokens, removes sandbox, erases all rows). */
  app.delete('/v1/me', auth, async (req, reply) => {
    const u = req.user!.id;
    const conns = await d.db.q("SELECT connector, vault_id FROM connections WHERE user_id=$1 AND status='active'", [u]);
    for (const c of conns) {
      await d.registry.get(c.connector)?.revoke?.({ userId: u, db: d.db, vault: d.vault, cfg: d.cfg, sandbox: d.sandbox, vaultId: c.vault_id }).catch(() => {});
    }
    await d.redis.publish('sandbox:destroy', u);
    await d.redis.del(`sandbox:${u}`);
    await d.db.tx(async (c) => {
      await c.query("SET LOCAL muse.erase = 'on'");
      await c.query('DELETE FROM users WHERE id=$1', [u]);
    });
    reply.clearCookie(SESSION_COOKIE, { path: '/' });
    return { ok: true };
  });
}
