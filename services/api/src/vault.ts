/**
 * Encrypted secrets vault (envelope encryption, KMS-style):
 *  - each secret is encrypted with its own random data key (XSalsa20-Poly1305 secretbox),
 *  - the data key is wrapped with a key derived from the master key (VAULT_MASTER_KEY, or a KMS in production)
 *    and the owner/service, so rows can't be swapped between users.
 * Only the API's executor decrypts; the agent and the model never see plaintext secrets.
 */
import sodium from 'libsodium-wrappers';
import type { Db } from '@muse/db';

export type VaultSecret = Record<string, unknown>;

export class Vault {
  private ready = sodium.ready;
  readonly keyId = 'local-v1';
  constructor(private db: Db, private masterKeyB64: string) {
    if (Buffer.from(masterKeyB64, 'base64').length !== 32) throw new Error('VAULT_MASTER_KEY must be 32 bytes (base64)');
  }

  private async kek(userId: string, service: string): Promise<Uint8Array> {
    await this.ready;
    return sodium.crypto_generichash(32, sodium.from_string(`${userId}|${service}`), Buffer.from(this.masterKeyB64, 'base64'));
  }

  async put(userId: string, kind: 'login' | 'oauth' | 'payment', service: string, username: string, secret: VaultSecret): Promise<string> {
    await this.ready;
    const dek = sodium.crypto_secretbox_keygen();
    const nonce = sodium.randombytes_buf(sodium.crypto_secretbox_NONCEBYTES);
    const ct = sodium.crypto_secretbox_easy(sodium.from_string(JSON.stringify(secret)), nonce, dek);
    const dekNonce = sodium.randombytes_buf(sodium.crypto_secretbox_NONCEBYTES);
    const wrapped = sodium.crypto_secretbox_easy(dek, dekNonce, await this.kek(userId, service));
    sodium.memzero(dek);
    const r = await this.db.one(
      `INSERT INTO vault_items(user_id, kind, service, username, ciphertext, nonce, wrapped_dek, dek_nonce, key_id)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9)
       ON CONFLICT (user_id, kind, service, username) DO UPDATE SET ciphertext=EXCLUDED.ciphertext, nonce=EXCLUDED.nonce,
         wrapped_dek=EXCLUDED.wrapped_dek, dek_nonce=EXCLUDED.dek_nonce, key_id=EXCLUDED.key_id, created_at=now()
       RETURNING id`,
      [userId, kind, service, username, Buffer.from(ct), Buffer.from(nonce), Buffer.from(wrapped), Buffer.from(dekNonce), this.keyId],
    );
    return r.id;
  }

  async get<T extends VaultSecret>(userId: string, id: string): Promise<{ service: string; username: string; kind: string; secret: T } | null> {
    await this.ready;
    const r = await this.db.one('SELECT * FROM vault_items WHERE id=$1 AND user_id=$2', [id, userId]);
    if (!r) return null;
    const dek = sodium.crypto_secretbox_open_easy(new Uint8Array(r.wrapped_dek), new Uint8Array(r.dek_nonce), await this.kek(userId, r.service));
    const pt = sodium.crypto_secretbox_open_easy(new Uint8Array(r.ciphertext), new Uint8Array(r.nonce), dek);
    sodium.memzero(dek);
    return { service: r.service, username: r.username, kind: r.kind, secret: JSON.parse(sodium.to_string(pt)) as T };
  }

  /** Find a saved login whose service domain matches the given host (exact or subdomain). */
  async findLogin(userId: string, host: string): Promise<string | null> {
    const rows = await this.db.q("SELECT id, service FROM vault_items WHERE user_id=$1 AND kind='login'", [userId]);
    const h = host.toLowerCase();
    return rows.find((r) => h === r.service || h.endsWith('.' + r.service))?.id ?? null;
  }

  async list(userId: string): Promise<{ id: string; service: string; username: string; created_at: Date }[]> {
    return this.db.q("SELECT id, service, username, created_at FROM vault_items WHERE user_id=$1 AND kind='login' ORDER BY service", [userId]);
  }

  async remove(userId: string, id: string): Promise<void> {
    await this.db.q('DELETE FROM vault_items WHERE id=$1 AND user_id=$2', [id, userId]);
  }
}
