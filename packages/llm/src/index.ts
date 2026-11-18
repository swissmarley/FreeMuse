export * from './types.js';
export * from './retry.js';
export * from './responses.js';
export * from './chat.js';
export * from './scripted.js';
export * from './embeddings.js';
import { ChatCompletionsProvider } from './chat.js';
import { HashEmbedding, OpenAICompatEmbedding, type EmbeddingProvider } from './embeddings.js';
import { ResponsesProvider } from './responses.js';
import type { LLMProvider } from './types.js';

export interface LLMEnv {
  LLM_PROVIDER?: string;
  LLM_BASE_URL?: string;
  MODEL_API_KEY?: string;
  LLM_MODEL?: string;
  LLM_FALLBACK_MODEL?: string;
  EMBEDDINGS_PROVIDER?: string;
  EMBEDDINGS_BASE_URL?: string;
  EMBEDDINGS_API_KEY?: string;
  EMBEDDINGS_MODEL?: string;
}

export const DEFAULTS = {
  baseUrl: 'https://api.meta.ai/v1',
  model: 'muse-spark-1.3',
  fallbackModel: 'muse-spark-1.1',
} as const;

/**
 * Build the configured provider. The key is read from the env object passed in (MODEL_API_KEY) and never logged.
 * Contributor-mode model ids (which allow training on your content) are refused.
 */
export function createProvider(env: LLMEnv, keyVar: keyof LLMEnv = 'MODEL_API_KEY'): LLMProvider {
  const apiKey = env[keyVar] ?? env.MODEL_API_KEY;
  if (!apiKey) throw new Error(`${String(keyVar)} is not set`);
  const model = env.LLM_MODEL || DEFAULTS.model;
  if (/-contributor$/.test(model)) throw new Error('Contributor-mode models are disabled (training opt-out).');
  const baseUrl = env.LLM_BASE_URL || DEFAULTS.baseUrl;
  if ((env.LLM_PROVIDER || 'responses') === 'chat') return new ChatCompletionsProvider({ baseUrl, apiKey, model });
  return new ResponsesProvider({ baseUrl, apiKey, model, fallbackModel: env.LLM_FALLBACK_MODEL || DEFAULTS.fallbackModel });
}

export function createEmbedder(env: LLMEnv): EmbeddingProvider {
  if (env.EMBEDDINGS_PROVIDER === 'openai-compatible' && env.EMBEDDINGS_BASE_URL) {
    return new OpenAICompatEmbedding({ baseUrl: env.EMBEDDINGS_BASE_URL, apiKey: env.EMBEDDINGS_API_KEY ?? '', model: env.EMBEDDINGS_MODEL ?? 'text-embedding-3-small' });
  }
  return new HashEmbedding();
}
