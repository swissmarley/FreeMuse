import { createServer } from 'node:http';
import { randomBytes } from 'node:crypto';
import type { FastifyInstance } from 'fastify';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
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
import { encodeWav } from '../src/tts.js';

const url = process.env.TEST_DATABASE_URL;

describe('natural voice output', () => {
  it('encodes 16-bit PCM WAV', () => {
    const wav = encodeWav(new Float32Array([0, 1, -1, 0.5, 2]), 24000);
    expect(wav.toString('ascii', 0, 4)).toBe('RIFF');
    expect(wav.toString('ascii', 8, 12)).toBe('WAVE');
    expect(wav.readUInt32LE(24)).toBe(24000);
    expect(wav.readUInt16LE(34)).toBe(16);
    expect(wav.length).toBe(44 + 10);
    expect(wav.readInt16LE(46)).toBe(32767);
    expect(wav.readInt16LE(48)).toBe(-32768);
    expect(wav.readInt16LE(52)).toBe(32767); // clipped
  });
});
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
    llmBaseUrl: 'http://127.0.0.1:9', sttProvider: 'none', tts: { provider: 'device' }, secureCookies: false, allowContributorMode: true, elevenlabsBaseUrl: 'http://127.0.0.1:9',
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

  it('contributor mode needs explicit consent and flips the training opt-out', async () => {
    const H2 = { authorization: `Bearer ${token}` };
    const no = await app.inject({ method: 'PATCH', url: '/v1/me/settings', headers: H2, payload: { contributorMode: true } });
    expect(no.statusCode).toBe(400);
    expect(no.json().code).toBe('consent_required');
    const forged = await app.inject({ method: 'PATCH', url: '/v1/me/settings', headers: H2, payload: { contributorConsentAt: '2020-01-01T00:00:00Z' } });
    expect(forged.json().settings?.contributorConsentAt ?? null).toBeNull();
    const yes = await app.inject({ method: 'PATCH', url: '/v1/me/settings', headers: H2, payload: { contributorMode: true, contributorConsent: true } });
    expect(yes.json().settings).toMatchObject({ contributorMode: true, trainingOptOut: false });
    expect(yes.json().settings.contributorConsentAt).toMatch(/^\d{4}-/);
    const audit = await db.one("SELECT summary FROM audit_events WHERE user_id=$1 AND kind='settings.changed' ORDER BY seq DESC LIMIT 1", [userId]);
    expect(audit.summary).toMatch(/Contributor mode turned ON/);
    const off = await app.inject({ method: 'PATCH', url: '/v1/me/settings', headers: H2, payload: { trainingOptOut: true } });
    expect(off.json().settings).toMatchObject({ contributorMode: false, trainingOptOut: true, contributorConsentAt: null });
    expect((await app.inject({ method: 'GET', url: '/v1/me', headers: H2 })).json().features).toEqual({ contributorMode: true });
  });

  it('ElevenLabs: key is checked, stored encrypted, never returned, and used for speech', async () => {
    const H2 = { authorization: `Bearer ${token}` };
    const seen: { path: string; key: string | undefined; body: string }[] = [];
    const fake = createServer((rq, rs) => {
      let body = '';
      rq.on('data', (c) => (body += c));
      rq.on('end', () => {
        seen.push({ path: rq.url ?? '', key: rq.headers['xi-api-key'] as string | undefined, body });
        if (rq.headers['xi-api-key'] !== 'sk_' + 'a'.repeat(40)) { rs.writeHead(401, { 'content-type': 'application/json' }); rs.end(JSON.stringify({ detail: { status: 'invalid_api_key', message: 'bad' } })); return; }
        if (rq.url === '/v1/voices') { rs.writeHead(200, { 'content-type': 'application/json' }); rs.end(JSON.stringify({ voices: [{ voice_id: 'cgSgspJ2msm6clMCkdW9', name: 'Jessica', category: 'premade', labels: { gender: 'female' } }] })); return; }
        rs.writeHead(200, { 'content-type': 'audio/mpeg' });
        rs.end(Buffer.from('ID3fake-mp3'));
      });
    });
    await new Promise<void>((r) => fake.listen(0, '127.0.0.1', r));
    cfg.elevenlabsBaseUrl = `http://127.0.0.1:${(fake.address() as { port: number }).port}`;
    const app2 = await buildApp({ db, bus, cfg, vault: new Vault(db, cfg.vaultMasterKey), executor: new Executor(db, cfg, buildRegistry(cfg), new Vault(db, cfg.vaultMasterKey), new SandboxClient(redis, cfg.executorPrivateKey)), notifier: new Notifier(db, bus, cfg), registry: buildRegistry(cfg), sandbox: new SandboxClient(redis, cfg.executorPrivateKey), redis, sub });
    try {
      expect((await app2.inject({ method: 'PUT', url: '/v1/voice/elevenlabs', headers: H2, payload: { apiKey: 'nope' } })).statusCode).toBe(400);
      const bad = await app2.inject({ method: 'PUT', url: '/v1/voice/elevenlabs', headers: H2, payload: { apiKey: 'sk_' + 'b'.repeat(40) } });
      expect(bad.json().code).toBe('elevenlabs_invalid_key');
      const ok = await app2.inject({ method: 'PUT', url: '/v1/voice/elevenlabs', headers: H2, payload: { apiKey: 'sk_' + 'a'.repeat(40) } });
      expect(ok.json()).toMatchObject({ ok: true, keyHint: '…aaaa' });
      expect(ok.json().voices[0].name).toBe('Jessica');
      const st = await app2.inject({ method: 'GET', url: '/v1/voice/elevenlabs', headers: H2 });
      expect(st.json()).toEqual({ configured: true, keyHint: '…aaaa' });
      expect(JSON.stringify((await app2.inject({ method: 'GET', url: '/v1/me/export', headers: H2 })).json())).not.toContain('a'.repeat(40));
      const tts = await app2.inject({ method: 'POST', url: '/v1/voice/tts', headers: H2, payload: { text: 'Ciao, come stai?', engine: 'elevenlabs', voice: 'cgSgspJ2msm6clMCkdW9', lang: 'it', model: 'eleven_flash_v2_5', speed: 1 } });
      expect(tts.statusCode).toBe(200);
      expect(tts.headers['content-type']).toBe('audio/mpeg');
      const call = seen.at(-1)!;
      expect(call.path).toBe('/v1/text-to-speech/cgSgspJ2msm6clMCkdW9?output_format=mp3_44100_128');
      expect(JSON.parse(call.body)).toMatchObject({ text: 'Ciao, come stai?', model_id: 'eleven_flash_v2_5', language_code: 'it' });
      expect((await app2.inject({ method: 'DELETE', url: '/v1/voice/elevenlabs', headers: H2 })).json()).toEqual({ ok: true });
      const gone = await app2.inject({ method: 'POST', url: '/v1/voice/tts', headers: H2, payload: { text: 'Hi', engine: 'elevenlabs' } });
      expect(gone.json().code).toBe('elevenlabs_not_configured');
    } finally {
      await app2.close();
      fake.close();
    }
  });

  it('voice-call messages are marked for the agent', async () => {
    const r = await app.inject({ method: 'POST', url: '/v1/conversations/default/messages', headers: H(), payload: { text: 'Hi on the phone', channel: 'voice' } });
    const job = await bus.queues.turns.getJob(r.json().turnId);
    expect(job?.data.channel).toBe('voice');
    await job?.remove();
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

  it('connects the local test mailbox with granular scopes, and does not offer it as a product connection', async () => {
    process.env.ALLOW_DEMO_CONNECTORS = '1';
    const hidden = await app.inject({ method: 'GET', url: '/v1/connectors', headers: H() });
    const ids = hidden.json().connectors.map((c: { id: string }) => c.id);
    expect(ids).not.toContain('demo_mail');
    expect(ids).not.toContain('demo_calendar');
    const refused = await app.inject({ method: 'POST', url: '/v1/connect/quick', headers: H(), payload: { preset: 'demo' } });
    expect(refused.statusCode).toBe(400);
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

  it('reports voice config and refuses server TTS when it is off', async () => {
    const c = await app.inject({ method: 'GET', url: '/v1/voice/config', headers: H() });
    expect(c.json().tts).toBe('device');
    expect(c.json().natural.available).toBe(false);
    expect(c.json().natural.voices[0].id).toBe('af_heart');
    expect((await app.inject({ method: 'POST', url: '/v1/voice/tts', headers: H(), payload: { text: 'Hi' } })).statusCode).toBe(501);
  });

  it('upgrades old robotic voice defaults and accepts natural voice settings', async () => {
    await db.q(`UPDATE users SET avatar = jsonb_set(coalesce(avatar, '{}'::jsonb), '{voice}', '{"provider":"device","voiceId":"","rate":1,"pitch":1}') WHERE id=$1`, [userId]);
    const me = await app.inject({ method: 'GET', url: '/v1/me', headers: H() });
    expect(me.json().avatar.voice).toMatchObject({ provider: 'auto', naturalVoice: 'af_heart' });
    const r = await app.inject({ method: 'PUT', url: '/v1/me/avatar', headers: H(), payload: { ...me.json().avatar, voice: { provider: 'server', voiceId: '', naturalVoice: 'af_bella', rate: 1, pitch: 1.15 } } });
    expect(r.statusCode).toBe(200);
    expect(r.json().avatar.voice.naturalVoice).toBe('af_bella');
  });

  it('Google: in-app setup, one consent for all services, shared token revoked only with the last connection', async () => {
    const setup0 = await app.inject({ method: 'GET', url: '/v1/setup/google', headers: H() });
    expect(setup0.json()).toMatchObject({ configured: false, redirectUri: 'http://localhost:4000/v1/oauth/google/callback' });
    const notYet = await app.inject({ method: 'POST', url: '/v1/connect/quick', headers: H(), payload: { preset: 'google' } });
    expect(notYet.statusCode).toBe(400);
    expect(notYet.json().message).toContain('Set up Google');
    expect((await app.inject({ method: 'PUT', url: '/v1/setup/google', headers: H(), payload: { clientId: 'nope', clientSecret: 'GOCSPX-abcdefghij' } })).statusCode).toBe(400);

    const realFetch = globalThis.fetch;
    const calls: string[] = [];
    const idToken = `x.${Buffer.from(JSON.stringify({ email: 'me@gmail.example' })).toString('base64url')}.y`;
    const spy = vi.spyOn(globalThis, 'fetch').mockImplementation(async (input, init) => {
      const u = String(input);
      calls.push(u);
      if (u.startsWith('https://oauth2.googleapis.com/token')) {
        const body = new URLSearchParams(String(init?.body));
        if (body.get('client_secret') === 'GOCSPX-wrong-secret') return new Response(JSON.stringify({ error: 'invalid_client' }), { status: 401 });
        if (body.get('code') === 'freemuse-setup-check') return new Response(JSON.stringify({ error: 'invalid_grant' }), { status: 400 });
        return new Response(JSON.stringify({ access_token: 'at', refresh_token: 'rt', expires_in: 3600, id_token: idToken, scope: 'x' }));
      }
      if (u.startsWith('https://oauth2.googleapis.com/revoke')) return new Response('{}');
      return realFetch(input, init);
    });
    try {
      const clientId = '1234-abc.apps.googleusercontent.com';
      const bad = await app.inject({ method: 'PUT', url: '/v1/setup/google', headers: H(), payload: { clientId, clientSecret: 'GOCSPX-wrong-secret' } });
      expect(bad.json().code).toBe('invalid_client');
      const ok = await app.inject({ method: 'PUT', url: '/v1/setup/google', headers: H(), payload: { clientId, clientSecret: 'GOCSPX-test-secret' } });
      expect(ok.json()).toEqual({ ok: true, verified: true });
      expect((await app.inject({ method: 'GET', url: '/v1/setup/google', headers: H() })).json()).toMatchObject({ configured: true, source: 'you' });
      const cons = (await app.inject({ method: 'GET', url: '/v1/connectors', headers: H() })).json().connectors;
      expect(cons.find((c: { id: string }) => c.id === 'gmail')).toMatchObject({ available: true, group: 'google', recommended: ['read', 'compose', 'send'] });
      // The app's secret is never listed with saved logins.
      expect(JSON.stringify((await app.inject({ method: 'GET', url: '/v1/vault', headers: H() })).json())).not.toContain('GOCSPX');

      const q = await app.inject({ method: 'POST', url: '/v1/connect/quick', headers: H(), payload: { preset: 'google' } });
      const auth = new URL(q.json().authorizeUrl);
      expect(auth.searchParams.get('client_id')).toBe(clientId);
      const scope = auth.searchParams.get('scope')!;
      for (const s of ['gmail.readonly', 'gmail.send', 'calendar.events', 'drive.readonly']) expect(scope).toContain(s);
      const state = auth.searchParams.get('state')!;

      const cb = await app.inject({ method: 'GET', url: `/v1/oauth/google/callback?state=${state}&code=abc` });
      expect(cb.headers.location).toContain('connected=Google');
      const rows = await db.q("SELECT connector, scopes, account, vault_id FROM connections WHERE user_id=$1 AND connector IN ('gmail','gcal','gdrive') ORDER BY connector", [userId]);
      expect(rows.map((r) => r.connector)).toEqual(['gcal', 'gdrive', 'gmail']);
      expect(new Set(rows.map((r) => r.vault_id)).size).toBe(1);
      expect(rows[0].account).toBe('me@gmail.example');

      const conns = (await app.inject({ method: 'GET', url: '/v1/connections', headers: H() })).json().connections as { id: string; connector: string }[];
      const id = (c: string) => conns.find((x) => x.connector === c)!.id;
      await app.inject({ method: 'DELETE', url: `/v1/connections/${id('gmail')}`, headers: H() });
      await app.inject({ method: 'DELETE', url: `/v1/connections/${id('gcal')}`, headers: H() });
      expect(calls.some((u) => u.includes('/revoke'))).toBe(false);
      await app.inject({ method: 'DELETE', url: `/v1/connections/${id('gdrive')}`, headers: H() });
      expect(calls.filter((u) => u.includes('/revoke'))).toHaveLength(1);

      await app.inject({ method: 'DELETE', url: '/v1/setup/google', headers: H() });
      expect((await app.inject({ method: 'GET', url: '/v1/setup/google', headers: H() })).json().configured).toBe(false);
    } finally {
      spy.mockRestore();
    }
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
