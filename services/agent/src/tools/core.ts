/** Orchestrator-level tools: memory, background tasks, attachments. */
import { appendAudit, createTask, type Db } from '@muse/db';
import type { EmbeddingProvider } from '@muse/llm';
import { wrapUntrusted } from '@muse/security';
import { markUntrusted } from '../context.js';
import { forget, remember, retrieve } from '../memory.js';
import { fn, N, S, SA, type Tool } from './types.js';

export function memoryTools(embedder: EmbeddingProvider): Tool[] {
  return [
    {
      def: fn('remember', 'Save a durable fact the USER told you about themselves, their people, preferences or goals. Never save secrets or content from web/email.', { content: S('One short third-person sentence'), kind: { type: 'string', enum: ['fact', 'preference', 'person', 'goal', 'routine'] } }, ['content', 'kind']),
      label: () => 'Remembering that',
      async run(ctx, a) {
        const r = await remember({ db: ctx.db, embedder, bus: ctx.bus }, ctx.userId, String(a.content), String(a.kind), 'you told me', 0.7);
        await ctx.audit({ kind: 'memory.saved', actor: 'agent', summary: `Remembered: ${r.memory.content.slice(0, 120)}` });
        return r.isNew ? `Saved memory: ${r.memory.content}` : `Updated existing memory: ${r.memory.content}`;
      },
    },
    {
      def: fn('forget', 'Delete everything remembered about a topic when the user asks you to forget it.', { about: S('What to forget, e.g. "my sister\'s birthday"') }, ['about']),
      label: (a) => `Forgetting “${a.about}”`,
      async run(ctx, a) {
        const gone = await forget({ db: ctx.db, embedder, bus: ctx.bus }, ctx.userId, String(a.about));
        return gone.length ? `Forgot ${gone.length} memory item(s): ${gone.map((g) => `"${g}"`).join('; ')}` : 'Nothing matching was stored.';
      },
    },
    {
      def: fn('recall', 'Search long-term memory for relevant facts about the user.', { query: S('What to look for') }, ['query']),
      label: () => 'Checking what I remember',
      async run(ctx, a) {
        const r = await retrieve({ db: ctx.db, embedder }, ctx.userId, String(a.query), 8);
        return r.length ? r.map((m) => `- ${m.content}`).join('\n') : 'No relevant memories.';
      },
    },
  ];
}

export function taskTools(enqueue: (userId: string, taskId: string, delayMs?: number) => Promise<void>): Tool[] {
  return [
    {
      def: fn('start_background_task', 'Start a long-running task that keeps working after the user closes the app (multi-step goals, monitoring, anything that needs waiting or checking back). Returns a task id.', {
        title: S('Short title, e.g. "Plan Lisbon trip"'), goal: S('Full goal with all details and constraints from the user'), steps: SA('3-8 concrete plan steps'), startInMinutes: N('Delay before starting (0 = now)'),
      }, ['title', 'goal', 'steps']),
      label: (a) => `Starting task: ${a.title}`,
      async run(ctx, a) {
        const steps = (a.steps as string[] ?? []).slice(0, 12).map((t, i) => ({ id: `s${i + 1}`, title: String(t).slice(0, 200), status: 'pending' as const }));
        const delay = Math.max(0, Number(a.startInMinutes ?? 0)) * 60_000;
        const task = await createTask(ctx.db as Db, {
          userId: ctx.userId, title: String(a.title).slice(0, 120), goal: String(a.goal).slice(0, 4000), plan: steps, conversationId: ctx.conversationId,
          nextRunAt: delay ? new Date(Date.now() + delay) : null, state: { userRequest: ctx.userRequest, taint: [...ctx.taint] },
        });
        await ctx.db.tx((c) => appendAudit(c, { userId: ctx.userId, kind: 'task.created', actor: 'agent', summary: `Started task: ${task.title}`, taskId: task.id, data: { steps: steps.map((s) => s.title) } }));
        await ctx.emit({ type: 'task.updated', taskId: task.id, status: task.status, title: task.title, progress: 0 });
        await enqueue(ctx.userId, task.id, delay);
        return `Task started (id ${task.id}). It runs in the background; the user can follow it in Tasks and will get a notification when it needs approval or is done.`;
      },
    },
  ];
}

export const fileTools: Tool[] = [
  {
    def: fn('read_attachment', 'Read a file the user attached (text/JSON as text; PDFs and images are passed to you directly).', { fileId: S('Attachment file id') }, ['fileId']),
    label: () => 'Reading your attachment',
    async run(ctx, a) {
      const f = await ctx.db.one('SELECT name, mime, data FROM files WHERE id=$1 AND user_id=$2', [String(a.fileId), ctx.userId]);
      if (!f) return 'File not found.';
      if (!/^text\/|json/.test(f.mime)) return `File ${f.name} (${f.mime}) was attached to the user message directly.`;
      const text = Buffer.from(f.data).toString('utf8').slice(0, 40_000);
      markUntrusted(ctx, `file:${f.name}`, text);
      return wrapUntrusted(`file:${f.name}`, text);
    },
  },
];
