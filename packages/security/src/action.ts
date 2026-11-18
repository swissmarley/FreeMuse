import { createHash } from 'node:crypto';
import type { ActionClass } from '@muse/core';

/** Where an action's inputs came from. Anything not typed by the user is untrusted. */
export interface Provenance {
  /** The user's own words that led to this action (trusted). */
  userRequest: string;
  /** Untrusted sources seen during the run (urls, email ids, file names). */
  taintSources: string[];
  /** Text of untrusted content seen in this run (used for exfiltration checks, not shown to the model). */
  untrustedText?: string;
}

export interface ActionRequest {
  userId: string;
  actionClass: ActionClass;
  connector: string;
  operation: string;
  payload: Record<string, unknown>;
  provenance: Provenance;
  taskId?: string | null;
  thread?: string;
  callId?: string;
  /** Human-readable title for approval UI. */
  title: string;
}

export function canonical(v: unknown): string {
  if (Array.isArray(v)) return '[' + v.map(canonical).join(',') + ']';
  if (v && typeof v === 'object') return '{' + Object.keys(v).sort().filter((k) => (v as any)[k] !== undefined).map((k) => JSON.stringify(k) + ':' + canonical((v as any)[k])).join(',') + '}';
  return JSON.stringify(v ?? null);
}

/** Hash binding the exact side effect (class, connector, operation, payload, user). */
export function actionHash(a: Pick<ActionRequest, 'userId' | 'actionClass' | 'connector' | 'operation' | 'payload'>): string {
  return createHash('sha256').update(canonical({ u: a.userId, c: a.actionClass, k: a.connector, o: a.operation, p: a.payload })).digest('hex');
}
