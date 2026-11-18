import { describe, expect, it } from 'vitest';
import { ChatCompletionsProvider, cosine, createProvider, HashEmbedding, itemsToMessages, LLMError, ResponsesProvider, ScriptedProvider, withRetry } from '../src/index.js';

function sseResponse(events: unknown[], status = 200): Response {
  const body = events.map((e) => `event: x\ndata: ${JSON.stringify(e)}\n\n`).join('') + 'data: [DONE]\n\n';
  return new Response(new Blob([body]).stream(), { status, headers: { 'content-type': 'text/event-stream' } });
}

describe('ResponsesProvider', () => {
  it('parses streamed text, parallel tool calls, reasoning and citations', async () => {
    const events = [
      { type: 'response.output_item.done', item: { type: 'reasoning', id: 'rs_1', encrypted_content: 'ENC', summary: [] } },
      { type: 'response.output_item.done', item: { type: 'message', id: 'm1', role: 'assistant', phase: 'commentary', content: [{ type: 'output_text', text: 'Checking.' }] } },
      { type: 'response.output_item.added', item: { type: 'function_call', id: 'fc1', call_id: 'c1', name: 'a' } },
      { type: 'response.function_call_arguments.delta', item_id: 'fc1', delta: '{"x"' },
      { type: 'response.output_item.done', item: { type: 'function_call', id: 'fc1', call_id: 'c1', name: 'a', arguments: '{"x":1}' } },
      { type: 'response.output_item.done', item: { type: 'function_call', id: 'fc2', call_id: 'c2', name: 'b', arguments: '{}' } },
      { type: 'response.completed', response: { model: 'muse-spark-1.3', usage: { input_tokens: 5, output_tokens: 9, output_tokens_details: { reasoning_tokens: 4 } } } },
    ];
    let sent: any;
    const p = new ResponsesProvider({ baseUrl: 'http://x/v1', apiKey: 'k', model: 'm', fetchImpl: async (_u, init) => { sent = JSON.parse(String(init?.body)); return sseResponse(events); } });
    const argDeltas: string[] = [];
    const r = await p.respond({ input: [{ type: 'message', role: 'user', content: 'hi' }], effort: 'high' }, { onToolCallArgsDelta: (_c, d) => argDeltas.push(d) });
    expect(sent.store).toBe(false);
    expect(sent.include).toEqual(['reasoning.encrypted_content']);
    expect(sent.reasoning.effort).toBe('high');
    expect(r.toolCalls.map((c) => c.name)).toEqual(['a', 'b']);
    expect(argDeltas).toEqual(['{"x"']);
    expect(r.output[0]).toEqual({ type: 'reasoning', encrypted_content: 'ENC', summary: [] });
    expect(r.output[1]).toMatchObject({ type: 'message', phase: 'commentary' });
    expect(r.text).toBe('');
    expect(r.usage.reasoning).toBe(4);
  });

  it('final text + url citations', async () => {
    const events = [
      { type: 'response.output_text.delta', delta: 'Paris' },
      { type: 'response.output_item.done', item: { type: 'message', role: 'assistant', content: [{ type: 'output_text', text: 'Paris', annotations: [{ type: 'url_citation', url: 'https://e.x', title: 'E' }] }] } },
    ];
    const p = new ResponsesProvider({ baseUrl: 'http://x/v1', apiKey: 'k', model: 'm', fetchImpl: async () => sseResponse(events) });
    const deltas: string[] = [];
    const r = await p.respond({ input: [] }, { onTextDelta: (d) => deltas.push(d) });
    expect(r.text).toBe('Paris');
    expect(deltas).toEqual(['Paris']);
    expect(r.citations).toEqual([{ url: 'https://e.x', title: 'E' }]);
  });

  it('falls back to the fallback model on 404', async () => {
    const models: string[] = [];
    const p = new ResponsesProvider({
      baseUrl: 'http://x/v1', apiKey: 'k', model: 'muse-spark-1.3', fallbackModel: 'muse-spark-1.1',
      fetchImpl: async (_u, init) => {
        const m = JSON.parse(String(init?.body)).model;
        models.push(m);
        return m === 'muse-spark-1.3' ? new Response(JSON.stringify({ error: { code: 'model_not_found', message: 'nope' } }), { status: 404 }) : sseResponse([{ type: 'response.output_text.delta', delta: 'ok' }]);
      },
    });
    const r = await p.respond({ input: [] });
    expect(models).toEqual(['muse-spark-1.3', 'muse-spark-1.1']);
    expect(r.text).toBe('ok');
  });
});

describe('retry', () => {
  it('retries 429 and honours retry-after', async () => {
    const sleeps: number[] = [];
    let n = 0;
    const v = await withRetry(async () => { if (n++ < 2) throw new LLMError(429, 'rate', 'x', 1000); return 'ok'; }, { sleep: async (ms) => { sleeps.push(ms); } });
    expect(v).toBe('ok');
    expect(sleeps.every((s) => s >= 1000)).toBe(true);
  });
  it('does not retry 400', async () => {
    let n = 0;
    await expect(withRetry(async () => { n++; throw new LLMError(400, 'bad', 'x'); })).rejects.toThrow();
    expect(n).toBe(1);
  });
});

describe('chat provider mapping', () => {
  it('maps items to chat messages with grouped tool calls', () => {
    const m = itemsToMessages('sys', [
      { type: 'message', role: 'user', content: 'hi' },
      { type: 'function_call', call_id: 'a', name: 'x', arguments: '{}' },
      { type: 'function_call', call_id: 'b', name: 'y', arguments: '{}' },
      { type: 'function_call_output', call_id: 'a', output: '1' },
      { type: 'function_call_output', call_id: 'b', output: '2' },
      { type: 'reasoning', encrypted_content: 'E', summary: [] },
    ]);
    expect(m[0]).toEqual({ role: 'system', content: 'sys' });
    expect(m[2].tool_calls).toHaveLength(2);
    expect(m.filter((x) => x.role === 'tool')).toHaveLength(2);
  });
  it('accumulates streamed tool call deltas', async () => {
    const chunks = [
      { choices: [{ delta: { tool_calls: [{ index: 0, id: 'c1', function: { name: 'f', arguments: '{"a"' } }] } }] },
      { choices: [{ delta: { tool_calls: [{ index: 0, function: { arguments: ':1}' } }] } }] },
    ];
    const p = new ChatCompletionsProvider({ baseUrl: 'http://x', apiKey: 'k', model: 'm', fetchImpl: async () => sseResponse(chunks) });
    const r = await p.respond({ input: [] });
    expect(r.toolCalls).toEqual([{ callId: 'c1', name: 'f', arguments: '{"a":1}' }]);
  });
});

describe('factory', () => {
  it('refuses contributor-mode models and missing keys', () => {
    expect(() => createProvider({})).toThrow(/MODEL_API_KEY/);
    expect(() => createProvider({ MODEL_API_KEY: 'k', LLM_MODEL: 'muse-spark-1.3-contributor' })).toThrow(/Contributor/);
    expect(createProvider({ MODEL_API_KEY: 'k', LLM_PROVIDER: 'chat' }).name).toBe('chat');
    expect(createProvider({ MODEL_API_KEY: 'k' }).name).toBe('responses');
  });
});

describe('scripted + embeddings', () => {
  it('scripted provider issues calls then text', async () => {
    const p = new ScriptedProvider((_r, ctx) => (ctx.turn === 0 ? { calls: [{ name: 't', args: { q: 1 } }] } : { text: 'done ' + ctx.toolOutputs[0]?.output }));
    const r1 = await p.respond({ input: [{ type: 'message', role: 'user', content: 'go' }] });
    expect(r1.toolCalls[0]?.name).toBe('t');
    const r2 = await p.respond({ input: [{ type: 'message', role: 'user', content: 'go' }, ...r1.output, { type: 'function_call_output', call_id: r1.toolCalls[0]!.callId, output: 'X' }] });
    expect(r2.text).toBe('done X');
  });
  it('hash embeddings rank related text higher', async () => {
    const e = new HashEmbedding();
    const [a, b, c] = await e.embed(['My sister Anna is vegetarian', 'Anna does not eat meat, vegetarian diet', 'The car needs new tyres']);
    expect(cosine(a!, b!)).toBeGreaterThan(cosine(a!, c!));
  });
});

describe.skipIf(!process.env.LIVE_LLM)('live Model API', () => {
  it('round-trips a tool call with encrypted reasoning replay', async () => {
    const p = createProvider({ MODEL_API_KEY: process.env.MODEL_API_KEY ?? 'proxy-injected' });
    const tools = [{ type: 'function' as const, name: 'get_time', description: 'Current time in a city', parameters: { type: 'object', properties: { city: { type: 'string' } }, required: ['city'] } }];
    const input: any[] = [{ type: 'message', role: 'user', content: 'What time is it in Zurich? Use the tool.' }];
    const r1 = await p.respond({ input, tools, effort: 'low' });
    expect(r1.toolCalls.length).toBeGreaterThan(0);
    input.push(...r1.output, ...r1.toolCalls.map((c) => ({ type: 'function_call_output', call_id: c.callId, output: '{"time":"14:05"}' })));
    const r2 = await p.respond({ input, tools, effort: 'low' });
    expect(r2.text).toMatch(/14[:.]05|2:05/);
  }, 120_000);
});
