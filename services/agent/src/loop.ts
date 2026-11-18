/**
 * The agent tool loop: call the model, run all requested tools in parallel, feed results back, repeat.
 * Reasoning items are replayed verbatim (stateless encrypted reasoning) so the model keeps its chain of thought.
 */
import type { Effort, Item, ToolDef } from '@muse/llm';
import type { RunContext } from './context.js';
import type { Tool } from './tools/types.js';

export interface LoopOptions {
  ctx: RunContext;
  instructions: string;
  input: Item[];
  tools: Tool[];
  builtins?: ToolDef[];
  maxSteps?: number;
  effort?: Effort;
  /** Stream visible text to the user (orchestrator only). */
  onText?: (delta: string) => void;
}

export interface LoopResult { newItems: Item[]; text: string; citations: { url: string; title?: string }[]; steps: number; hitLimit: boolean }

const MAX_TOOL_OUTPUT = 24_000;

export async function runLoop(o: LoopOptions): Promise<LoopResult> {
  const { ctx } = o;
  const byName = new Map(o.tools.map((t) => [t.def.name, t]));
  const defs: ToolDef[] = [...o.tools.map((t) => t.def), ...(o.builtins ?? [])];
  const newItems: Item[] = [];
  const texts: string[] = [];
  const citations: { url: string; title?: string }[] = [];
  const maxSteps = o.maxSteps ?? 12;
  let steps = 0;
  let lastWasText = false;

  for (; steps < maxSteps; steps++) {
    let streamed = '';
    const res = await ctx.llm.respond(
      { model: ctx.model, instructions: o.instructions, input: [...o.input, ...newItems], tools: defs, effort: o.effort ?? 'high', maxOutputTokens: 32_000, signal: ctx.signal },
      {
        onTextDelta: (d) => {
          if (!streamed && lastWasText) o.onText?.('\n\n');
          streamed += d;
          o.onText?.(d);
        },
      },
    );
    newItems.push(...res.output);
    citations.push(...res.citations);
    const visible = res.output
      .filter((i): i is Extract<Item, { type: 'message' }> => i.type === 'message')
      .map((m) => (typeof m.content === 'string' ? m.content : m.content.map((c) => ('text' in c ? c.text : '')).join('')))
      .join('\n')
      .trim();
    if (visible) { texts.push(visible); lastWasText = true; }
    if (!res.toolCalls.length) break;

    // Run every requested tool concurrently (parallel tool calls), keep outputs in call order.
    const outputs = await Promise.all(res.toolCalls.map(async (call) => {
      const tool = byName.get(call.name);
      let args: any = {};
      try { args = JSON.parse(call.arguments || '{}'); } catch { return { call, out: 'ERROR: invalid JSON arguments' }; }
      if (!tool) return { call, out: `ERROR: unknown tool ${call.name}` };
      const label = `${ctx.isSubagent ? `${ctx.agentName}: ` : ''}${tool.label(args)}`;
      await ctx.emit({ type: 'tool.start', turnId: ctx.turnId, callId: call.callId, name: call.name, label });
      await ctx.audit({ kind: 'tool.call', actor: ctx.isSubagent ? 'subagent' : 'agent', summary: label, data: { tool: call.name, agent: ctx.agentName, args } });
      let out: string;
      let ok = true;
      try {
        out = await tool.run(ctx, args, call.callId);
      } catch (e) {
        ok = false;
        out = `ERROR: ${(e as Error).message}`;
      }
      if (out.startsWith('ERROR') || out.startsWith('BLOCKED')) ok = false;
      await ctx.emit({ type: 'tool.end', turnId: ctx.turnId, callId: call.callId, ok, summary: summarize(out) });
      return { call, out: out.length > MAX_TOOL_OUTPUT ? out.slice(0, MAX_TOOL_OUTPUT) + '\n…(truncated)' : out };
    }));
    for (const { call, out } of outputs) newItems.push({ type: 'function_call_output', call_id: call.callId, output: out });
  }
  const hitLimit = steps >= maxSteps;
  return { newItems, text: texts.join('\n\n').trim(), citations, steps, hitLimit };
}

function summarize(out: string): string {
  if (out.startsWith('PENDING_APPROVAL')) return 'Waiting for your approval';
  if (out.startsWith('BLOCKED')) return 'Blocked by Sentinel';
  if (out.startsWith('ERROR')) return out.slice(0, 120);
  if (out.startsWith('DONE')) return 'Done';
  return 'Done';
}
