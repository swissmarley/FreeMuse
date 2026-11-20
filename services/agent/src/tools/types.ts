import type { FunctionTool } from '@muse/llm';
import type { RunContext } from '../context.js';

export interface Tool<A = any> {
  def: FunctionTool;
  /** Short, plain-language label for the "working on" UI. */
  label: (args: A) => string;
  run: (ctx: RunContext, args: A, callId: string) => Promise<string>;
}

export function fn(name: string, description: string, properties: Record<string, unknown>, required: string[] = []): FunctionTool {
  return { type: 'function', name, description, parameters: { type: 'object', properties, required, additionalProperties: false } };
}

export const S = (description: string) => ({ type: 'string', description });
export const SA = (description: string) => ({ type: 'array', items: { type: 'string' }, description });
export const N = (description: string) => ({ type: 'number', description });

/** Local mailbox/calendar the automated suite attaches. Not a product connection. */
export function withDemo(real: string, demo: string): string[] {
  return process.env.ALLOW_DEMO_CONNECTORS === '1' ? [real, demo] : [real];
}

/** First connected connector among the candidates (real account first when a fixture is also allowed). */
export async function pickConnector(ctx: RunContext, candidates: string[]): Promise<string | null> {
  const rows = await ctx.db.q("SELECT connector FROM connections WHERE user_id=$1 AND status='active' AND connector = ANY($2)", [ctx.userId, candidates]);
  const have = new Set(rows.map((r) => r.connector));
  return candidates.find((c) => have.has(c)) ?? null;
}
