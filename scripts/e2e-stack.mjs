// Starts an isolated full stack for browser e2e: scripted model, own ports, own Redis DB, local fixture sites.
import { spawn } from 'node:child_process';
import { generateKeyPairSync, randomBytes } from 'node:crypto';

const ed = () => {
  const { privateKey, publicKey } = generateKeyPairSync('ed25519');
  return [privateKey.export({ type: 'pkcs8', format: 'der' }).toString('base64'), publicKey.export({ type: 'spki', format: 'der' }).toString('base64')];
};
const [sp, sP] = ed();
const [ep, eP] = ed();
const rnd = () => randomBytes(24).toString('base64url');
const PORTS = { web: 3300, api: 4400, sentinel: 4500, egress: 8999, fixtures: 4600 };
const env = {
  ...process.env,
  NODE_ENV: 'development',
  LLM_PROVIDER: 'scripted',
  MODEL_API_KEY: '',
  DATABASE_URL: process.env.TEST_DATABASE_URL ?? 'postgres://muse:devpass@localhost:5432/muse',
  SENTINEL_DATABASE_URL: process.env.TEST_DATABASE_URL ?? 'postgres://muse:devpass@localhost:5432/muse',
  REDIS_URL: process.env.E2E_REDIS_URL ?? 'redis://localhost:6379/14',
  JWT_SECRET: rnd(), VAULT_MASTER_KEY: randomBytes(32).toString('base64'), SENTINEL_PRIVATE_KEY: sp, SENTINEL_PUBLIC_KEY: sP,
  EXECUTOR_PRIVATE_KEY: ep, EXECUTOR_PUBLIC_KEY: eP, SENTINEL_CLIENT_TOKEN: rnd(), INTERNAL_TOKEN: rnd(), SANDBOX_PROXY_SECRET: rnd(),
  API_PORT: String(PORTS.api), SENTINEL_PORT: String(PORTS.sentinel), EGRESS_PORT: String(PORTS.egress),
  API_PUBLIC_URL: `http://localhost:${PORTS.api}`, WEB_ORIGIN: `http://localhost:${PORTS.web}`, NEXT_PUBLIC_API_URL: `http://localhost:${PORTS.api}`,
  SENTINEL_URL: `http://localhost:${PORTS.sentinel}`, EXECUTOR_URL: `http://localhost:${PORTS.api}`,
  SANDBOX_DRIVER: 'local', EGRESS_PROXY_URL: `http://127.0.0.1:${PORTS.egress}`, EGRESS_ALLOW_PRIVATE_HOSTS: '127.0.0.1',
  FIXTURE_PORT: String(PORTS.fixtures), DEMO_DEALS_URL: `http://127.0.0.1:${PORTS.fixtures}/evil`, DEMO_TASK_MINUTES: '1',
  STT_PROVIDER: 'none', TTS_PROVIDER: 'device', NEXT_DIST_DIR: '.next-e2e', LOG_LEVEL: 'warn', NEXT_TELEMETRY_DISABLED: '1',
  // Not shown in the app. Lets this suite attach the local mailbox the scripted scenarios read.
  ALLOW_DEMO_CONNECTORS: '1',
};
const run = (name, cmd, args) => {
  const p = spawn(cmd, args, { env, stdio: ['ignore', 'pipe', 'pipe'] });
  const out = (d) => process.stdout.write(String(d).split('\n').filter(Boolean).map((l) => `[${name}] ${l}\n`).join(''));
  p.stdout.on('data', out);
  p.stderr.on('data', out);
  return p;
};
const children = [
  run('fixtures', 'pnpm', ['exec', 'tsx', 'services/sandbox/test/serve-fixtures.ts']),
  run('api', 'pnpm', ['--filter', '@muse/api', 'start']),
];
setTimeout(() => {
  children.push(run('sentinel', 'pnpm', ['--filter', '@muse/sentinel', 'start']));
  children.push(run('agent', 'pnpm', ['--filter', '@muse/agent', 'start']));
  children.push(run('web', 'pnpm', ['--filter', '@muse/web', 'exec', 'next', 'dev', '-p', String(PORTS.web)]));
}, 4000); // api applies migrations first
const stop = () => { children.forEach((c) => c.kill('SIGTERM')); process.exit(0); };
process.on('SIGINT', stop);
process.on('SIGTERM', stop);
