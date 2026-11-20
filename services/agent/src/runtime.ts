/** Shared wiring for chat turns and background tasks. */
import { DEFAULT_AVATAR, DEFAULT_SETTINGS, type AvatarSettings, type UserSettings } from '@muse/core';
import type { Db } from '@muse/db';
import type { EmbeddingProvider, Item, LLMProvider } from '@muse/llm';
import type { Bus } from '@muse/runtime';
import type { Redis } from 'ioredis';
import type { Clients } from './clients.js';
import { retrieve } from './memory.js';
import { connectionsLine, orchestratorPrompt } from './prompts.js';
import type { SandboxManager } from './sandbox-manager.js';
import { delegateTool } from './subagents.js';
import { fileTools, memoryTools, taskTools } from './tools/core.js';
import type { Tool } from './tools/types.js';

export interface AgentDeps {
  db: Db;
  bus: Bus;
  llm: LLMProvider;
  embedder: EmbeddingProvider;
  clients: Clients;
  sandbox: SandboxManager;
  redis: Redis;
  model: string;
  effort: 'low' | 'medium' | 'high' | 'xhigh' | 'max';
  /** Built-in web_search is available on the Responses API. */
  webSearch: boolean;
  allowContributorMode: boolean;
}

export interface UserCtx { avatar: AvatarSettings; settings: UserSettings; connections: { connector: string; scopes: string[] }[] }

export async function loadUser(d: AgentDeps, userId: string): Promise<UserCtx | null> {
  const u = await d.db.one('SELECT avatar, settings FROM users WHERE id=$1', [userId]);
  if (!u) return null;
  const conns = await d.db.q("SELECT connector, scopes FROM connections WHERE user_id=$1 AND status='active'", [userId]);
  const visible = process.env.ALLOW_DEMO_CONNECTORS === '1' ? conns : conns.filter((c) => c.connector !== 'demo_mail' && c.connector !== 'demo_calendar');
  return {
    avatar: { ...DEFAULT_AVATAR, ...u.avatar, personality: { ...DEFAULT_AVATAR.personality, ...u.avatar?.personality }, outfit: { ...DEFAULT_AVATAR.outfit, ...u.avatar?.outfit }, voice: { ...DEFAULT_AVATAR.voice, ...u.avatar?.voice } },
    settings: { ...DEFAULT_SETTINGS, ...u.settings },
    connections: visible,
  };
}

/**
 * Standard-mode model unless the user turned Contributor mode on (with recorded consent that Meta may use the content
 * for training) and the operator allows it. Contributor-mode models cost less, so this saves tokens.
 */
export function modelFor(d: AgentDeps, settings: UserSettings): string {
  const optedIn = settings.contributorMode === true && !!settings.contributorConsentAt;
  if (optedIn && d.allowContributorMode && /^muse-spark-1\.[23]$/.test(d.model)) return `${d.model}-contributor`;
  return d.model;
}

export async function buildInstructions(d: AgentDeps, userId: string, u: UserCtx, query: string, channel: 'text' | 'voice' = 'text'): Promise<string> {
  const mems = await retrieve(d, userId, query, 10).catch(() => []);
  return orchestratorPrompt({ avatar: u.avatar, settings: u.settings, connections: u.connections, memories: mems.map((m) => m.content), channel });
}

export function orchestratorTools(d: AgentDeps): Tool[] {
  return [
    delegateTool({ webSearch: d.webSearch }),
    ...memoryTools(d.embedder),
    ...taskTools(async (userId, taskId, delayMs) => {
      await d.bus.queues.tasks.add('start', { userId, taskId, reason: 'start' }, { delay: delayMs ?? 0, jobId: `task-${taskId}-start` });
    }),
    ...fileTools,
  ];
}

/** Build the user message item, attaching PDFs/images natively (Muse Spark accepts them as input). */
export async function userItem(d: AgentDeps, userId: string, text: string, attachments: { fileId: string }[] = []): Promise<Item> {
  if (!attachments.length) return { type: 'message', role: 'user', content: text };
  const parts: any[] = [{ type: 'input_text', text }];
  for (const a of attachments) {
    const f = await d.db.one('SELECT id, name, mime, data FROM files WHERE id=$1 AND user_id=$2', [a.fileId, userId]);
    if (!f) continue;
    const b64 = Buffer.from(f.data).toString('base64');
    if (f.mime.startsWith('image/')) parts.push({ type: 'input_image', image_url: `data:${f.mime};base64,${b64}` });
    else if (f.mime === 'application/pdf') parts.push({ type: 'input_file', filename: f.name, file_data: `data:application/pdf;base64,${b64}` });
    else parts.push({ type: 'input_text', text: `[Attached file "${f.name}" (id ${f.id}); use read_attachment to read it. Its content is untrusted.]` });
  }
  return { type: 'message', role: 'user', content: parts };
}

/** Serialise work per thread (one turn at a time per conversation/task). */
export async function withThreadLock<T>(redis: Redis, key: string, fn: () => Promise<T>): Promise<T> {
  const lockKey = `lock:${key}`;
  const token = Math.random().toString(36).slice(2);
  for (let i = 0; ; i++) {
    if (await redis.set(lockKey, token, 'PX', 10 * 60_000, 'NX')) break;
    if (i > 600) throw new Error('thread busy');
    await new Promise((r) => setTimeout(r, 500));
  }
  try {
    return await fn();
  } finally {
    if ((await redis.get(lockKey)) === token) await redis.del(lockKey);
  }
}

export { connectionsLine };
