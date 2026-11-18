/**
 * Ed25519-signed tokens.
 * - Sentinel decisions: signed by the Sentinel (only it holds SENTINEL_PRIVATE_KEY).
 * - Executor grants: signed by the API executor after it verified a Sentinel decision (+ user approval when asked);
 *   the sandbox only performs sensitive browser actions that carry a valid grant.
 */
import { createPrivateKey, createPublicKey, generateKeyPairSync, sign, verify, type KeyObject } from 'node:crypto';

export interface SignedClaims { iss: 'sentinel' | 'executor'; u: string; h: string; d: 'allow' | 'deny' | 'ask'; exp: number; r?: string[] }

const b64u = (b: Buffer) => b.toString('base64url');

export function generateKeys(): { privateKey: string; publicKey: string } {
  const { privateKey, publicKey } = generateKeyPairSync('ed25519');
  return {
    privateKey: privateKey.export({ type: 'pkcs8', format: 'der' }).toString('base64'),
    publicKey: publicKey.export({ type: 'spki', format: 'der' }).toString('base64'),
  };
}

export function loadPrivate(b64: string): KeyObject {
  return createPrivateKey({ key: Buffer.from(b64, 'base64'), format: 'der', type: 'pkcs8' });
}
export function loadPublic(b64: string): KeyObject {
  return createPublicKey({ key: Buffer.from(b64, 'base64'), format: 'der', type: 'spki' });
}

export function signClaims(key: KeyObject, claims: SignedClaims): string {
  const body = b64u(Buffer.from(JSON.stringify(claims)));
  return body + '.' + b64u(sign(null, Buffer.from(body), key));
}

export function verifyClaims(key: KeyObject, token: string, expect: { iss: SignedClaims['iss']; u: string; h: string }): SignedClaims | null {
  const [body, sig] = token.split('.');
  if (!body || !sig) return null;
  if (!verify(null, Buffer.from(body), key, Buffer.from(sig, 'base64url'))) return null;
  let c: SignedClaims;
  try { c = JSON.parse(Buffer.from(body, 'base64url').toString()); } catch { return null; }
  if (c.iss !== expect.iss || c.u !== expect.u || c.h !== expect.h) return null;
  if (c.exp < Date.now()) return null;
  return c;
}
