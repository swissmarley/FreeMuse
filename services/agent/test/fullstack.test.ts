/**
 * Full-stack test: real Postgres + Redis + Chromium, in-process Sentinel (policy + egress proxy) and API executor,
 * scripted model. Covers the five demo scenarios end to end.
 */
import { randomBytes } from 'node:crypto';
import type { AddressInfo } from 'node:net';
import type { FastifyInstance } from 'fastify';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createDb, migrate, type Db } from '@muse/db';
import { HashEmbedding, ScriptedProvider } from '@muse/llm';
import { Bus, redisConnection, type TaskJob, type TurnJob } from '@muse/runtime';
import { generateKeys, loadPrivate } from '@muse/security';
import { buildApp } from '../../api/src/app.js';
import type { ApiConfig } from '../../api/src/config.js';
import { buildRegistry } from '../../api/src/connectors/index.js';
import { Executor } from '../../api/src/executor.js';
import { Notifier } from '../../api/src/notify.js';
import { SandboxClient } from '../../api/src/sandbox.js';
import { Vault } from '../../api/src/vault.js';
import { createEgressProxy } from '../../sentinel/src/egress.js';
import { buildServer } from '../../sentinel/src/server.js';
import { startFixtures } from '../../sandbox/test/fixtures.js';
import { httpClients } from '../src/clients.js';
import { extractMemories } from '../src/memory.js';
import { handleTurn } from '../src/orchestrator.js';
import type { AgentDeps } from '../src/runtime.js';
import { SandboxManager } from '../src/sandbox-manager.js';
import { scriptedBrain } from '../src/scripted-brain.js';
import { runTask } from '../src/tasks.js';

const url = process.env.TEST_DATABASE_URL;

describe.skipIf(!url)('full stack (scripted model)', () => {
  const sKeys = generateKeys();
  const eKeys = generateKeys();
  const clientToken = randomBytes(16).toString('hex');
  const internalToken = randomBytes(16).toString('hex');
  const proxySecret = randomBytes(16).toString('hex');
  let db: Db;
  let bus: Bus;
  let api: FastifyInstance;
  let sentinel: FastifyInstance;
  let egress: ReturnType<typeof createEgressProxy>;
  let fixtures: { url: string; close: () => void };
  let deps: AgentDeps;
  let token = '';
  let userId = '';
  const redis = redisConnection();
  const sub = redisConnection();
  const H = () => ({ authorization: `Bearer ${token}` });
  let turnN = 0;
  const turn = async (text: string) => {
    const r = await api.inject({ method: 'POST', url: '/v1/conversations/default/messages', headers: H(), payload: { text } });
    const turnId = r.json().turnId;
    const job = await bus.queues.turns.getJob(turnId);
    await job!.remove();
    await handleTurn(deps, { userId, conversationId: 'default', turnId, kind: 'chat', text } as TurnJob);
    turnN++;
    const msgs = await db.q("SELECT text, meta FROM messages WHERE user_id=$1 AND role='assistant' ORDER BY created_at DESC LIMIT 1", [userId]);
    return msgs[0];
  };
  const auditKinds = async () => (await db.q('SELECT kind, summary FROM audit_events WHERE user_id=$1 ORDER BY seq', [userId]));

  beforeAll(async () => {
    db = createDb(url!);
    await migrate(db);
    bus = new Bus();
    await bus.queues.turns.obliterate({ force: true });
    await bus.queues.tasks.obliterate({ force: true });
    fixtures = await startFixtures();
    process.env.DEMO_DEALS_URL = `${fixtures.url}/evil`;

    sentinel = buildServer({ db, llm: null, privateKey: loadPrivate(sKeys.privateKey), publicKeyB64: sKeys.publicKey, clientToken, spendLimitCents: 50_000, globalBlocked: [] });
    await sentinel.listen({ port: 0, host: '127.0.0.1' });
    const sentinelUrl = `http://127.0.0.1:${(sentinel.server.address() as AddressInfo).port}`;
    egress = createEgressProxy({ secret: proxySecret, globalBlocked: [], allowPrivateHosts: ['127.0.0.1'], userBlocked: async () => [], log: (u, host, allowed, reason) => { void db.q('INSERT INTO egress_log(user_id, host, allowed, reason) VALUES ($1,$2,$3,$4)', [u, host, allowed, reason]); } });
    await new Promise<void>((r) => egress.listen(0, '127.0.0.1', r));
    const egressUrl = `http://127.0.0.1:${(egress.address() as AddressInfo).port}`;

    const cfg: ApiConfig = {
      port: 0, jwtSecret: randomBytes(32).toString('hex'), vaultMasterKey: randomBytes(32).toString('base64'), sentinelPublicKey: sKeys.publicKey, sentinelUrl,
      sentinelClientToken: clientToken, executorPrivateKey: eKeys.privateKey, internalToken, webOrigin: ['http://localhost:3000'], publicUrl: 'http://localhost:4000',
      vapidSubject: 'mailto:x@y.z', paymentProvider: 'virtual-card-stub', llmBaseUrl: 'http://127.0.0.1:9', sttProvider: 'none', tts: { provider: 'device' }, secureCookies: false,
    };
    const vault = new Vault(db, cfg.vaultMasterKey);
    const registry = buildRegistry(cfg);
    const sandboxClient = new SandboxClient(redis, cfg.executorPrivateKey);
    api = await buildApp({ db, bus, cfg, vault, executor: new Executor(db, cfg, registry, vault, sandboxClient), notifier: new Notifier(db, bus, cfg), registry, sandbox: sandboxClient, redis, sub });
    await api.listen({ port: 0, host: '127.0.0.1' });
    const apiUrl = `http://127.0.0.1:${(api.server.address() as AddressInfo).port}`;

    deps = {
      db, bus, redis, llm: new ScriptedProvider(scriptedBrain), embedder: new HashEmbedding(),
      clients: httpClients({ sentinelUrl, sentinelToken: clientToken, executorUrl: apiUrl, internalToken }),
      sandbox: new SandboxManager({ driver: 'local', image: '', network: '', egressProxyUrl: egressUrl, proxySecret, executorPublicKey: eKeys.publicKey, idleMs: 60_000 }, redis),
      model: 'muse-spark-1.3', effort: 'low', webSearch: false, allowContributorMode: false,
    };

    const s = await api.inject({ method: 'POST', url: '/v1/auth/signup', payload: { email: `fs${Date.now()}@x.io`, password: 'correct horse battery', birthDate: '1988-03-03', acceptTerms: true } });
    token = s.json().token;
    userId = s.json().me.id;
    await api.inject({ method: 'POST', url: '/v1/connectors/demo_mail/connect', headers: H(), payload: { scopes: ['read', 'compose', 'send'] } });
  }, 60_000);

  afterAll(async () => {
    await deps?.sandbox.closeAll();
    if (userId) await db.tx(async (c) => { await c.query("SET LOCAL muse.erase='on'"); await c.query('DELETE FROM users WHERE id=$1', [userId]); });
    await api?.close();
    await sentinel?.close();
    egress?.close();
    fixtures?.close();
    await bus.close();
    redis.disconnect();
    sub.disconnect();
    await db.close();
  });

  it('1) trip + host email: delegates in parallel, email waits for approval, approve → sent → agent reports', async () => {
    const reply = await turn('Plan my trip to Lisbon and draft the email to my host about my arrival.');
    if (process.env.DEBUG_FS) console.log(JSON.stringify(await auditKinds(), null, 1), (await db.q("SELECT item FROM turn_items WHERE user_id=$1 AND item->>'type'='function_call_output'", [userId])).map((r) => r.item.output.slice(0, 300)));
    expect(reply.text).toMatch(/Approvals/);
    const pending = await db.q("SELECT * FROM approvals WHERE user_id=$1 AND status='pending'", [userId]);
    expect(pending).toHaveLength(1);
    expect(pending[0].payload.to).toEqual(['lucia.ferrari@casa-lucia.example']);
    expect(pending[0].action_class).toBe('send');
    // nothing sent yet
    expect((await db.q("SELECT 1 FROM demo_mail WHERE user_id=$1 AND folder='sent'", [userId])).length).toBe(0);
    const kinds = (await auditKinds()).map((a) => a.kind);
    expect(kinds).toEqual(expect.arrayContaining(['chat.user', 'tool.call', 'subagent.start', 'action.proposed', 'sentinel.decision', 'approval.requested', 'task.created', 'subagent.report', 'chat.reply']));
    // user approves
    const ok = await api.inject({ method: 'POST', url: `/v1/approvals/${pending[0].id}`, headers: H(), payload: { decision: 'approve' } });
    expect(ok.json().approval.status).toBe('executed');
    expect((await db.q("SELECT to_addrs FROM demo_mail WHERE user_id=$1 AND folder='sent'", [userId]))[0].to_addrs).toContain('lucia.ferrari@casa-lucia.example');
    const resume = (await bus.queues.turns.getJobs(['waiting'])).find((j) => j.data.kind === 'resume' && j.data.userId === userId)!;
    await resume.remove();
    await handleTurn(deps, resume.data);
    const last = await db.one("SELECT text FROM messages WHERE user_id=$1 AND role='assistant' ORDER BY created_at DESC LIMIT 1", [userId]);
    expect(last.text).toMatch(/sent/);
  }, 60_000);

  it('4) background task survives "app closed": scheduled wake-up resumes and completes with a notification', async () => {
    const task = await db.one('SELECT * FROM tasks WHERE user_id=$1', [userId]);
    const startJob = await bus.queues.tasks.getJob(`task-${task.id}-start`);
    expect(startJob).toBeTruthy();
    await startJob!.remove();
    await runTask(deps, startJob!.data as TaskJob);
    let t = await db.one('SELECT * FROM tasks WHERE id=$1', [task.id]);
    expect(t.status).toBe('scheduled');
    expect(new Date(t.next_run_at).getTime()).toBeGreaterThan(Date.now());
    // The delayed wake-up job lives in Redis, independent of any client connection.
    const delayed = (await bus.queues.tasks.getJobs(['delayed'])).find((j) => j.data.taskId === task.id)!;
    expect(delayed.data.reason).toBe('scheduled');
    await delayed.remove();
    await runTask(deps, delayed.data as TaskJob);
    t = await db.one('SELECT * FROM tasks WHERE id=$1', [task.id]);
    expect(t.status).toBe('done');
    expect(t.result).toMatch(/€89/);
    const note = await db.one('SELECT * FROM notifications WHERE user_id=$1 AND title LIKE $2', [userId, 'Done:%']);
    expect(note.body).toMatch(/€89/);
  }, 60_000);

  it('5) prompt-injection email: scripted model obeys it, Sentinel blocks the exfiltration, nothing is sent', async () => {
    const before = (await db.q("SELECT 1 FROM demo_mail WHERE user_id=$1 AND folder='sent'", [userId])).length;
    const reply = await turn('Can you summarise my inbox?');
    expect(reply.text).toMatch(/Sentinel blocked/);
    expect((await db.q("SELECT 1 FROM demo_mail WHERE user_id=$1 AND folder='sent'", [userId])).length).toBe(before);
    expect((await db.q("SELECT 1 FROM approvals WHERE user_id=$1 AND payload->'to' ? 'recovery@account-verify.example'", [userId])).length).toBe(0);
    const deny = (await auditKinds()).find((a) => a.kind === 'sentinel.decision' && a.summary.startsWith('DENY'));
    expect(deny).toBeTruthy();
    const dec = await db.one("SELECT reasons FROM sentinel_decisions WHERE user_id=$1 AND decision='deny' ORDER BY created_at DESC LIMIT 1", [userId]);
    expect(JSON.stringify(dec.reasons)).toMatch(/planted by content/);
  }, 60_000);

  it('2) cheaper phone plan: parallel email + browser research via sandbox and egress proxy; hidden page instructions are flagged', async () => {
    const reply = await turn('Find me a cheaper phone plan.');
    expect(reply.text).toMatch(/€9\.99/);
    const items = await db.q("SELECT item FROM turn_items WHERE user_id=$1 AND item->>'type'='function_call_output' ORDER BY id DESC LIMIT 4", [userId]);
    const research = items.map((i) => i.item.output).find((o: string) => o.includes('Research agent'));
    expect(research).toBeTruthy();
    const egressRows = await db.q('SELECT host, allowed FROM egress_log WHERE user_id=$1', [userId]);
    expect(egressRows.some((r) => r.host === '127.0.0.1' && r.allowed)).toBe(true);
    const opened = (await auditKinds()).find((a) => a.kind === 'browser.open');
    expect(opened?.summary).toContain('/evil');
  }, 90_000);

  it('3) saved recipe → grocery list', async () => {
    const reply = await turn('Turn my saved recipe into a grocery list.');
    expect(reply.text).toMatch(/- \[ \] 320 g arborio rice/);
    expect(reply.text).toMatch(/parmesan/);
  }, 60_000);

  it('memory: extraction after chat, remember tool, and "forget X"', async () => {
    await turn('My friend Anna is vegetarian now, and I always want a window seat.');
    const added = await extractMemories({ db, llm: deps.llm, embedder: deps.embedder, bus, redis, clients: deps.clients }, userId);
    expect(added).toBeGreaterThanOrEqual(2);
    let mems = (await db.q('SELECT content FROM memories WHERE user_id=$1', [userId])).map((m) => m.content);
    expect(mems).toEqual(expect.arrayContaining(['Anna is vegetarian', 'Prefers window seats on flights']));
    const r = await turn('Please forget that Anna is vegetarian.');
    expect(r.text).toMatch(/forgotten/i);
    mems = (await db.q('SELECT content FROM memories WHERE user_id=$1', [userId])).map((m) => m.content);
    expect(mems).not.toContain('Anna is vegetarian');
    expect(mems).toContain('Prefers window seats on flights');
  }, 60_000);

  it('audit chain stays valid and secrets never appear', async () => {
    const a = await api.inject({ method: 'GET', url: '/v1/audit', headers: H() });
    expect(a.json().chainValid).toBe(true);
    expect(a.json().events.length).toBeGreaterThan(20);
    expect(a.payload).not.toMatch(/sk_live|password":"[^[]/);
  });
});
