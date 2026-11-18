/** Chat turns: the main agent loop for a conversation, streamed to the client. */
import { appendItems, insertMessage, loadItems } from '@muse/db';
import type { Item } from '@muse/llm';
import { log, type TurnJob } from '@muse/runtime';
import { makeContext } from './context.js';
import { runLoop } from './loop.js';
import { type AgentDeps, buildInstructions, loadUser, modelFor, orchestratorTools, userItem, withThreadLock } from './runtime.js';

export async function handleTurn(d: AgentDeps, job: TurnJob): Promise<void> {
  const thread = `conv:${job.conversationId}`;
  await withThreadLock(d.redis, `${job.userId}:${thread}`, async () => {
    const u = await loadUser(d, job.userId);
    if (!u) return; // user deleted
    const history = (await loadItems(d.db, job.userId, thread)).map((r) => r.item as Item);
    const lastUserText = job.kind === 'chat' ? job.text ?? '' : await lastUserMessage(d, job.userId, job.conversationId);
    const instructions = await buildInstructions(d, job.userId, u, lastUserText, job.channel === 'voice' ? 'voice' : 'text');
    const first: Item = job.kind === 'chat'
      ? await userItem(d, job.userId, job.text ?? '', job.attachments)
      : { type: 'message', role: 'developer', content: `[Update from the system, not from the user] ${job.note ?? ''}` };

    const ctx = makeContext({ userId: job.userId, thread, conversationId: job.conversationId, taskId: null, turnId: job.turnId, userRequest: lastUserText, db: d.db, bus: d.bus, llm: d.llm, model: modelFor(d, u.settings), clients: d.clients, sandbox: d.sandbox });
    await ctx.emit({ type: 'turn.start', turnId: job.turnId, conversationId: job.conversationId });
    try {
      const res = await runLoop({
        ctx, instructions, input: [...history, first], tools: orchestratorTools(d), builtins: d.webSearch ? [{ type: 'web_search' }] : [],
        maxSteps: 10, effort: d.effort,
        onText: (delta) => { void ctx.emit({ type: 'text.delta', turnId: job.turnId, delta }); },
      });
      let text = res.text;
      if (!text) text = res.hitLimit ? 'I made progress but need a moment more. Shall I keep going?' : 'Done.';
      await appendItems(d.db, job.userId, thread, job.turnId, [first, ...res.newItems, ...(res.text ? [] : [{ type: 'message', role: 'assistant', content: [{ type: 'output_text', text }] }])]);
      const message = await insertMessage(d.db, {
        userId: job.userId, conversationId: job.conversationId, role: 'assistant', text, citations: res.citations,
        meta: { turnId: job.turnId, approvals: ctx.pendingApprovals, kind: job.kind },
      });
      await ctx.audit({ kind: 'chat.reply', actor: 'agent', summary: text.slice(0, 140), data: { steps: res.steps, tools: res.newItems.filter((i) => i.type === 'function_call').length } });
      await ctx.emit({ type: 'turn.end', turnId: job.turnId, message });
      if (job.kind === 'chat') {
        await d.bus.queues.memory.add('extract', { userId: job.userId, kind: 'extract', conversationId: job.conversationId }, { delay: 15_000, jobId: `extract-${job.userId}-${Math.floor(Date.now() / 60_000)}` });
      }
    } catch (e) {
      log.error({ err: (e as Error).message, userId: job.userId }, 'turn failed');
      const msg = friendlyError(e as Error);
      const message = await insertMessage(d.db, { userId: job.userId, conversationId: job.conversationId, role: 'assistant', text: msg, meta: { error: true } });
      await ctx.emit({ type: 'turn.end', turnId: job.turnId, message, error: (e as Error).message.slice(0, 200) });
    }
  });
}

async function lastUserMessage(d: AgentDeps, userId: string, conversationId: string): Promise<string> {
  const r = await d.db.one("SELECT text FROM messages WHERE user_id=$1 AND conversation_id=$2 AND role='user' ORDER BY created_at DESC LIMIT 1", [userId, conversationId]);
  return r?.text ?? '';
}

export function friendlyError(e: Error): string {
  const m = e.message;
  if (/401|invalid_api_key/.test(m)) return 'I can’t reach my model right now (the API key looks invalid). Please check the server settings.';
  if (/403|region|country|not available/i.test(m)) return 'My model provider refused the request (it may not be available in your region). The admin can switch providers in the server settings.';
  if (/429/.test(m)) return 'I’m a bit overloaded right now. Please try again in a minute.';
  return 'Sorry, something went wrong on my side. Please try again.';
}
