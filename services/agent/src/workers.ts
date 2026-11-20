import { personaPrompt } from '@muse/core';
import { toVector } from '@muse/db';
import type { MemoryJob } from '@muse/runtime';
import { makeContext } from './context.js';
import { performAction } from './gateway.js';
import type { extractMemories, proactive, reflect } from './memory.js';
import { type AgentDeps, loadUser } from './runtime.js';
import { pickConnector, withDemo } from './tools/types.js';

interface MemFns { extractMemories: typeof extractMemories; reflect: typeof reflect; proactive: typeof proactive }

export async function memoryJob(d: AgentDeps, job: MemoryJob, f: MemFns): Promise<void> {
  const md = { db: d.db, llm: d.llm, embedder: d.embedder, bus: d.bus, redis: d.redis, clients: d.clients, model: d.model };
  if (job.userId === '*') {
    // fan out to users with enough memories
    const users = await d.db.q('SELECT user_id FROM memories GROUP BY user_id HAVING count(*) >= 3');
    for (const u of users) await d.bus.queues.memory.add(job.kind, { userId: u.user_id, kind: job.kind }, { jobId: `${job.kind}-${u.user_id}-${new Date().toISOString().slice(0, 13)}` });
    return;
  }
  switch (job.kind) {
    case 'extract':
      await f.extractMemories(md, job.userId, job.conversationId ?? 'default');
      return;
    case 'reflect':
      await f.reflect(md, job.userId);
      return;
    case 'embed': {
      const m = await d.db.one('SELECT content FROM memories WHERE id=$1 AND user_id=$2', [job.memoryId, job.userId]);
      if (!m) return;
      const [v] = await d.embedder.embed([m.content]);
      await d.db.q('UPDATE memories SET embedding=$3::vector WHERE id=$1 AND user_id=$2', [job.memoryId, job.userId, toVector(v!)]);
      return;
    }
    case 'proactive': {
      const u = await loadUser(d, job.userId);
      if (!u) return;
      let upcoming = '';
      const cal = await pickConnector({ db: d.db, userId: job.userId } as any, withDemo('gcal', 'demo_calendar'));
      if (cal) {
        const ctx = makeContext({ userId: job.userId, thread: 'proactive', conversationId: 'default', taskId: null, turnId: 'proactive', userRequest: 'Check my upcoming events for proactive suggestions', db: d.db, bus: d.bus, llm: d.llm, clients: d.clients, sandbox: d.sandbox });
        upcoming = await performAction(ctx, { actionClass: 'read', connector: cal, operation: 'list_events', payload: { from: new Date().toISOString(), to: new Date(Date.now() + 7 * 86400_000).toISOString() }, title: 'List events' });
      }
      await f.proactive(md, job.userId, upcoming.slice(0, 6000), personaPrompt(u.avatar));
    }
  }
}
