/**
 * Egress proxy: the ONLY network route out of sandbox browsers (they sit on an internal Docker network).
 * Authenticates each sandbox (HMAC token per user), blocks private/link-local ranges (SSRF) and blocked domains,
 * pins the resolved IP (no DNS rebinding between check and connect) and logs hosts to egress_log.
 */
import { timingSafeEqual } from 'node:crypto';
import { lookup } from 'node:dns/promises';
import http from 'node:http';
import net from 'node:net';
import { hostMatches, isPrivateAddress, proxyToken } from '@muse/security';
export { proxyToken };

export interface EgressOptions {
  secret: string;
  globalBlocked: string[];
  /** Hosts allowed even if private (e.g. local test fixtures). */
  allowPrivateHosts: string[];
  userBlocked: (userId: string) => Promise<string[]>;
  log: (userId: string, host: string, allowed: boolean, reason: string) => void;
  /** Optional upstream proxy (http://host:port) for environments that require one. */
  upstream?: string;
}

function authUser(secret: string, header: string | undefined): string | null {
  if (!header?.startsWith('Basic ')) return null;
  const [user, tok] = Buffer.from(header.slice(6), 'base64').toString().split(':');
  if (!user || !tok) return null;
  const want = Buffer.from(proxyToken(secret, user));
  const got = Buffer.from(tok);
  return want.length === got.length && timingSafeEqual(want, got) ? user : null;
}

export async function checkHost(host: string, userId: string, o: EgressOptions): Promise<{ ok: true; ip: string } | { ok: false; reason: string }> {
  const h = host.toLowerCase().replace(/^\[|\]$/g, '');
  if (hostMatches(h, o.globalBlocked)) return { ok: false, reason: 'globally blocked domain' };
  if (hostMatches(h, await o.userBlocked(userId))) return { ok: false, reason: 'blocked by user' };
  const allowPrivate = hostMatches(h, o.allowPrivateHosts);
  let ip = h;
  if (!net.isIP(h)) {
    try { ip = (await lookup(h)).address; } catch { return o.upstream ? { ok: true, ip: h } : { ok: false, reason: 'dns failure' }; }
  }
  if (isPrivateAddress(ip) && !allowPrivate) return { ok: false, reason: 'private network address blocked' };
  return { ok: true, ip };
}

function connectVia(upstream: string, host: string, port: number): Promise<net.Socket> {
  const u = new URL(upstream);
  return new Promise((resolve, reject) => {
    const s = net.connect(Number(u.port || 80), u.hostname, () => {
      s.write(`CONNECT ${host}:${port} HTTP/1.1\r\nHost: ${host}:${port}\r\n\r\n`);
    });
    let buf = '';
    const onData = (d: Buffer) => {
      buf += d.toString('latin1');
      const end = buf.indexOf('\r\n\r\n');
      if (end < 0) return;
      s.off('data', onData);
      if (/^HTTP\/1\.[01] 200/.test(buf)) resolve(s);
      else { s.destroy(); reject(new Error('upstream refused: ' + buf.split('\r\n')[0])); }
    };
    s.on('data', onData);
    s.on('error', reject);
  });
}

export function createEgressProxy(o: EgressOptions): http.Server {
  const seen = new Map<string, number>();
  const logOnce = (u: string, host: string, allowed: boolean, reason: string) => {
    const k = `${u}|${host}|${allowed}`;
    const now = Date.now();
    if ((seen.get(k) ?? 0) > now - 600_000) return;
    seen.set(k, now);
    o.log(u, host, allowed, reason);
  };

  const server = http.createServer(async (req, res) => {
    // Plain-HTTP forward proxying (absolute URI).
    const user = authUser(o.secret, req.headers['proxy-authorization'] as string | undefined);
    if (!user) { res.writeHead(407, { 'proxy-authenticate': 'Basic realm="sentinel"' }).end(); return; }
    let target: URL;
    try { target = new URL(req.url ?? ''); } catch { res.writeHead(400).end(); return; }
    const chk = await checkHost(target.hostname, user, o);
    logOnce(user, target.hostname, chk.ok, chk.ok ? 'allowed' : chk.reason);
    if (!chk.ok) { res.writeHead(403, { 'content-type': 'text/plain' }).end(`Blocked by Sentinel: ${chk.reason}`); return; }
    const headers = { ...req.headers };
    delete headers['proxy-authorization'];
    const opts: http.RequestOptions = o.upstream
      ? { host: new URL(o.upstream).hostname, port: Number(new URL(o.upstream).port || 80), path: target.href, method: req.method, headers }
      : { host: chk.ip, port: Number(target.port || 80), path: target.pathname + target.search, method: req.method, headers: { ...headers, host: target.host } };
    const up = http.request(opts, (ur) => { res.writeHead(ur.statusCode ?? 502, ur.headers); ur.pipe(res); });
    up.on('error', () => res.writeHead(502).end());
    req.pipe(up);
  });

  server.on('connect', async (req, client: net.Socket, head) => {
    const user = authUser(o.secret, req.headers['proxy-authorization'] as string | undefined);
    if (!user) { client.end('HTTP/1.1 407 Proxy Authentication Required\r\nProxy-Authenticate: Basic realm="sentinel"\r\n\r\n'); return; }
    const [host, portStr] = (req.url ?? '').split(/:(?=\d+$)/);
    const port = Number(portStr || 443);
    if (!host) { client.end('HTTP/1.1 400 Bad Request\r\n\r\n'); return; }
    const chk = await checkHost(host, user, o);
    logOnce(user, host, chk.ok, chk.ok ? 'allowed' : chk.reason);
    if (!chk.ok) { client.end(`HTTP/1.1 403 Forbidden\r\ncontent-type: text/plain\r\n\r\nBlocked by Sentinel: ${chk.reason}`); return; }
    try {
      const upstream = o.upstream && !hostMatches(host, o.allowPrivateHosts) ? await connectVia(o.upstream, host, port) : await new Promise<net.Socket>((res, rej) => {
        const s = net.connect(port, chk.ip, () => res(s));
        s.on('error', rej);
      });
      client.write('HTTP/1.1 200 Connection Established\r\n\r\n');
      if (head?.length) upstream.write(head);
      upstream.pipe(client);
      client.pipe(upstream);
      upstream.on('error', () => client.destroy());
      client.on('error', () => upstream.destroy());
    } catch {
      client.end('HTTP/1.1 502 Bad Gateway\r\n\r\n');
    }
  });
  return server;
}
