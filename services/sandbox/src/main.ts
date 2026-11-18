/** Container entrypoint: one sandbox per container, configured by env (no host mounts, no secrets except tokens). */
import { startSandbox } from './server.js';

const env = (k: string) => {
  const v = process.env[k];
  if (!v) throw new Error(`missing ${k}`);
  return v;
};

const sb = await startSandbox({
  userId: env('SANDBOX_USER_ID'),
  controlToken: env('CONTROL_TOKEN'),
  executorPublicKey: env('EXECUTOR_PUBLIC_KEY'),
  proxy: process.env.PROXY_SERVER ? { server: env('PROXY_SERVER'), username: env('PROXY_USERNAME'), password: env('PROXY_PASSWORD') } : undefined,
  host: '0.0.0.0',
  port: Number(process.env.CONTROL_PORT ?? 7000),
});
console.log(`sandbox ready on ${sb.url}`);
process.on('SIGTERM', async () => { await sb.close(); process.exit(0); });
