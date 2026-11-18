/**
 * Sandbox browser control server (one per user). Runs Chromium whose only network route is the Sentinel egress
 * proxy. Safe operations (open/snapshot/type/select/non-sensitive clicks) are allowed with the per-sandbox token;
 * sensitive ones (form submits, buy/send buttons, credential fill) additionally need an executor grant signed with
 * EXECUTOR_PRIVATE_KEY, which only the API executor holds after Sentinel + user approval.
 */
import { createHash } from 'node:crypto';
import http from 'node:http';
import type { AddressInfo } from 'node:net';
import { type Browser, type BrowserContext, chromium, type Page } from 'playwright';
import { canonical, loadPublic, verifyClaims } from '@muse/security';
import { classifyInPage, snapshotInPage } from './snapshot.js';

export interface SandboxOptions {
  userId: string;
  controlToken: string;
  executorPublicKey: string;
  proxy?: { server: string; username: string; password: string };
  host?: string;
  port?: number;
  executablePath?: string;
  maxSnapshotChars?: number;
}

export function grantHash(userId: string, op: string, args: Record<string, unknown>): string {
  return createHash('sha256').update(canonical({ u: userId, op, args })).digest('hex');
}

class HttpError extends Error {
  constructor(public status: number, public code: string, message: string) { super(message); }
}

export interface RunningSandbox { url: string; close(): Promise<void>; lastUsed: () => number }

export async function startSandbox(o: SandboxOptions): Promise<RunningSandbox> {
  const execKey = loadPublic(o.executorPublicKey);
  const browser: Browser = await chromium.launch({
    executablePath: o.executablePath,
    proxy: o.proxy,
    // '<-loopback>' removes Chromium's implicit proxy bypass for localhost: every request goes via Sentinel.
    args: ['--disable-dev-shm-usage', '--no-first-run', '--disable-background-networking', '--disable-sync', '--disable-default-apps', ...(o.proxy ? ['--proxy-bypass-list=<-loopback>'] : [])],
  });
  const context: BrowserContext = await browser.newContext({
    userAgent: 'Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/140 Safari/537.36 PersonalAgent/1.0',
    acceptDownloads: false,
    serviceWorkers: 'block',
    permissions: [],
    locale: 'en-GB',
  });
  // tsx/esbuild may wrap functions with __name(); make that a no-op inside pages so page.evaluate works.
  await context.addInitScript('window.__name = window.__name || ((f) => f);');
  let page: Page = await context.newPage();
  let lastUsed = Date.now();
  const max = o.maxSnapshotChars ?? 14_000;

  const snap = async () => {
    await page.waitForLoadState('domcontentloaded', { timeout: 10_000 }).catch(() => {});
    return page.evaluate(snapshotInPage, max);
  };
  const requireGrant = (req: http.IncomingMessage, op: string, args: Record<string, unknown>) => {
    const g = req.headers['x-executor-grant'];
    if (typeof g !== 'string' || !verifyClaims(execKey, g, { iss: 'executor', u: o.userId, h: grantHash(o.userId, op, args) })) {
      throw new HttpError(409, 'needs_approval', 'This action needs your approval first');
    }
  };
  const locate = (ref: unknown) => {
    if (typeof ref !== 'string' || !/^r\d+$/.test(ref)) throw new HttpError(400, 'bad_ref', 'Unknown element ref');
    return page.locator(`[data-muse-ref="${ref}"]`).first();
  };

  const ops: Record<string, (args: Record<string, unknown>, req: http.IncomingMessage) => Promise<unknown>> = {
    async open(a) {
      const u = new URL(String(a.url));
      if (u.protocol !== 'http:' && u.protocol !== 'https:') throw new HttpError(400, 'bad_url', 'Only http(s) URLs');
      const res = await page.goto(u.toString(), { waitUntil: 'domcontentloaded', timeout: 30_000 }).catch((e: Error) => {
        throw new HttpError(502, 'navigation_failed', e.message.split('\n')[0] ?? 'navigation failed');
      });
      if (res && res.status() === 403 && (await res.text().catch(() => '')).startsWith('Blocked by Sentinel')) throw new HttpError(403, 'blocked', await res.text());
      return snap();
    },
    snapshot: () => snap(),
    async current() { return { url: page.url(), title: await page.title() }; },
    async back() { await page.goBack({ timeout: 15_000 }).catch(() => {}); return snap(); },
    async scroll(a) { await page.mouse.wheel(0, a.direction === 'up' ? -800 : 800); return snap(); },
    async click(a, req) {
      const c = await page.evaluate(classifyInPage, String(a.ref));
      if (!c.found) throw new HttpError(404, 'not_found', 'Element not found; take a new snapshot');
      if (c.sensitive) {
        // Grants bind to the exact page URL the user saw in the approval card.
        requireGrant(req, 'click', a);
        if (a.expectUrl && page.url() !== a.expectUrl) throw new HttpError(409, 'page_changed', 'The page changed since approval');
      }
      await locate(a.ref).click({ timeout: 10_000 });
      await page.waitForTimeout(400);
      return snap();
    },
    async classify(a) { return page.evaluate(classifyInPage, String(a.ref)); },
    async type(a) {
      const c = await page.evaluate(classifyInPage, String(a.ref));
      if (!c.found) throw new HttpError(404, 'not_found', 'Element not found');
      if (c.isPassword) throw new HttpError(403, 'password_field', 'Passwords can only be filled from the vault (login tool)');
      await locate(a.ref).fill(String(a.text ?? '').slice(0, 5000), { timeout: 10_000 });
      return { ok: true };
    },
    async select(a) { await locate(a.ref).selectOption({ label: String(a.value) }, { timeout: 10_000 }); return snap(); },
    async fill_login(a, req) {
      requireGrant(req, 'fill_login', a);
      const host = new URL(page.url()).hostname;
      const expect = String(a.expectHost);
      if (!(host === expect || host.endsWith('.' + expect))) throw new HttpError(409, 'domain_mismatch', 'Page domain does not match the saved login');
      const pw = page.locator('input[type=password]').first();
      if (!(await pw.count())) throw new HttpError(404, 'no_login_form', 'No password field on this page');
      const user = page.locator('input[type=email], input[autocomplete=username], input[name*=user i], input[name*=email i], input[type=text]').first();
      if (await user.count()) await user.fill(String(a.username));
      await pw.fill(String(a.password));
      return { url: page.url(), filled: true };
    },
    async screenshot() {
      const png = await page.screenshot({ type: 'png', mask: [page.locator('input[type=password]')], maskColor: '#000' });
      return { png: png.toString('base64') };
    },
    async reset() {
      await page.close().catch(() => {});
      page = await context.newPage();
      return { ok: true };
    },
  };

  const server = http.createServer(async (req, res) => {
    const send = (status: number, body: unknown) => { res.writeHead(status, { 'content-type': 'application/json' }); res.end(JSON.stringify(body)); };
    try {
      if (req.headers.authorization !== `Bearer ${o.controlToken}`) throw new HttpError(401, 'unauthorized', 'bad token');
      const op = (req.url ?? '').replace(/^\//, '');
      const fn = ops[op];
      if (req.method !== 'POST' || !fn) throw new HttpError(404, 'not_found', 'unknown op');
      const chunks: Buffer[] = [];
      for await (const c of req) chunks.push(c as Buffer);
      const args = chunks.length ? JSON.parse(Buffer.concat(chunks).toString() || '{}') : {};
      lastUsed = Date.now();
      send(200, await fn(args, req));
    } catch (e) {
      if (e instanceof HttpError) send(e.status, { code: e.code, message: e.message });
      else send(500, { code: 'error', message: (e as Error).message.split('\n')[0] });
    }
  });
  await new Promise<void>((r) => server.listen(o.port ?? 0, o.host ?? '127.0.0.1', r));
  const addr = server.address() as AddressInfo;
  return {
    url: `http://${o.host === '0.0.0.0' ? '127.0.0.1' : (o.host ?? '127.0.0.1')}:${addr.port}`,
    lastUsed: () => lastUsed,
    async close() {
      server.close();
      await context.close().catch(() => {});
      await browser.close().catch(() => {});
    },
  };
}
