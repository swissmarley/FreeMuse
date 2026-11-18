// Generates all local secrets and prints them as .env lines. Usage: pnpm gen:keys >> .env
import { generateKeyPairSync, randomBytes, createECDH } from 'node:crypto';

const ed = () => {
  const { privateKey, publicKey } = generateKeyPairSync('ed25519');
  return [privateKey.export({ type: 'pkcs8', format: 'der' }).toString('base64'), publicKey.export({ type: 'spki', format: 'der' }).toString('base64')];
};
const rnd = (n = 32) => randomBytes(n).toString('base64url');
const [sPriv, sPub] = ed();
const [ePriv, ePub] = ed();
const ecdh = createECDH('prime256v1');
ecdh.generateKeys();
const lines = {
  JWT_SECRET: rnd(48),
  VAULT_MASTER_KEY: randomBytes(32).toString('base64'),
  SENTINEL_PRIVATE_KEY: sPriv,
  SENTINEL_PUBLIC_KEY: sPub,
  EXECUTOR_PRIVATE_KEY: ePriv,
  EXECUTOR_PUBLIC_KEY: ePub,
  SENTINEL_CLIENT_TOKEN: rnd(),
  INTERNAL_TOKEN: rnd(),
  SANDBOX_PROXY_SECRET: rnd(),
  VAPID_PUBLIC_KEY: ecdh.getPublicKey().toString('base64url'),
  VAPID_PRIVATE_KEY: ecdh.getPrivateKey().toString('base64url'),
};
for (const [k, v] of Object.entries(lines)) console.log(`${k}=${v}`);
