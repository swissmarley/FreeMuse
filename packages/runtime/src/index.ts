import { Queue, type JobsOptions } from 'bullmq';
import { Redis } from 'ioredis';
import pino from 'pino';
import type { StreamEvent } from '@muse/core';

/** Logger that never prints secrets (keys, tokens, passwords, auth headers). */
export const log = pino({
  level: process.env.LOG_LEVEL ?? 'info',
  redact: {
    paths: ['*.password', '*.apiKey', '*.token', '*.authorization', 'headers.authorization', 'headers.cookie', '*.MODEL_API_KEY', '*.secret', 'req.headers.authorization', 'req.headers.cookie'],
    censor: '[redacted]',
  },
});

export function redisConnection(url = process.env.REDIS_URL ?? 'redis://localhost:6379'): Redis {
  return new Redis(url, { maxRetriesPerRequest: null });
}

export const QUEUES = { turns: 'turns', tasks: 'tasks', memory: 'memory' } as const;

export interface TurnJob { userId: string; conversationId: string; turnId: string; kind: 'chat' | 'resume'; text?: string; note?: string; attachments?: { fileId: string }[]; /** 'voice' = the user is on a voice call. */ channel?: 'text' | 'voice' }
export interface TaskJob { userId: string; taskId: string; reason: 'start' | 'scheduled' | 'resume'; note?: string }
export interface MemoryJob { userId: string; kind: 'extract' | 'reflect' | 'proactive' | 'embed'; memoryId?: string; conversationId?: string }

export class Bus {
  readonly pub: Redis;
  readonly queues: { turns: Queue<TurnJob>; tasks: Queue<TaskJob>; memory: Queue<MemoryJob> };
  constructor(url?: string) {
    this.pub = redisConnection(url);
    const connection = redisConnection(url);
    const defaultJobOptions: JobsOptions = { attempts: 3, backoff: { type: 'exponential', delay: 2000 }, removeOnComplete: 500, removeOnFail: 1000 };
    this.queues = {
      turns: new Queue<TurnJob>(QUEUES.turns, { connection, defaultJobOptions }),
      tasks: new Queue<TaskJob>(QUEUES.tasks, { connection, defaultJobOptions }),
      memory: new Queue<MemoryJob>(QUEUES.memory, { connection, defaultJobOptions: { ...defaultJobOptions, attempts: 2 } }),
    };
  }
  channel(userId: string) { return `events:${userId}`; }
  async emit(userId: string, e: StreamEvent): Promise<void> {
    await this.pub.publish(this.channel(userId), JSON.stringify(e));
  }
  async close() {
    await Promise.all([this.queues.turns.close(), this.queues.tasks.close(), this.queues.memory.close()]);
    this.pub.disconnect();
  }
}

/** Read a required env var (never logs the value). */
export function env(name: string, fallback?: string): string {
  const v = process.env[name] ?? fallback;
  if (v === undefined || v === '') throw new Error(`Missing required env var ${name}`);
  return v;
}
