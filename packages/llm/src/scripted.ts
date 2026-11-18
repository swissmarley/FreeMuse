/** Deterministic provider for tests and offline e2e runs. A script decides each turn's output. */
import type { Item, LLMProvider, LLMRequest, LLMResult, StreamHandlers, ToolCall } from './types.js';

export interface ScriptTurn { text?: string; calls?: { name: string; args: Record<string, unknown> }[]; json?: unknown }
export type Script = (req: LLMRequest, ctx: { turn: number; lastUserText: string; toolOutputs: { name: string; output: string }[] }) => ScriptTurn;

let seq = 0;

export class ScriptedProvider implements LLMProvider {
  readonly name = 'scripted';
  public requests: LLMRequest[] = [];
  constructor(private script: Script) {}

  async respond(req: LLMRequest, h: StreamHandlers = {}): Promise<LLMResult> {
    this.requests.push(req);
    const lastUser = [...req.input].reverse().find((i) => i.type === 'message' && (i.role === 'user' || i.role === 'developer')) as Extract<Item, { type: 'message' }> | undefined;
    const lastUserText = lastUser ? (typeof lastUser.content === 'string' ? lastUser.content : lastUser.content.map((c) => ('text' in c ? c.text : '')).join('')) : '';
    // tool outputs produced since the last user message
    const idx = lastUser ? req.input.lastIndexOf(lastUser) : -1;
    const names = new Map<string, string>();
    const toolOutputs: { name: string; output: string }[] = [];
    req.input.slice(idx + 1).forEach((i) => {
      if (i.type === 'function_call') names.set(i.call_id, i.name);
      if (i.type === 'function_call_output') toolOutputs.push({ name: names.get(i.call_id) ?? '?', output: i.output });
    });
    const turn = toolOutputs.length;
    const step = this.script(req, { turn, lastUserText, toolOutputs });
    const output: Item[] = [];
    const calls: ToolCall[] = [];
    let text = step.json !== undefined ? JSON.stringify(step.json) : step.text ?? '';
    if (text) {
      for (const w of text.match(/\S+\s*/g) ?? []) h.onTextDelta?.(w);
      output.push({ type: 'message', role: 'assistant', content: [{ type: 'output_text', text }], ...(step.calls?.length ? { phase: 'commentary' as const } : {}) });
    }
    for (const c of step.calls ?? []) {
      const call = { callId: `call_s${++seq}`, name: c.name, arguments: JSON.stringify(c.args) };
      h.onToolCallStart?.({ callId: call.callId, name: call.name });
      h.onToolCallDone?.(call);
      calls.push(call);
      output.push({ type: 'function_call', call_id: call.callId, name: call.name, arguments: call.arguments });
    }
    if (calls.length) text = '';
    return { output, text, toolCalls: calls, citations: [], usage: { input: 0, output: 0, reasoning: 0 }, model: 'scripted' };
  }
}
