/** Provider-neutral conversation items (modelled on the Responses API, mapped for other providers). */
export type ContentPart =
  | { type: 'input_text'; text: string }
  | { type: 'input_image'; image_url: string }
  | { type: 'input_file'; filename: string; file_data: string }
  | { type: 'output_text'; text: string; annotations?: Annotation[] };

export interface Annotation { type: string; url?: string; title?: string; start_index?: number; end_index?: number }

export type Item =
  | { type: 'message'; role: 'user' | 'assistant' | 'system' | 'developer'; content: string | ContentPart[]; phase?: 'commentary' | 'final_answer' }
  | { type: 'function_call'; call_id: string; name: string; arguments: string }
  | { type: 'function_call_output'; call_id: string; output: string }
  | { type: 'reasoning'; encrypted_content: string; summary: { type: 'summary_text'; text: string }[] }
  | { type: 'web_search_call'; id?: string | null; status?: string; action?: unknown };

export interface FunctionTool {
  type: 'function';
  name: string;
  description: string;
  parameters: Record<string, unknown>;
  strict?: boolean;
}
export type ToolDef = FunctionTool | { type: 'web_search' };

export type Effort = 'minimal' | 'low' | 'medium' | 'high' | 'xhigh' | 'max';

export interface LLMRequest {
  model?: string;
  instructions?: string;
  input: Item[];
  tools?: ToolDef[];
  effort?: Effort;
  maxOutputTokens?: number;
  /** JSON schema for structured output. */
  jsonSchema?: { name: string; schema: Record<string, unknown> };
  parallelToolCalls?: boolean;
  signal?: AbortSignal;
}

export interface ToolCall { callId: string; name: string; arguments: string }

export interface LLMResult {
  /** Items to append to history verbatim for the next turn (reasoning, commentary, calls, final message). */
  output: Item[];
  text: string;
  toolCalls: ToolCall[];
  citations: { url: string; title?: string }[];
  usage: { input: number; output: number; reasoning: number };
  model: string;
}

export interface StreamHandlers {
  onTextDelta?: (delta: string) => void;
  onToolCallStart?: (call: { callId: string; name: string }) => void;
  onToolCallArgsDelta?: (callId: string, delta: string) => void;
  onToolCallDone?: (call: ToolCall) => void;
  onReasoningSummary?: (delta: string) => void;
}

export interface LLMProvider {
  readonly name: string;
  respond(req: LLMRequest, handlers?: StreamHandlers): Promise<LLMResult>;
}

export class LLMError extends Error {
  constructor(public status: number, public code: string, message: string, public retryAfterMs?: number) {
    super(message);
  }
  get retryable(): boolean {
    return this.status === 429 || this.status >= 500 || this.status === 0;
  }
}
