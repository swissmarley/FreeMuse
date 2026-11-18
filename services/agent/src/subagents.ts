/**
 * Specialised subagents. Each has a narrow toolset and instructions, runs its own short loop, and reports back to
 * the orchestrator. They share the run's taint tracking so provenance follows data across agents.
 */
import type { ToolDef } from '@muse/llm';
import { UNTRUSTED_RULES } from '@muse/security';
import { childContext } from './context.js';
import { runLoop } from './loop.js';
import { browserTools, shoppingTools } from './tools/browser.js';
import { calendarTools, driveTools } from './tools/calendar.js';
import { fileTools } from './tools/core.js';
import { mailTools } from './tools/mail.js';
import { fn, S, type Tool } from './tools/types.js';

export const SUBAGENT_NAMES = ['email', 'calendar', 'browser', 'shopping', 'research', 'documents'] as const;
export type SubagentName = (typeof SUBAGENT_NAMES)[number];

interface SubagentDef { title: string; role: string; tools: Tool[]; webSearch: boolean; maxSteps: number }

const DEFS: Record<SubagentName, SubagentDef> = {
  email: { title: 'Email agent', role: 'You handle the user\'s email: search, read, summarise, draft and (with approval) send. Write emails in the user\'s voice, short and friendly. Prefer drafts unless the user clearly asked to send.', tools: mailTools, webSearch: false, maxSteps: 10 },
  calendar: { title: 'Calendar agent', role: 'You handle the user\'s calendar: check availability, find conflicts, and (with approval) add events. Use ISO 8601 times.', tools: calendarTools, webSearch: false, maxSteps: 8 },
  browser: { title: 'Browser agent', role: 'You operate a private sandbox web browser: open pages, read them, fill forms. Never type passwords: use browser_login. Submitting forms needs approval (automatic). Stop and report if a site needs info you don\'t have.', tools: browserTools, webSearch: false, maxSteps: 16 },
  shopping: { title: 'Shopping agent', role: 'You research products and prices across stores, compare total cost (incl. shipping, contract terms), and prepare purchases. Purchases ALWAYS need approval via checkout. Never buy without an explicit request.', tools: [...browserTools, ...shoppingTools], webSearch: true, maxSteps: 16 },
  research: { title: 'Research agent', role: 'You research questions on the web: search, open the best sources, cross-check, and return a concise answer with source URLs.', tools: browserTools.filter((t) => ['browser_open', 'browser_snapshot', 'browser_scroll', 'browser_back'].includes(t.def.name)), webSearch: true, maxSteps: 12 },
  documents: { title: 'Documents agent', role: 'You read documents, attachments, recipes or web pages and turn them into useful outputs: summaries, checklists, grocery lists (grouped by aisle, with quantities scaled as asked), itineraries.', tools: [...driveTools, ...fileTools, ...browserTools.filter((t) => ['browser_open', 'browser_snapshot'].includes(t.def.name))], webSearch: false, maxSteps: 10 },
};

export function delegateTool(opts: { webSearch: boolean }): Tool {
  return {
    def: fn('delegate', `Hand a self-contained task to a specialist subagent and get its report. Agents: ${SUBAGENT_NAMES.join(', ')}. Call several in parallel for independent parts.`, {
      agent: { type: 'string', enum: [...SUBAGENT_NAMES] },
      task: S('Complete instructions incl. all details the subagent needs (it cannot see the chat)'),
    }, ['agent', 'task']),
    label: (a) => `${DEFS[a.agent as SubagentName]?.title ?? 'Helper'} is on it`,
    async run(ctx, a) {
      const name = a.agent as SubagentName;
      const def = DEFS[name];
      if (!def) return `ERROR: unknown agent ${a.agent}`;
      const sub = childContext(ctx, def.title);
      await ctx.audit({ kind: 'subagent.start', actor: 'agent', summary: `Asked ${def.title}: ${String(a.task).slice(0, 160)}`, data: { agent: name } });
      const builtins: ToolDef[] = def.webSearch && opts.webSearch ? [{ type: 'web_search' }] : [];
      const instructions = `You are the ${def.title}, a subagent of a personal AI agent. ${def.role}
Stay strictly within your job. If you need something from the user or another specialist, stop and say so in your report.
Current time: ${new Date().toISOString()} (UTC).
${UNTRUSTED_RULES}
Finish with a short report: what you found/did, anything waiting for approval, and anything blocked.`;
      const res = await runLoop({ ctx: sub, instructions, input: [{ type: 'message', role: 'user', content: String(a.task) }], tools: def.tools, builtins, maxSteps: def.maxSteps, effort: 'medium' });
      await ctx.audit({ kind: 'subagent.report', actor: 'subagent', summary: `${def.title} reported back`, data: { agent: name, steps: res.steps, report: res.text.slice(0, 2000) } });
      const cites = res.citations.length ? `\nSources: ${res.citations.map((c) => c.url).join(', ')}` : '';
      return `REPORT from ${def.title}${res.hitLimit ? ' (stopped at step limit)' : ''}:\n${res.text || '(no report)'}${cites}`;
    },
  };
}
