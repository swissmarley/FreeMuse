/**
 * Chat Completions provider for any OpenAI-compatible endpoint (switch with env only).
 * Reasoning is not carried across turns on this endpoint (documented limitation).
 */
import { readSSE } from './sse.js';
import { parseRetryAfter, withRetry } from './retry.js';
import type { ContentPart, Item, LLMProvider, LLMRequest, LLMResult, StreamHandlers, ToolCall } from './types.js';
import { LLMError } from './types.js';

export interface ChatConfig { baseUrl: string; apiKey: string; model: string; fetchImpl?: typeof fetch; sendReasoningEffort?: boolean }

function partsToChat(content: string | ContentPart[]): unknown {
  if (typeof content === 'string') return content;
  return content.map((c) => {
    if (c.type === 'input_text' || c.type === 'output_text') return { type: 'text', text: c.text };
    if (c.type === 'input_image') return { type: 'image_url', image_url: { url: c.image_url } };
    return { type: 'text', text: `[file ${c.filename}]` };
  });
}

export function itemsToMessages(instructions: string | undefined, items: Item[]): any[] {
  const msgs: any[] = [];
  if (instructions) msgs.push({ role: 'system', content: instructions });
  for (const it of items) {
    if (it.type === 'message') {
      const role = it.role === 'developer' ? 'system' : it.role;
      const last = msgs[msgs.length - 1];
      msgs.push({ role, content: partsToChat(it.content) });
      void last;
    } else if (it.type === 'function_call') {
      const last = msgs[msgs.length - 1];
      const tc = { id: it.call_id, type: 'function', function: { name: it.name, arguments: it.arguments } };
      if (last?.role === 'assistant' && Array.isArray(last.tool_calls)) last.tool_calls.push(tc);
      else msgs.push({ role: 'assistant', content: null, tool_calls: [tc] });
    } else if (it.type === 'function_call_output') {
      msgs.push({ role: 'tool', tool_call_id: it.call_id, content: it.output });
    }
  }
  return msgs;
}

export class ChatCompletionsProvider implements LLMProvider {
  readonly name = 'chat';
  constructor(private cfg: ChatConfig) {}

  respond(req: LLMRequest, h: StreamHandlers = {}): Promise<LLMResult> {
    return withRetry(() => this.once(req, h));
  }

  private async once(req: LLMRequest, h: StreamHandlers): Promise<LLMResult> {
    const model = req.model ?? this.cfg.model;
    const tools = (req.tools ?? [])
      .filter((t): t is Extract<typeof t, { type: 'function' }> => t.type === 'function')
      .map((t) => ({ type: 'function', function: { name: t.name, description: t.description, parameters: t.parameters } }));
    const body: Record<string, unknown> = { model, messages: itemsToMessages(req.instructions, req.input), stream: true, stream_options: { include_usage: true } };
    if (tools.length) body.tools = tools;
    if (req.parallelToolCalls === false) body.parallel_tool_calls = false;
    if (this.cfg.sendReasoningEffort !== false && req.effort) body.reasoning_effort = req.effort;
    if (req.maxOutputTokens) body.max_tokens = req.maxOutputTokens;
    if (req.jsonSchema) body.response_format = { type: 'json_schema', json_schema: { name: req.jsonSchema.name, schema: req.jsonSchema.schema, strict: true } };
    const f = this.cfg.fetchImpl ?? fetch;
    let res: Response;
    try {
      res = await f(this.cfg.baseUrl.replace(/\/$/, '') + '/chat/completions', {
        method: 'POST',
        headers: { authorization: `Bearer ${this.cfg.apiKey}`, 'content-type': 'application/json' },
        body: JSON.stringify(body),
        signal: req.signal,
      });
    } catch (e) {
      throw new LLMError(0, 'network', (e as Error).message);
    }
    if (!res.ok || !res.body) {
      const t = await res.text().catch(() => '');
      throw new LLMError(res.status, 'http_error', `LLM ${res.status}: ${t.slice(0, 300)}`, parseRetryAfter(res.headers.get('retry-after')));
    }
    let text = '';
    const acc = new Map<number, { id: string; name: string; args: string }>();
    let usage = { input: 0, output: 0, reasoning: 0 };
    for await (const ev of readSSE(res.body)) {
      if (ev.data === '[DONE]') break;
      let j: any;
      try { j = JSON.parse(ev.data); } catch { continue; }
      if (j.usage) usage = { input: j.usage.prompt_tokens ?? 0, output: j.usage.completion_tokens ?? 0, reasoning: j.usage.completion_tokens_details?.reasoning_tokens ?? 0 };
      const d = j.choices?.[0]?.delta;
      if (!d) continue;
      if (d.content) { text += d.content; h.onTextDelta?.(d.content); }
      for (const tc of d.tool_calls ?? []) {
        const cur = acc.get(tc.index) ?? { id: '', name: '', args: '' };
        if (tc.id) cur.id = tc.id;
        if (tc.function?.name) {
          cur.name = tc.function.name;
          h.onToolCallStart?.({ callId: cur.id, name: cur.name });
        }
        if (tc.function?.arguments) { cur.args += tc.function.arguments; h.onToolCallArgsDelta?.(cur.id, tc.function.arguments); }
        acc.set(tc.index, cur);
      }
    }
    const calls: ToolCall[] = [...acc.values()].map((c) => ({ callId: c.id || `call_${Math.random().toString(36).slice(2)}`, name: c.name, arguments: c.args || '{}' }));
    calls.forEach((c) => h.onToolCallDone?.(c));
    const output: Item[] = [];
    if (text) output.push({ type: 'message', role: 'assistant', content: [{ type: 'output_text', text }], ...(calls.length ? { phase: 'commentary' as const } : {}) });
    for (const c of calls) output.push({ type: 'function_call', call_id: c.callId, name: c.name, arguments: c.arguments });
    return { output, text: calls.length ? '' : text, toolCalls: calls, citations: [], usage, model };
  }
}
