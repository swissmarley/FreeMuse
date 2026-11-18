import { randomBytes } from 'node:crypto';
import type { FastifyInstance } from 'fastify';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createDb, migrate, type Db } from '@muse/db';
import { Bus, redisConnection } from '@muse/runtime';
import { type ActionRequest, actionHash, generateKeys, loadPrivate, signClaims } from '@muse/security';
import { buildApp } from '../src/app.js';
import type { ApiConfig } from '../src/config.js';
import { buildRegistry } from '../src/connectors/index.js';
import { Executor } from '../src/executor.js';
import { Notifier } from '../src/notify.js';
import { SandboxClient } from '../src/sandbox.js';
import { Vault } from '../src/vault.js';

const url = process.env.TEST_DATABASE_URL;
const sentinelKeys = generateKeys();
const executorKeys = generateKeys();

describe.skipIf(!url)('api', () => {
  let app: FastifyInstance;
  let db: Db;
  let bus: Bus;
  let token = '';
  let userId = '';
  const redis = redisConnection();
  const sub = redisConnection();
  const cfg: ApiConfig = {
    port: 0, jwtSecret: 'test-secret-'.padEnd(40, 'x'), vaultMasterKey: randomBytes(32).toString('base64'), sentinelPublicKey: sentinelKeys.publicKey,
    sentinelUrl: 'http://127.0.0.1:9', sentinelClientToken: 'x', executorPrivateKey: executorKeys.privateKey, internalToken: 'internal-test-token',
    webOrigin: ['http://localhost:3000'], publicUrl: 'http://localhost:4000', vapidSubject: 'mailto:x@y.z', paymentProvider: 'virtual-card-stub',
    llmBaseUrl: 'http://127.0.0.1:9', sttProvider: 'none', tts: { provider: 'device' }, secureCookies: false,
  };
  const sign = (a: ActionRequest, d: 'allow' | 'ask' | 'deny') => signClaims(loadPrivate(sentinelKeys.privateKey), { iss: 'sentinel', u: a.userId, h: actionHash(a), d, exp: Date.now() + 60_000 });
  const H = () => ({ authorization: `Bearer ${token}` });

  beforeAll(async () => {
    db = createDb(url!);
    await migrate(db);
    bus = new Bus();
    const vault = new Vault(db, cfg.vaultMasterKey);
    const registry = buildRegistry(cfg);
    const sandbox = new SandboxClient(redis, cfg.executorPrivateKey);
    app = await buildApp({ db, bus, cfg, vault, executor: new Executor(db, cfg, registry, vault, sandbox), notifier: new Notifier(db, bus, cfg), registry, sandbox, redis, sub });
  });
  afterAll(async () => {
    if (userId) await db.tx(async (c) => { await c.query("SET LOCAL muse.erase='on'"); await c.query('DELETE FROM users WHERE id=$1', [userId]); });
    await app.close();
    await bus.close();
    redis.disconnect();
    sub.disconnect();
    await db.close();
  });

  it('age gate rejects minors and stores only the birth year', async () => {
    const thisYear = new Date().getUTCFullYear();
    const minor = await app.inject({ method: 'POST', url: '/v1/auth/signup', payload: { email: `kid${Date.now()}@x.io`, password: 'correct horse battery', birthDate: `${thisYear - 15}-01-01`, acceptTerms: true } });
    expect(minor.statusCode).toBe(403);
    const ok = await app.inject({ method: 'POST', url: '/v1/auth/signup', payload: { email: `adult${Date.now()}@x.io`, password: 'correct horse battery', birthDate: '1990-06-15', acceptTerms: true } });
    expect(ok.statusCode).toBe(200);
    token = ok.json().token;
    userId = ok.json().me.id;
    const row = await db.one('SELECT * FROM users WHERE id=$1', [userId]);
    expect(row.birth_year).toBe(1990);
    expect(Object.keys(row)).not.toContain('birth_date');
  });

  it('requires auth and CSRF header for cookie sessions', async () => {
    expect((await app.inject({ method: 'GET', url: '/v1/me' })).statusCode).toBe(401);
    const cookie = await app.inject({ method: 'PATCH', url: '/v1/me/settings', cookies: { muse_session: token }, payload: { language: 'de' } });
    expect(cookie.statusCode).toBe(403);
    const ok = await app.inject({ method: 'PATCH', url: '/v1/me/settings', cookies: { muse_session: token }, headers: { 'x-muse-client': 'web' }, payload: { language: 'de' } });
    expect(ok.json().settings.language).toBe('de');
  });

  it('chat message is stored, audited and enqueued', async () => {
    const r = await app.inject({ method: 'POST', url: '/v1/conversations/default/messages', headers: H(), payload: { text: 'Hello!' } });
    expect(r.statusCode).toBe(200);
    const job = await bus.queues.turns.getJob(r.json().turnId);
    expect(job?.data.text).toBe('Hello!');
    await job?.remove();
    const hist = await app.inject({ method: 'GET', url: '/v1/conversations/default/messages', headers: H() });
    expect(hist.json().messages.at(-1).text).toBe('Hello!');
  });

  it('connects demo mail with granular scopes', async () => {
    const r = await app.inject({ method: 'POST', url: '/v1/connectors/demo_mail/connect', headers: H(), payload: { scopes: ['read', 'compose', 'bogus'] } });
    expect(r.json().connection.scopes).toEqual(['read', 'compose']);
  });

  const sendAction = (): ActionRequest => ({
    userId, actionClass: 'send', connector: 'demo_mail', operation: 'send_email', title: 'Email Lucia about arrival',
    payload: { to: ['lucia.ferrari@casa-lucia.example'], subject: 'Arrival', body: 'Arriving at 4pm' }, provenance: { userRequest: 'email my host', taintSources: [] },
  });
  const internal = { 'x-internal-token': 'internal-test-token' };

  it('executor refuses forged, mismatched or unapproved actions, and missing scopes', async () => {
    const a = sendAction();
    // forged signature
    const forged = signClaims(loadPrivate(generateKeys().privateKey), { iss: 'sentinel', u: userId, h: actionHash(a), d: 'allow', exp: Date.now() + 60_000 });
    expect((await app.inject({ method: 'POST', url: '/internal/execute', headers: internal, payload: { action: a, sentinelToken: forged } })).statusCode).toBe(403);
    // token for a different payload
    const other = { ...a, payload: { ...a.payload, to: ['evil@x.io'] } };
    expect((await app.inject({ method: 'POST', url: '/internal/execute', headers: internal, payload: { action: other, sentinelToken: sign(a, 'allow') } })).statusCode).toBe(403);
    // ask without approval
    expect((await app.inject({ method: 'POST', url: '/internal/execute', headers: internal, payload: { action: a, sentinelToken: sign(a, 'ask') } })).statusCode).toBe(403);
    // allow, but "send" scope was not granted
    const r = await app.inject({ method: 'POST', url: '/internal/execute', headers: internal, payload: { action: a, sentinelToken: sign(a, 'allow') } });
    expect(r.statusCode).toBe(403);
    expect(r.json().message).toMatch(/send/);
    // no internal token
    expect((await app.inject({ method: 'POST', url: '/internal/execute', payload: { action: a, sentinelToken: sign(a, 'allow') } })).statusCode).toBe(401);
  });

  it('approval flow: request → user approves (with edit) → executed → audit', async () => {
    await app.inject({ method: 'PATCH', url: `/v1/connections/${(await db.one("SELECT id FROM connections WHERE user_id=$1", [userId])).id}`, headers: H(), payload: { scopes: ['read', 'compose', 'send'] } });
    const a = sendAction();
    const created = await app.inject({ method: 'POST', url: '/internal/approvals', headers: internal, payload: { action: a, sentinel: { decision: 'ask', reasons: ['Sending needs approval'], risk: 'medium', token: sign(a, 'ask'), actionHash: actionHash(a) }, preview: { to: a.payload.to, subject: 'Arrival' } } });
    expect(created.statusCode).toBe(200);
    const id = created.json().approvalId;
    const list = await app.inject({ method: 'GET', url: '/v1/approvals?status=pending', headers: H() });
    expect(list.json().approvals[0].id).toBe(id);
    expect(list.json().approvals[0].sentinel).toBeUndefined();
    const ok = await app.inject({ method: 'POST', url: `/v1/approvals/${id}`, headers: H(), payload: { decision: 'approve' } });
    expect(ok.json().approval.status).toBe('executed');
    const sent = await db.q("SELECT * FROM demo_mail WHERE user_id=$1 AND folder='sent'", [userId]);
    expect(sent[0].to_addrs).toContain('lucia.ferrari@casa-lucia.example');
    const again = await app.inject({ method: 'POST', url: `/v1/approvals/${id}`, headers: H(), payload: { decision: 'approve' } });
    expect(again.statusCode).toBe(409);
    const audit = await app.inject({ method: 'GET', url: '/v1/audit', headers: H() });
    const kinds = audit.json().events.map((e: { kind: string }) => e.kind);
    expect(kinds).toEqual(expect.arrayContaining(['approval.requested', 'approval.approved', 'action.executed']));
    expect(audit.json().chainValid).toBe(true);
    // a resume turn was queued for the agent
    const waiting = await bus.queues.turns.getJobs(['waiting']);
    expect(waiting.some((j) => j.data.kind === 'resume' && j.data.userId === userId)).toBe(true);
  });

  it('approvals need a genuine Sentinel ask', async () => {
    const a = sendAction();
    const r = await app.inject({ method: 'POST', url: '/internal/approvals', headers: internal, payload: { action: a, sentinel: { decision: 'ask', token: sign(a, 'allow') }, preview: {} } });
    expect(r.statusCode).toBe(403);
  });

  it('vault stores logins encrypted and never returns passwords', async () => {
    const r = await app.inject({ method: 'POST', url: '/v1/vault', headers: H(), payload: { service: 'https://shop.example/login', username: 'me', password: 'hunter2-secret' } });
    expect(r.statusCode).toBe(200);
    const list = await app.inject({ method: 'GET', url: '/v1/vault', headers: H() });
    expect(JSON.stringify(list.json())).not.toContain('hunter2');
    expect(list.json().items[0].service).toBe('shop.example');
    const raw = await db.one('SELECT ciphertext FROM vault_items WHERE user_id=$1 AND kind=$2', [userId, 'login']);
    expect(Buffer.from(raw.ciphertext).toString('latin1')).not.toContain('hunter2');
    const audit = await db.q('SELECT data, summary FROM audit_events WHERE user_id=$1', [userId]);
    expect(JSON.stringify(audit)).not.toContain('hunter2');
  });

  it('exports data without secrets and deletes everything', async () => {
    const ex = await app.inject({ method: 'GET', url: '/v1/me/export', headers: H() });
    const body = ex.payload;
    expect(body).toContain('auditTrail');
    expect(body).not.toContain('password_hash');
    expect(body).not.toContain('hunter2');
    const del = await app.inject({ method: 'DELETE', url: '/v1/me', headers: { ...H(), 'x-muse-client': 'test' } });
    expect(del.json().ok).toBe(true);
    expect(await db.one('SELECT 1 FROM users WHERE id=$1', [userId])).toBeNull();
    expect((await db.q('SELECT 1 FROM audit_events WHERE user_id=$1', [userId])).length).toBe(0);
    userId = '';
  });
});
