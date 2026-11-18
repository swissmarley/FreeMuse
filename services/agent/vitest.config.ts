import { defineConfig } from 'vitest/config';

// Tests use their own Redis database so a running dev stack never consumes test jobs.
export default defineConfig({ test: { env: { REDIS_URL: process.env.TEST_REDIS_URL ?? 'redis://localhost:6379/15' }, testTimeout: 60_000, hookTimeout: 90_000 } });
