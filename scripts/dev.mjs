// Local dev runner: starts sentinel, api, agent and web with env from .env (Postgres + Redis must be running,
// e.g. `docker compose up -d postgres redis`). Usage: pnpm dev
import { spawn } from 'node:child_process';
import { existsSync, readFileSync } from 'node:fs';

const env = { ...process.env };
if (existsSync('.env')) {
  for (const line of readFileSync('.env', 'utf8').split('\n')) {
    const m = /^\s*([A-Z0-9_]+)\s*=\s*(.*?)\s*$/.exec(line);
    if (m && !line.trim().startsWith('#') && env[m[1]] === undefined) env[m[1]] = m[2].replace(/^"(.*)"$/, '$1');
  }
}
env.NODE_USE_ENV_PROXY ??= env.HTTPS_PROXY ? '1' : undefined;
if (!env.NODE_USE_ENV_PROXY) delete env.NODE_USE_ENV_PROXY;

const only = process.argv.slice(2);
const procs = [
  ['sentinel', ['--filter', '@muse/sentinel', 'start'], '35'],
  ['api', ['--filter', '@muse/api', 'start'], '36'],
  ['agent', ['--filter', '@muse/agent', 'start'], '33'],
  ['web', ['--filter', '@muse/web', only.includes('prod') ? 'start' : 'dev'], '32'],
].filter(([n]) => !only.length || only.includes(n) || only.includes('prod'));

const children = procs.map(([name, args, color]) => {
  const p = spawn('pnpm', args, { env, stdio: ['ignore', 'pipe', 'pipe'] });
  const out = (d) => process.stdout.write(String(d).split('\n').filter(Boolean).map((l) => `\x1b[${color}m[${name}]\x1b[0m ${l}\n`).join(''));
  p.stdout.on('data', out);
  p.stderr.on('data', out);
  p.on('exit', (code) => console.log(`[${name}] exited with ${code}`));
  return p;
});
const stop = () => { children.forEach((c) => c.kill('SIGTERM')); process.exit(0); };
process.on('SIGINT', stop);
process.on('SIGTERM', stop);
