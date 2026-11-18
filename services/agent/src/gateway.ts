/**
 * Every outbound/connector action goes through here: propose → Sentinel → (allow) executor | (ask) approval inbox
 * | (deny) blocked. The agent holds no tokens or secrets, so there is no other path to a side effect.
 */
import type { ActionClass } from '@muse/core';
import { type ActionRequest, wrapUntrusted } from '@muse/security';
import { markUntrusted, type RunContext } from './context.js';

export interface ActionSpec {
  actionClass: ActionClass;
  connector: string;
  operation: string;
  payload: Record<string, unknown>;
  title: string;
  /** What the approval card shows (defaults to the payload). */
  preview?: Record<string, unknown>;
  /** For reads: label of the untrusted source the result comes from. */
  sourceLabel?: (result: unknown) => string;
  callId?: string;
}

export async function performAction(ctx: RunContext, spec: ActionSpec): Promise<string> {
  const action: ActionRequest = {
    userId: ctx.userId,
    actionClass: spec.actionClass,
    connector: spec.connector,
    operation: spec.operation,
    payload: spec.payload,
    title: spec.title,
    taskId: ctx.taskId,
    thread: ctx.thread,
    callId: spec.callId,
    provenance: { userRequest: ctx.userRequest, taintSources: [...ctx.taint], untrustedText: ctx.untrusted.join('\n').slice(-30_000) },
  };
  const actor = ctx.isSubagent ? 'subagent' : 'agent';
  if (spec.actionClass !== 'read') {
    await ctx.audit({ kind: 'action.proposed', actor, summary: `${ctx.agentName}: ${spec.title}`, data: { connector: spec.connector, operation: spec.operation, payload: spec.payload, tainted: ctx.taint.size > 0 } });
  }
  let s;
  try {
    s = await ctx.clients.authorize(action);
  } catch (e) {
    await ctx.audit({ kind: 'sentinel.unavailable', actor: 'system', summary: 'Sentinel unavailable; action not performed' });
    return `ERROR: the safety service is unavailable, so nothing was done (${(e as Error).message}). Tell the user and try later.`;
  }
  if (spec.actionClass !== 'read' || s.decision !== 'allow') {
    await ctx.audit({ kind: 'sentinel.decision', actor: 'sentinel', summary: `${s.decision.toUpperCase()}: ${spec.title}`, data: { decision: s.decision, reasons: s.reasons, risk: s.risk, exfiltration: !!s.exfiltration } });
  }

  if (s.decision === 'deny') {
    return `BLOCKED by Sentinel (the safety system): ${s.reasons.join('; ')}. Nothing was done. Do not retry or work around this. Tell the user plainly what was blocked and why.`;
  }

  if (s.decision === 'ask') {
    const approvalId = await ctx.clients.requestApproval(action, s, spec.preview ?? spec.payload);
    ctx.pendingApprovals.push(approvalId);
    return `PENDING_APPROVAL id=${approvalId}. Nothing has been done yet. The user must approve it in the Approvals inbox (reasons: ${s.reasons.join('; ')}). Tell the user briefly what you prepared and that it is waiting for their OK. Do not say it was done.`;
  }

  const r = await ctx.clients.execute(action, s.token);
  if (!r.ok) return `ERROR: ${r.message ?? r.code ?? 'action failed'}`;
  const json = JSON.stringify(r.result ?? {}, null, 0);
  if (spec.actionClass === 'read') {
    const src = spec.sourceLabel?.(r.result) ?? `${spec.connector}:${spec.operation}`;
    markUntrusted(ctx, src, json);
    return wrapUntrusted(src, json.slice(0, 20_000));
  }
  return `DONE: ${json.slice(0, 4000)}`;
}
