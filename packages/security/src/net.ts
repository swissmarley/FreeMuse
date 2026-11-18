import { isIP } from 'node:net';

/** SSRF guard: true for loopback, private, link-local, CGNAT, multicast and reserved ranges. */
export function isPrivateAddress(ip: string): boolean {
  const v = isIP(ip);
  if (v === 4) {
    const [a, b] = ip.split('.').map(Number) as [number, number];
    return a === 10 || a === 127 || a === 0 || (a === 169 && b === 254) || (a === 172 && b >= 16 && b <= 31) || (a === 192 && b === 168) || (a === 100 && b >= 64 && b <= 127) || a >= 224;
  }
  if (v === 6) {
    const l = ip.toLowerCase();
    if (l.startsWith('::ffff:')) return isPrivateAddress(l.slice(7));
    return l === '::1' || l === '::' || l.startsWith('fc') || l.startsWith('fd') || l.startsWith('fe80') || l.startsWith('ff');
  }
  return false;
}

export function hostMatches(host: string, patterns: string[]): boolean {
  const h = host.toLowerCase().replace(/\.$/, '');
  return patterns.some((p) => {
    const q = p.toLowerCase().trim().replace(/^\*\./, '');
    return q && (h === q || h.endsWith('.' + q));
  });
}

import { createHmac } from 'node:crypto';
/** Per-user credential for the Sentinel egress proxy (HMAC so the proxy needs no lookup table). */
export function proxyToken(secret: string, userId: string): string {
  return createHmac('sha256', secret).update('egress:' + userId).digest('hex');
}
