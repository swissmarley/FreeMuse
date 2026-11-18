/**
 * Responses-API provider (Meta Model API default; also any OpenAI-Responses-compatible endpoint).
 * Stateless: store:false + include:["reasoning.encrypted_content"]; reasoning items are replayed by the caller.
 */
import { readSSE } from './sse.js';
import { parseRetryAfter, withRetry } from './retry.js';
import type { Item, LLMProvider, LLMRequest, LLMResult, StreamHandlers, ToolCall } from './types.js';
import { LLMError } from './types.js';

export interface ResponsesConfig {
  baseUrl: string;
  apiKey: string;
  model: string;
  fallbackModel?: string;
  fetchImpl?: typeof fetch;
}

/** Strip server-only fields so items can be replayed as input. */
export function toReplayItem(raw: any): Item | null {
  switch (raw?.type) {
    case 'message':
      return {
        type: 'message',
        role: raw.role,
        content: (raw.content ?? []).map((c: any) => ({ type: 'output_text', text: c.text ?? '' })),
        ...(raw.phase ? { phase: raw.phase } : {}),
      };
    case 'function_call':
      return { type: 'function_call', call_id: raw.call_id, name: raw.name, arguments: raw.arguments ?? '{}' };
    case 'reasoning':
      return raw.encrypted_content
        ? { type: 'reasoning', encrypted_content: raw.encrypted_content, summary: raw.summary ?? [] }
        : null;
    case 'web_search_call':
      return { type: 'web_search_call', id: null, status: raw.status ?? 'completed', ...(raw.action ? { action: raw.action } : {}) };
    default:
      return null;
  }
}

export class ResponsesProvider implements LLMProvider {
  readonly name = 'responses';
  constructor(private cfg: ResponsesConfig) {}

  async respond(req: LLMRequest, h: StreamHandlers = {}): Promise<LLMResult> {
    const model = req.model ?? this.cfg.model;
    try {
      return await withRetry(() => this.once(model, req, h));
    } catch (e) {
      if (e instanceof LLMError && e.status === 404 && this.cfg.fallbackModel && model !== this.cfg.fallbackModel) {
        return withRetry(() => this.once(this.cfg.fallbackModel!, req, h));
      }
      throw e;
    }
  }

  private body(model: string, req: LLMRequest) {
    const b: Record<string, unknown> = {
      model,
      input: req.input,
      store: false,
      stream: true,
      include: ['reasoning.encrypted_content'],
      reasoning: { effort: req.effort ?? 'high', summary: 'auto' },
    };
    if (req.instructions) b.instructions = req.instructions;
    if (req.tools?.length) b.tools = req.tools;
    if (req.parallelToolCalls === false) b.parallel_tool_calls = false;
    if (req.maxOutputTokens) b.max_output_tokens = req.maxOutputTokens;
    if (req.jsonSchema) b.text = { format: { type: 'json_schema', name: req.jsonSchema.name, schema: req.jsonSchema.schema, strict: true } };
    return b;
  }

  private async once(model: string, req: LLMRequest, h: StreamHandlers): Promise<LLMResult> {
    const f = this.cfg.fetchImpl ?? fetch;
    let res: Response;
    try {
      res = await f(this.cfg.baseUrl.replace(/\/$/, '') + '/responses', {
        method: 'POST',
        headers: { authorization: `Bearer ${this.cfg.apiKey}`, 'content-type': 'application/json', accept: 'text/event-stream' },
        body: JSON.stringify(this.body(model, req)),
        signal: req.signal,
      });
    } catch (e) {
      throw new LLMError(0, 'network', (e as Error).message);
    }
    if (!res.ok || !res.body) {
      const text = await res.text().catch(() => '');
      let code = 'http_error';
      let msg = text.slice(0, 500);
      try {
        const j = JSON.parse(text);
        code = j.error?.code ?? j.error?.type ?? code;
        msg = j.error?.message ?? msg;
      } catch { /* not json */ }
      throw new LLMError(res.status, code, `Model API ${res.status}: ${msg}`, parseRetryAfter(res.headers.get('retry-after')));
    }
    const output: Item[] = [];
    const calls: ToolCall[] = [];
    const citations: { url: string; title?: string }[] = [];
    const pendingNames = new Map<string, { callId: string; name: string }>();
    let text = '';
    let usage = { input: 0, output: 0, reasoning: 0 };
    let finalModel = model;
    for await (const ev of readSSE(res.body)) {
      if (ev.data === '[DONE]') break;
      let e: any;
      try { e = JSON.parse(ev.data); } catch { continue; }
      switch (e.type) {
        case 'response.output_text.delta':
          if (e.delta) { text += e.delta; h.onTextDelta?.(e.delta); }
          break;
        case 'response.reasoning_summary_text.delta':
          h.onReasoningSummary?.(e.delta ?? '');
          break;
        case 'response.output_item.added':
          if (e.item?.type === 'function_call') {
            const c = { callId: e.item.call_id, name: e.item.name };
            pendingNames.set(e.item.id, c);
            h.onToolCallStart?.(c);
          }
          break;
        case 'response.function_call_arguments.delta': {
          const c = pendingNames.get(e.item_id);
          if (c) h.onToolCallArgsDelta?.(c.callId, e.delta ?? '');
          break;
        }
        case 'response.output_item.done': {
          const item = e.item;
          const replay = toReplayItem(item);
          if (replay) output.push(replay);
          if (item?.type === 'function_call') {
            const call = { callId: item.call_id, name: item.name, arguments: item.arguments ?? '{}' };
            calls.push(call);
            h.onToolCallDone?.(call);
          }
          if (item?.type === 'message') {
            for (const part of item.content ?? []) {
              for (const a of part.annotations ?? []) if (a.type === 'url_citation' && a.url) citations.push({ url: a.url, title: a.title });
            }
          }
          break;
        }
        case 'response.completed':
        case 'response.incomplete': {
          const r = e.response ?? {};
          finalModel = r.model ?? finalModel;
          usage = {
            input: r.usage?.input_tokens ?? 0,
            output: r.usage?.output_tokens ?? 0,
            reasoning: r.usage?.output_tokens_details?.reasoning_tokens ?? 0,
          };
          break;
        }
        case 'response.failed':
        case 'error':
          throw new LLMError(500, e.response?.error?.code ?? e.code ?? 'failed', e.response?.error?.message ?? e.message ?? 'response failed');
      }
    }
    // Final answer text = non-commentary message text (commentary already streamed to user as interim).
    const finalText = output
      .filter((i): i is Extract<Item, { type: 'message' }> => i.type === 'message' && i.phase !== 'commentary')
      .map((m) => (typeof m.content === 'string' ? m.content : m.content.map((c) => ('text' in c ? c.text : '')).join('')))
      .join('\n')
      .trim();
    return { output, text: finalText || (calls.length ? '' : text), toolCalls: calls, citations: dedupe(citations), usage, model: finalModel };
  }
}

function dedupe(c: { url: string; title?: string }[]) {
  const seen = new Set<string>();
  return c.filter((x) => (seen.has(x.url) ? false : (seen.add(x.url), true)));
}
