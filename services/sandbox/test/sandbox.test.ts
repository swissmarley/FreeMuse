import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { generateKeys, loadPrivate, signClaims } from '@muse/security';
import { grantHash, startSandbox, type RunningSandbox } from '../src/server.js';
import { startFixtures } from './fixtures.js';

const keys = generateKeys();
const USER = 'user-1';

describe('sandbox browser', () => {
  let sb: RunningSandbox;
  let fx: { url: string; close: () => void };
  const call = async (op: string, args: Record<string, unknown> = {}, grant?: string) => {
    const r = await fetch(`${sb.url}/${op}`, { method: 'POST', headers: { authorization: 'Bearer ctl', 'content-type': 'application/json', ...(grant ? { 'x-executor-grant': grant } : {}) }, body: JSON.stringify(args) });
    return { status: r.status, body: await r.json() };
  };
  const grant = (op: string, args: Record<string, unknown>, user = USER) => signClaims(loadPrivate(keys.privateKey), { iss: 'executor', u: user, h: grantHash(user, op, args), d: 'allow', exp: Date.now() + 60_000 });

  beforeAll(async () => {
    fx = await startFixtures();
    sb = await startSandbox({ userId: USER, controlToken: 'ctl', executorPublicKey: keys.publicKey });
  }, 60_000);
  afterAll(async () => { await sb?.close(); fx?.close(); });

  it('rejects calls without the control token', async () => {
    const r = await fetch(`${sb.url}/snapshot`, { method: 'POST' });
    expect(r.status).toBe(401);
  });

  it('opens pages and returns a text snapshot with refs', async () => {
    const r = await call('open', { url: `${fx.url}/recipe` });
    expect(r.status).toBe(200);
    expect(r.body.title).toBe('Lemon pasta');
    expect(r.body.text).toContain('200 g spaghetti');
    expect(r.body.text).toMatch(/\[r\d+\] link "Buy ingredients"/);
  });

  it('refuses non-http urls', async () => {
    expect((await call('open', { url: 'file:///etc/passwd' })).status).toBe(400);
  });

  it('blocks sensitive clicks without an executor grant, allows with a valid one', async () => {
    const page = await call('open', { url: `${fx.url}/shop` });
    const order = /\[(r\d+)\] button "Place order"/.exec(page.body.text)![1]!;
    const search = /\[(r\d+)\] button "Search"/.exec(page.body.text)![1]!;
    const denied = await call('click', { ref: order });
    expect(denied.status).toBe(409);
    expect(denied.body.code).toBe('needs_approval');
    // grant for a different element is rejected
    expect((await call('click', { ref: order, expectUrl: `${fx.url}/shop` }, grant('click', { ref: search, expectUrl: `${fx.url}/shop` }))).status).toBe(409);
    // grant signed by someone else is rejected
    const forged = signClaims(loadPrivate(generateKeys().privateKey), { iss: 'executor', u: USER, h: grantHash(USER, 'click', { ref: order }), d: 'allow', exp: Date.now() + 60_000 });
    expect((await call('click', { ref: order }, forged)).status).toBe(409);
    const args = { ref: order, expectUrl: `${fx.url}/shop` };
    const ok = await call('click', args, grant('click', args));
    expect(ok.status).toBe(200);
    expect(ok.body.title).toBe('Order placed');
  });

  it('allows harmless GET search submits without approval', async () => {
    const page = await call('open', { url: `${fx.url}/shop` });
    const search = /\[(r\d+)\] button "Search"/.exec(page.body.text)![1]!;
    expect((await call('click', { ref: search })).status).toBe(200);
  });

  it('never types into password fields; login needs a grant and matching domain', async () => {
    const page = await call('open', { url: `${fx.url}/login` });
    expect(page.body.text).toContain('password field');
    const pwRef = /\[(r\d+)\] password field/.exec(page.body.text)![1]!;
    expect((await call('type', { ref: pwRef, text: 'secret' })).status).toBe(403);
    const args = { username: 'me@x.io', password: 's3cret!', expectHost: '127.0.0.1' };
    expect((await call('fill_login', args)).status).toBe(409);
    expect((await call('fill_login', { ...args, expectHost: 'bank.example' }, grant('fill_login', { ...args, expectHost: 'bank.example' }))).status).toBe(409);
    const ok = await call('fill_login', args, grant('fill_login', args));
    expect(ok.status).toBe(200);
    const snap = await call('snapshot');
    expect(JSON.stringify(snap.body)).not.toContain('s3cret!');
    const shot = await call('screenshot');
    expect(shot.body.png.length).toBeGreaterThan(100);
  });
}, 120_000);
