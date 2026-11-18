/**
 * Model API has no embeddings endpoint, so the default is a local feature-hashing embedder (no network, no model
 * download). It is weaker than a neural embedder but private and deterministic; combined with Postgres full-text
 * search it gives good recall for short personal memories. Any OpenAI-compatible /embeddings endpoint can be used.
 */
export const EMBED_DIM = 256;

export interface EmbeddingProvider { readonly name: string; embed(texts: string[]): Promise<number[][]> }

const STOP = new Set('a an the and or of to in on for with is are was were be been my me i you your it this that at by from as do does did have has had not no so we our they them their he she his her'.split(' '));

function fnv1a(s: string): number {
  let h = 0x811c9dc5;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  return h >>> 0;
}

function stem(w: string): string {
  return w.replace(/(ing|ed|es|s)$/u, '').slice(0, 12);
}

export class HashEmbedding implements EmbeddingProvider {
  readonly name = 'hash';
  async embed(texts: string[]): Promise<number[][]> {
    return texts.map((t) => {
      const v = new Array<number>(EMBED_DIM).fill(0);
      const toks = t.toLowerCase().normalize('NFKD').replace(/[^\p{L}\p{N}\s]/gu, ' ').split(/\s+/).filter((w) => w && !STOP.has(w)).map(stem);
      const feats: string[] = [...toks];
      for (let i = 0; i + 1 < toks.length; i++) feats.push(toks[i] + '_' + toks[i + 1]);
      for (const w of toks) for (let i = 0; i + 3 <= w.length; i++) feats.push('#' + w.slice(i, i + 3));
      for (const ft of feats) {
        const h = fnv1a(ft);
        const weight = ft.startsWith('#') ? 0.35 : ft.includes('_') ? 0.7 : 1;
        v[h % EMBED_DIM]! += (h & 0x80000000 ? -1 : 1) * weight;
      }
      const n = Math.sqrt(v.reduce((s, x) => s + x * x, 0)) || 1;
      return v.map((x) => x / n);
    });
  }
}

export class OpenAICompatEmbedding implements EmbeddingProvider {
  readonly name = 'openai-compatible';
  constructor(private cfg: { baseUrl: string; apiKey: string; model: string }) {}
  async embed(texts: string[]): Promise<number[][]> {
    const r = await fetch(this.cfg.baseUrl.replace(/\/$/, '') + '/embeddings', {
      method: 'POST',
      headers: { authorization: `Bearer ${this.cfg.apiKey}`, 'content-type': 'application/json' },
      body: JSON.stringify({ model: this.cfg.model, input: texts, dimensions: EMBED_DIM }),
    });
    if (!r.ok) throw new Error(`embeddings ${r.status}`);
    const j = (await r.json()) as { data: { embedding: number[] }[] };
    return j.data.map((d) => d.embedding.slice(0, EMBED_DIM));
  }
}

export function cosine(a: number[], b: number[]): number {
  let s = 0;
  for (let i = 0; i < Math.min(a.length, b.length); i++) s += a[i]! * b[i]!;
  return s;
}
