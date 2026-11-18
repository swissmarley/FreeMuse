export interface ApiConfig {
  port: number;
  jwtSecret: string;
  vaultMasterKey: string;
  sentinelPublicKey: string;
  sentinelUrl: string;
  sentinelClientToken: string;
  executorPrivateKey: string;
  internalToken: string;
  webOrigin: string[];
  publicUrl: string;
  googleClientId?: string;
  googleClientSecret?: string;
  vapidPublic?: string;
  vapidPrivate?: string;
  vapidSubject: string;
  expoAccessToken?: string;
  paymentProvider: string;
  stripeTestKey?: string;
  modelApiKey?: string;
  llmBaseUrl: string;
  sttProvider: string;
  /** provider: 'local' (natural Kokoro voices inside the API, default) | 'openai-compatible' | 'device' (on-device only). */
  tts: { provider: string; baseUrl?: string; apiKey?: string; model?: string; voice?: string; dtype?: string; cacheDir?: string; preload?: boolean };
  secureCookies: boolean;
  /** Users may opt in to Contributor-mode models (ALLOW_CONTRIBUTOR_MODE, default true). */
  allowContributorMode: boolean;
  /** ElevenLabs API base (users bring their own key). */
  elevenlabsBaseUrl: string;
}

const req = (n: string) => {
  const v = process.env[n];
  if (!v) throw new Error(`Missing required env var ${n} (run: pnpm gen:keys >> .env)`);
  return v;
};

export function loadConfig(): ApiConfig {
  return {
    port: Number(process.env.API_PORT ?? 4000),
    jwtSecret: req('JWT_SECRET'),
    vaultMasterKey: req('VAULT_MASTER_KEY'),
    sentinelPublicKey: req('SENTINEL_PUBLIC_KEY'),
    sentinelUrl: process.env.SENTINEL_URL ?? 'http://localhost:4100',
    sentinelClientToken: req('SENTINEL_CLIENT_TOKEN'),
    executorPrivateKey: req('EXECUTOR_PRIVATE_KEY'),
    internalToken: req('INTERNAL_TOKEN'),
    webOrigin: (process.env.WEB_ORIGIN ?? 'http://localhost:3000').split(',').map((s) => s.trim()),
    publicUrl: process.env.API_PUBLIC_URL ?? 'http://localhost:4000',
    googleClientId: process.env.GOOGLE_CLIENT_ID || undefined,
    googleClientSecret: process.env.GOOGLE_CLIENT_SECRET || undefined,
    vapidPublic: process.env.VAPID_PUBLIC_KEY || undefined,
    vapidPrivate: process.env.VAPID_PRIVATE_KEY || undefined,
    vapidSubject: process.env.VAPID_SUBJECT ?? 'mailto:admin@localhost',
    expoAccessToken: process.env.EXPO_ACCESS_TOKEN || undefined,
    paymentProvider: process.env.PAYMENT_PROVIDER ?? 'virtual-card-stub',
    stripeTestKey: process.env.STRIPE_TEST_SECRET_KEY || undefined,
    modelApiKey: process.env.MODEL_API_KEY || undefined,
    llmBaseUrl: process.env.LLM_BASE_URL ?? 'https://api.meta.ai/v1',
    sttProvider: process.env.STT_PROVIDER ?? 'meta',
    tts: {
      provider: (process.env.TTS_PROVIDER || 'local').replace(/^kokoro$/, 'local'),
      baseUrl: process.env.TTS_BASE_URL || undefined,
      apiKey: process.env.TTS_API_KEY || undefined,
      model: process.env.TTS_MODEL || undefined,
      voice: process.env.TTS_VOICE || undefined,
      dtype: process.env.TTS_DTYPE || 'q8',
      cacheDir: process.env.TTS_CACHE_DIR || undefined,
      preload: process.env.TTS_PRELOAD !== 'false',
    },
    secureCookies: (process.env.API_PUBLIC_URL ?? '').startsWith('https://'),
    allowContributorMode: process.env.ALLOW_CONTRIBUTOR_MODE !== 'false',
    elevenlabsBaseUrl: (process.env.ELEVENLABS_BASE_URL || 'https://api.elevenlabs.io').replace(/\/$/, ''),
  };
}
