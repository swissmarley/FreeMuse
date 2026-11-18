import type { StreamEvent } from '@muse/core';
import type { AuditInput, Db } from '@muse/db';
import { audit } from '@muse/db';
import type { LLMProvider } from '@muse/llm';
import type { Bus } from '@muse/runtime';
import type { Clients } from './clients.js';
import type { SandboxManager } from './sandbox-manager.js';

/** Everything a tool needs, scoped to one run (a chat turn, a task run, or a subagent within them). */
export interface RunContext {
  userId: string;
  thread: string; // conv:<id> | task:<id>
  conversationId: string;
  taskId: string | null;
  turnId: string;
  /** The user's own words that started this run (trusted). */
  userRequest: string;
  /** Untrusted sources seen in this run, shared with subagents. */
  taint: Set<string>;
  untrusted: string[];
  db: Db;
  bus: Bus;
  llm: LLMProvider;
  model?: string;
  clients: Clients;
  sandbox: SandboxManager;
  /** Name of the (sub)agent currently acting, for UI labels and audit actor. */
  agentName: string;
  isSubagent: boolean;
  /** Approvals created during this run. */
  pendingApprovals: string[];
  emit(e: StreamEvent): Promise<void>;
  audit(e: Omit<AuditInput, 'userId' | 'taskId'> & { taskId?: string | null }): Promise<void>;
  signal?: AbortSignal;
}

export function makeContext(base: Omit<RunContext, 'emit' | 'audit' | 'taint' | 'untrusted' | 'pendingApprovals' | 'agentName' | 'isSubagent'> & Partial<Pick<RunContext, 'agentName'>>): RunContext {
  const ctx: RunContext = {
    ...base,
    agentName: base.agentName ?? 'main',
    isSubagent: false,
    taint: new Set(),
    untrusted: [],
    pendingApprovals: [],
    emit: (e) => base.bus.emit(base.userId, e),
    audit: async (e) => { await audit(base.db, { ...e, userId: base.userId, taskId: e.taskId ?? base.taskId }); },
  };
  return ctx;
}

/** Child context for a subagent: shares taint (so provenance follows data) but has its own name. */
export function childContext(parent: RunContext, agentName: string): RunContext {
  return { ...parent, agentName, isSubagent: true };
}

/** Record untrusted content seen in this run (bounded). */
export function markUntrusted(ctx: RunContext, source: string, text: string): void {
  ctx.taint.add(source);
  ctx.untrusted.push(text.slice(0, 8000));
  if (ctx.untrusted.length > 40) ctx.untrusted.shift();
}
