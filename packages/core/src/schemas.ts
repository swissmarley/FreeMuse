import { z } from 'zod';

export const ActionClass = z.enum(['read', 'draft', 'send', 'spend', 'navigate', 'login', 'write']);
export type ActionClass = z.infer<typeof ActionClass>;

export const Decision = z.enum(['allow', 'deny', 'ask']);
export type Decision = z.infer<typeof Decision>;

export const ChatRole = z.enum(['user', 'assistant', 'system', 'proactive']);

export const Citation = z.object({ url: z.string(), title: z.string().optional() });
export type Citation = z.infer<typeof Citation>;

export const ChatMessage = z.object({
  id: z.string(),
  conversationId: z.string(),
  role: ChatRole,
  text: z.string(),
  citations: z.array(Citation).default([]),
  createdAt: z.string(),
  meta: z.record(z.string(), z.unknown()).optional(),
});
export type ChatMessage = z.infer<typeof ChatMessage>;

/** Server → client stream events (SSE). */
export const StreamEvent = z.discriminatedUnion('type', [
  z.object({ type: z.literal('turn.start'), turnId: z.string(), conversationId: z.string() }),
  z.object({ type: z.literal('text.delta'), turnId: z.string(), delta: z.string() }),
  z.object({ type: z.literal('tool.start'), turnId: z.string(), callId: z.string(), name: z.string(), label: z.string() }),
  z.object({ type: z.literal('tool.end'), turnId: z.string(), callId: z.string(), ok: z.boolean(), summary: z.string() }),
  z.object({ type: z.literal('turn.end'), turnId: z.string(), message: ChatMessage.optional(), error: z.string().optional() }),
  z.object({ type: z.literal('approval.created'), approvalId: z.string(), title: z.string() }),
  z.object({ type: z.literal('approval.resolved'), approvalId: z.string(), status: z.string() }),
  z.object({ type: z.literal('task.updated'), taskId: z.string(), status: z.string(), title: z.string(), progress: z.number() }),
  z.object({ type: z.literal('memory.updated'), count: z.number() }),
  z.object({ type: z.literal('message.created'), message: ChatMessage }),
  z.object({ type: z.literal('ping') }),
]);
export type StreamEvent = z.infer<typeof StreamEvent>;

export const ApprovalStatus = z.enum(['pending', 'approved', 'rejected', 'expired', 'executed', 'failed']);
export const Approval = z.object({
  id: z.string(),
  taskId: z.string().nullable(),
  actionClass: ActionClass,
  connector: z.string(),
  operation: z.string(),
  title: z.string(),
  preview: z.record(z.string(), z.unknown()),
  payload: z.record(z.string(), z.unknown()),
  risk: z.object({ level: z.enum(['low', 'medium', 'high']), reasons: z.array(z.string()) }),
  status: ApprovalStatus,
  createdAt: z.string(),
  resolvedAt: z.string().nullable(),
});
export type Approval = z.infer<typeof Approval>;

export const AuditEvent = z.object({
  id: z.string(),
  seq: z.number(),
  kind: z.string(),
  actor: z.enum(['user', 'agent', 'subagent', 'sentinel', 'system']),
  summary: z.string(),
  data: z.record(z.string(), z.unknown()),
  taskId: z.string().nullable(),
  createdAt: z.string(),
  hash: z.string(),
});
export type AuditEvent = z.infer<typeof AuditEvent>;

export const PlanStep = z.object({
  id: z.string(),
  title: z.string(),
  status: z.enum(['pending', 'running', 'done', 'blocked', 'skipped', 'failed']),
  note: z.string().optional(),
});
export type PlanStep = z.infer<typeof PlanStep>;

export const TaskStatus = z.enum(['queued', 'running', 'waiting_approval', 'scheduled', 'done', 'failed', 'cancelled']);
export const Task = z.object({
  id: z.string(),
  title: z.string(),
  goal: z.string(),
  status: TaskStatus,
  plan: z.array(PlanStep),
  progress: z.number(),
  nextRunAt: z.string().nullable(),
  result: z.string().nullable(),
  createdAt: z.string(),
  updatedAt: z.string(),
});
export type Task = z.infer<typeof Task>;

export const Memory = z.object({
  id: z.string(),
  content: z.string(),
  kind: z.enum(['fact', 'preference', 'person', 'goal', 'routine']),
  source: z.string(),
  importance: z.number(),
  createdAt: z.string(),
  lastUsedAt: z.string().nullable(),
});
export type Memory = z.infer<typeof Memory>;

export const ScopeDef = z.object({ id: z.string(), label: z.string(), description: z.string(), classes: z.array(ActionClass) });
export type ScopeDef = z.infer<typeof ScopeDef>;

export const ConnectorInfo = z.object({
  id: z.string(),
  name: z.string(),
  description: z.string(),
  kind: z.enum(['oauth', 'demo']),
  available: z.boolean(),
  scopes: z.array(ScopeDef),
});
export type ConnectorInfo = z.infer<typeof ConnectorInfo>;

export const Connection = z.object({
  id: z.string(),
  connector: z.string(),
  scopes: z.array(z.string()),
  account: z.string(),
  status: z.enum(['active', 'revoked', 'error']),
  createdAt: z.string(),
});
export type Connection = z.infer<typeof Connection>;

export const UserSettings = z.object({
  trainingOptOut: z.boolean(),
  language: z.string(),
  theme: z.enum(['system', 'light', 'dark']),
  reducedMotion: z.boolean(),
  proactiveSuggestions: z.boolean(),
  allowedDomains: z.array(z.string()),
  blockedDomains: z.array(z.string()),
  autoApproveDrafts: z.boolean(),
});
export type UserSettings = z.infer<typeof UserSettings>;

export const DEFAULT_SETTINGS: UserSettings = {
  trainingOptOut: true,
  language: 'en',
  theme: 'system',
  reducedMotion: false,
  proactiveSuggestions: true,
  allowedDomains: [],
  blockedDomains: [],
  autoApproveDrafts: true,
};

export const SignupInput = z.object({
  email: z.email(),
  password: z.string().min(10).max(200),
  birthDate: z.iso.date(),
  acceptTerms: z.literal(true),
});
export type SignupInput = z.infer<typeof SignupInput>;

/** Age (in whole years) on a given day. */
export function ageOn(birthDate: string, today = new Date()): number {
  const [y, m, d] = birthDate.split('-').map(Number) as [number, number, number];
  let age = today.getUTCFullYear() - y;
  const beforeBirthday = today.getUTCMonth() + 1 < m || (today.getUTCMonth() + 1 === m && today.getUTCDate() < d);
  if (beforeBirthday) age--;
  return age;
}
export const MIN_AGE = 18;
