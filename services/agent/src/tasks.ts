/**
 * Durable background tasks. State (plan, history items, taint) lives in Postgres; wake-ups are BullMQ delayed jobs in
 * Redis, so tasks keep running and resume after the app is closed or the worker restarts.
 */
import type { PlanStep } from '@muse/core';
import { appendAudit, appendItems, getTask, insertMessage, loadItems, updateTask } from '@muse/db';
import type { Item } from '@muse/llm';
import { log, type TaskJob } from '@muse/runtime';
import { makeContext, type RunContext } from './context.js';
import { runLoop } from './loop.js';
import { taskPrompt } from './prompts.js';
import { type AgentDeps, buildInstructions, loadUser, modelFor, orchestratorTools, withThreadLock } from './runtime.js';
import { fn, N, S, type Tool } from './tools/types.js';

const MAX_RUNS = 40;

function taskControlTools(d: AgentDeps, taskId: string, state: { scheduledFor?: Date; completed?: string }): Tool[] {
  const progress = (plan: PlanStep[]) => (plan.length ? plan.filter((s) => s.status === 'done' || s.status === 'skipped').length / plan.length : 0);
  return [
    {
      def: fn('update_plan', 'Update a plan step status (and optionally add a new step).', { stepId: S('Step id like s2, or "new"'), status: { type: 'string', enum: ['pending', 'running', 'done', 'blocked', 'skipped', 'failed'] }, note: S('Short note'), title: S('Title (only for a new step)') }, ['stepId', 'status']),
      label: (a) => `Updating plan (${a.stepId} → ${a.status})`,
      async run(ctx, a) {
        const t = await getTask(d.db, ctx.userId, taskId);
        if (!t) return 'ERROR: task missing';
        let plan = t.plan;
        if (a.stepId === 'new') plan = [...plan, { id: `s${plan.length + 1}`, title: String(a.title ?? 'New step').slice(0, 200), status: a.status }];
        else plan = plan.map((s) => (s.id === a.stepId ? { ...s, status: a.status, note: a.note ? String(a.note).slice(0, 200) : s.note } : s));
        const upd = await updateTask(d.db, ctx.userId, taskId, { plan, progress: progress(plan) });
        await ctx.emit({ type: 'task.updated', taskId, status: upd!.status, title: upd!.title, progress: upd!.progress });
        const step = plan.find((s) => s.id === a.stepId);
        await ctx.audit({ kind: 'task.step', actor: 'agent', summary: `${step?.title ?? a.stepId}: ${a.status}${a.note ? ` (${a.note})` : ''}` });
        return 'Plan updated.';
      },
    },
    {
      def: fn('schedule_check', 'Pause the task and wake up later (e.g. to re-check prices or wait for a reply).', { minutes: N('Minutes from now (1-10080)'), reason: S('What to check then') }, ['minutes', 'reason']),
      label: (a) => `Will check back in ${a.minutes} min`,
      async run(ctx, a) {
        const minutes = Math.min(10080, Math.max(1, Number(a.minutes) || 60));
        state.scheduledFor = new Date(Date.now() + minutes * 60_000);
        await d.bus.queues.tasks.add('scheduled', { userId: ctx.userId, taskId, reason: 'scheduled', note: String(a.reason).slice(0, 300) }, { delay: minutes * 60_000, jobId: `task-${taskId}-${state.scheduledFor.getTime()}` });
        await ctx.audit({ kind: 'task.scheduled', actor: 'agent', summary: `Will check back at ${state.scheduledFor.toISOString().slice(11, 16)} UTC: ${String(a.reason).slice(0, 100)}`, data: { at: state.scheduledFor.toISOString() } });
        return `Scheduled. Stop now; you will be woken at ${state.scheduledFor.toISOString()}.`;
      },
    },
    {
      def: fn('complete_task', 'Finish the task with a short, friendly summary for the user.', { summary: S('What was achieved, and anything the user should do') }, ['summary']),
      label: () => 'Wrapping up',
      async run(_ctx, a) {
        state.completed = String(a.summary).slice(0, 3000);
        return 'Task marked complete. Stop now.';
      },
    },
  ];
}

export async function runTask(d: AgentDeps, job: TaskJob): Promise<void> {
  const thread = `task:${job.taskId}`;
  await withThreadLock(d.redis, `${job.userId}:${thread}`, async () => {
    const task = await getTask(d.db, job.userId, job.taskId);
    if (!task || ['done', 'failed', 'cancelled'].includes(task.status)) return;
    if (task.status === 'waiting_approval' && job.reason !== 'resume') return;
    const u = await loadUser(d, job.userId);
    if (!u) return;
    const runs = Number(task.state?.runs ?? 0) + 1;
    if (runs > MAX_RUNS) {
      await finish(d, job.userId, task.id, task.title, 'failed', 'I stopped this task because it took too many steps. You can ask me to try again with a narrower goal.', task.conversationId);
      return;
    }
    await updateTask(d.db, job.userId, task.id, { status: 'running', nextRunAt: null, state: { ...task.state, runs } });
    await d.bus.emit(job.userId, { type: 'task.updated', taskId: task.id, status: 'running', title: task.title, progress: task.progress });

    const userRequest = String(task.state?.userRequest ?? task.goal);
    const base = await buildInstructions(d, job.userId, u, task.goal);
    const instructions = taskPrompt(base, task);
    const history = (await loadItems(d.db, job.userId, thread, 60)).map((r) => r.item as Item);
    const note = job.reason === 'start' ? 'Start working on this task now. Follow the plan.'
      : job.reason === 'scheduled' ? `Scheduled check-in: ${job.note ?? 'continue the task'}.`
      : `[Update from the system, not from the user] ${job.note ?? 'Continue the task.'}`;
    const first: Item = { type: 'message', role: history.length ? 'developer' : 'user', content: note };
    const turnId = `${task.id}:${runs}`;
    const ctx: RunContext = makeContext({ userId: job.userId, thread, conversationId: task.conversationId, taskId: task.id, turnId, userRequest, db: d.db, bus: d.bus, llm: d.llm, model: modelFor(d, u.settings), clients: d.clients, sandbox: d.sandbox });
    for (const t of (task.state?.taint as string[] | undefined) ?? []) ctx.taint.add(t);
    if (task.state?.untrusted) ctx.untrusted.push(String(task.state.untrusted));
    const control: { scheduledFor?: Date; completed?: string } = {};
    const tools = [...orchestratorTools(d).filter((t) => t.def.name !== 'start_background_task'), ...taskControlTools(d, task.id, control)];

    let res;
    try {
      res = await runLoop({ ctx, instructions, input: [...history, first], tools, builtins: d.webSearch ? [{ type: 'web_search' }] : [], maxSteps: 14, effort: d.effort });
    } catch (e) {
      log.error({ err: (e as Error).message, taskId: task.id }, 'task run failed');
      await updateTask(d.db, job.userId, task.id, { status: 'queued' });
      throw e; // BullMQ retries with backoff
    }
    await appendItems(d.db, job.userId, thread, turnId, [first, ...res.newItems]);
    const after = await getTask(d.db, job.userId, task.id);
    if (!after || after.status === 'cancelled') return;
    const nextState = { ...after.state, runs, taint: [...ctx.taint], untrusted: ctx.untrusted.join('\n').slice(-10_000) };

    if (control.completed) {
      await updateTask(d.db, job.userId, task.id, { state: nextState });
      await finish(d, job.userId, task.id, after.title, 'done', control.completed, after.conversationId);
    } else if (ctx.pendingApprovals.length) {
      await updateTask(d.db, job.userId, task.id, { status: 'waiting_approval', state: nextState });
      await d.bus.emit(job.userId, { type: 'task.updated', taskId: task.id, status: 'waiting_approval', title: after.title, progress: after.progress });
    } else if (control.scheduledFor) {
      await updateTask(d.db, job.userId, task.id, { status: 'scheduled', nextRunAt: control.scheduledFor, state: nextState });
      await d.bus.emit(job.userId, { type: 'task.updated', taskId: task.id, status: 'scheduled', title: after.title, progress: after.progress });
    } else if (res.hitLimit) {
      // Long task: continue in a fresh run shortly (keeps each run bounded and resumable).
      await updateTask(d.db, job.userId, task.id, { status: 'queued', state: nextState });
      await d.bus.queues.tasks.add('continue', { userId: job.userId, taskId: task.id, reason: 'resume', note: 'Continue where you left off.' }, { delay: 2000, jobId: `task-${task.id}-cont-${runs}` });
    } else {
      await updateTask(d.db, job.userId, task.id, { state: nextState });
      await finish(d, job.userId, task.id, after.title, 'done', res.text || 'Task finished.', after.conversationId);
    }
  });
}

async function finish(d: AgentDeps, userId: string, taskId: string, title: string, status: 'done' | 'failed', summary: string, conversationId: string) {
  const t = await getTask(d.db, userId, taskId);
  const plan = (t?.plan ?? []).map((s) => (status === 'done' && (s.status === 'pending' || s.status === 'running') ? { ...s, status: 'done' as const } : s));
  await updateTask(d.db, userId, taskId, { status, result: summary, progress: status === 'done' ? 1 : t?.progress ?? 0, plan, nextRunAt: null });
  await d.db.tx((c) => appendAudit(c, { userId, kind: `task.${status}`, actor: 'agent', summary: `${status === 'done' ? 'Finished' : 'Stopped'}: ${title}`, taskId }));
  const message = await insertMessage(d.db, { userId, conversationId, role: 'assistant', text: `**${title}** — ${summary}`, meta: { taskId } });
  await d.bus.emit(userId, { type: 'message.created', message });
  await d.bus.emit(userId, { type: 'task.updated', taskId, status, title, progress: status === 'done' ? 1 : t?.progress ?? 0 });
  await d.clients.notify(userId, status === 'done' ? `Done: ${title}` : `Task stopped: ${title}`, summary.slice(0, 180), `/tasks?id=${taskId}`);
}

/** After a crash/restart: re-enqueue tasks that were mid-run or overdue (BullMQ jobs are durable, this is a safety net). */
export async function recoverTasks(d: AgentDeps): Promise<number> {
  const rows = await d.db.q("SELECT id, user_id, status FROM tasks WHERE (status IN ('running','queued') AND updated_at < now() - interval '2 minutes') OR (status='scheduled' AND next_run_at < now() - interval '1 minute')");
  for (const r of rows) {
    await d.bus.queues.tasks.add('recover', { userId: r.user_id, taskId: r.id, reason: r.status === 'scheduled' ? 'scheduled' : 'resume', note: 'Resuming after a restart.' }, { jobId: `task-${r.id}-recover-${Math.floor(Date.now() / 60_000)}` });
  }
  return rows.length;
}
