/**
 * Google connectors (Gmail, Calendar, Drive) via OAuth 2.0 + PKCE with granular scopes.
 * Requires your own Google Cloud OAuth client (GOOGLE_CLIENT_ID/SECRET). Tokens live only in the vault.
 */
import { CONNECTOR_SCOPES } from '@muse/security';
import type { ApiConfig } from '../config.js';
import { ConnectorError, type ConnectorImpl, type ExecCtx } from './types.js';

const G = 'https://www.googleapis.com/auth/';
export const GOOGLE_SCOPE_MAP: Record<string, Record<string, string[]>> = {
  gmail: { read: [G + 'gmail.readonly'], compose: [G + 'gmail.compose'], send: [G + 'gmail.send'] },
  gcal: { read: [G + 'calendar.readonly'], write: [G + 'calendar.events'] },
  gdrive: { read: [G + 'drive.readonly'] },
};

interface Tokens { access_token: string; refresh_token?: string; expires_at: number; scope?: string }

export const redirectUri = (cfg: ApiConfig) => `${cfg.publicUrl}/v1/oauth/google/callback`;

/** Vault service name for the user's own Google OAuth client (entered in the in-app setup guide). */
export const GOOGLE_APP_SERVICE = 'google_app';
export interface GoogleApp { clientId: string; clientSecret: string; source: 'you' | 'server' }
type AppCtx = Pick<ExecCtx, 'userId' | 'vault' | 'cfg'>;

/** The Google OAuth client to use: the one this user saved in the app, else the server's GOOGLE_CLIENT_ID/SECRET. */
export async function googleApp(ctx: AppCtx): Promise<GoogleApp | null> {
  const id = await ctx.vault.findId(ctx.userId, 'oauth', GOOGLE_APP_SERVICE);
  if (id) {
    const it = await ctx.vault.get<{ clientId: string; clientSecret: string }>(ctx.userId, id).catch(() => null);
    if (it?.secret.clientId && it.secret.clientSecret) return { clientId: it.secret.clientId, clientSecret: it.secret.clientSecret, source: 'you' };
  }
  if (ctx.cfg.googleClientId && ctx.cfg.googleClientSecret) return { clientId: ctx.cfg.googleClientId, clientSecret: ctx.cfg.googleClientSecret, source: 'server' };
  return null;
}

async function requireApp(ctx: AppCtx): Promise<GoogleApp> {
  const app = await googleApp(ctx);
  if (!app) throw new ConnectorError('not_configured', 'Google is not set up yet. Open Connections and follow "Set up Google" (takes about 2 minutes).');
  return app;
}

/** Consent URL for any set of Google API scopes (one screen, even for several services). */
export async function googleAuthorizeUrl(ctx: AppCtx, googleScopeList: string[], state: string, challenge: string): Promise<string> {
  const app = await requireApp(ctx);
  const u = new URL('https://accounts.google.com/o/oauth2/v2/auth');
  u.search = new URLSearchParams({
    client_id: app.clientId, redirect_uri: redirectUri(ctx.cfg), response_type: 'code', access_type: 'offline', prompt: 'consent',
    include_granted_scopes: 'false', scope: [...new Set(['openid', 'email', ...googleScopeList])].join(' '), state, code_challenge: challenge, code_challenge_method: 'S256',
  }).toString();
  return u.toString();
}

/** Exchange an authorization code; store the tokens in the vault under `service`. */
export async function googleExchange(ctx: AppCtx, service: string, code: string, verifier: string): Promise<{ account: string; vaultId: string }> {
  const app = await requireApp(ctx);
  const j = await tokenRequest({ client_id: app.clientId, client_secret: app.clientSecret, code, code_verifier: verifier, grant_type: 'authorization_code', redirect_uri: redirectUri(ctx.cfg) });
  let account = 'Google account';
  try { account = JSON.parse(Buffer.from(String(j.id_token).split('.')[1]!, 'base64url').toString()).email ?? account; } catch { /* keep default */ }
  const vaultId = await ctx.vault.put(ctx.userId, 'oauth', service, account, { access_token: j.access_token, refresh_token: j.refresh_token, expires_at: Date.now() + j.expires_in * 1000, scope: j.scope });
  return { account, vaultId };
}

/**
 * Check a client id/secret pair with Google without any user consent: a bogus code is rejected with
 * "invalid_grant" when the client is valid and "invalid_client" when it isn't. Returns null if Google can't be reached.
 */
export async function verifyGoogleClient(cfg: ApiConfig, clientId: string, clientSecret: string): Promise<boolean | null> {
  try {
    const r = await fetch('https://oauth2.googleapis.com/token', {
      method: 'POST', headers: { 'content-type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({ client_id: clientId, client_secret: clientSecret, code: 'freemuse-setup-check', grant_type: 'authorization_code', redirect_uri: redirectUri(cfg) }),
      signal: AbortSignal.timeout(8000),
    });
    const j = await r.json().catch(() => ({}));
    if (j.error === 'invalid_client' || j.error === 'unauthorized_client') return false;
    return true;
  } catch {
    return null;
  }
}

export function googleScopes(connector: string, scopes: string[]): string[] {
  const m = GOOGLE_SCOPE_MAP[connector] ?? {};
  return ['openid', 'email', ...new Set(scopes.flatMap((s) => m[s] ?? []))];
}

async function tokenRequest(body: Record<string, string>): Promise<any> {
  const r = await fetch('https://oauth2.googleapis.com/token', { method: 'POST', headers: { 'content-type': 'application/x-www-form-urlencoded' }, body: new URLSearchParams(body) });
  const j = await r.json();
  if (!r.ok) throw new ConnectorError('oauth', `Google token error: ${j.error_description ?? j.error ?? r.status}`);
  return j;
}

async function accessToken(ctx: ExecCtx, service: string): Promise<string> {
  if (!ctx.vaultId) throw new ConnectorError('not_connected', `${service} is not connected`);
  const item = await ctx.vault.get<Tokens & Record<string, unknown>>(ctx.userId, ctx.vaultId);
  if (!item) throw new ConnectorError('not_connected', `${service} tokens missing`);
  const t = item.secret;
  if (t.expires_at > Date.now() + 60_000) return t.access_token;
  if (!t.refresh_token) throw new ConnectorError('reauth', 'Please reconnect your Google account');
  const app = await requireApp(ctx);
  const j = await tokenRequest({ client_id: app.clientId, client_secret: app.clientSecret, refresh_token: t.refresh_token, grant_type: 'refresh_token' });
  const next = { ...t, access_token: j.access_token, expires_at: Date.now() + j.expires_in * 1000 };
  await ctx.vault.put(ctx.userId, 'oauth', item.service, item.username, next);
  return next.access_token;
}

async function gapi(ctx: ExecCtx, service: string, url: string, init: RequestInit = {}): Promise<any> {
  const tok = await accessToken(ctx, service);
  const r = await fetch(url, { ...init, headers: { ...(init.headers ?? {}), authorization: `Bearer ${tok}`, 'content-type': 'application/json' } });
  const text = await r.text();
  if (!r.ok) throw new ConnectorError('google_api', `Google API ${r.status}: ${text.slice(0, 200)}`);
  return text ? JSON.parse(text) : {};
}

function b64url(s: string) { return Buffer.from(s, 'utf8').toString('base64url'); }
function header(h: { name: string; value: string }[] | undefined, n: string) { return h?.find((x) => x.name.toLowerCase() === n)?.value ?? ''; }

function decodeBody(payload: any): string {
  if (!payload) return '';
  if (payload.mimeType === 'text/plain' && payload.body?.data) return Buffer.from(payload.body.data, 'base64url').toString('utf8');
  for (const p of payload.parts ?? []) {
    const t = decodeBody(p);
    if (t) return t;
  }
  if (payload.body?.data) return Buffer.from(payload.body.data, 'base64url').toString('utf8').replace(/<[^>]+>/g, ' ');
  return '';
}

export function rfc822(p: { to: string[]; cc?: string[]; subject: string; body: string }): string {
  const clean = (s: string) => s.replace(/[\r\n]+/g, ' ');
  const lines = [`To: ${p.to.map(clean).join(', ')}`];
  if (p.cc?.length) lines.push(`Cc: ${p.cc.map(clean).join(', ')}`);
  lines.push(`Subject: ${clean(p.subject)}`, 'MIME-Version: 1.0', 'Content-Type: text/plain; charset="UTF-8"', '', p.body);
  return lines.join('\r\n');
}

const list = (v: unknown): string[] => (Array.isArray(v) ? v.map(String) : typeof v === 'string' ? v.split(/[,;]\s*/) : []).map((s) => s.trim()).filter(Boolean);

function googleConnector(id: 'gmail' | 'gcal' | 'gdrive', name: string, description: string, exec: ConnectorImpl['execute']): ConnectorImpl {
  return {
    id,
    info: (cfg) => ({ id, name, description, kind: 'oauth', group: 'google', available: !!(cfg.googleClientId && cfg.googleClientSecret), scopes: CONNECTOR_SCOPES[id]! }),
    async connect(ctx, scopes, state, challenge) {
      return { authorizeUrl: await googleAuthorizeUrl(ctx, googleScopes(id, scopes), state, challenge) };
    },
    async complete(ctx, code, verifier) {
      return googleExchange(ctx, id, code, verifier);
    },
    async revoke(ctx) {
      if (!ctx.vaultId) return;
      const item = await ctx.vault.get<Tokens & Record<string, unknown>>(ctx.userId, ctx.vaultId).catch(() => null);
      const tok = item?.secret.refresh_token ?? item?.secret.access_token;
      if (tok) await fetch(`https://oauth2.googleapis.com/revoke?token=${encodeURIComponent(tok)}`, { method: 'POST' }).catch(() => {});
      await ctx.vault.remove(ctx.userId, ctx.vaultId);
    },
    execute: exec,
  };
}

const GM = 'https://gmail.googleapis.com/gmail/v1/users/me';

export const gmail = googleConnector('gmail', 'Gmail', 'Read, draft and (with your approval) send email from your Gmail.', async (ctx, op, p) => {
  switch (op) {
    case 'search_email': {
      const q = new URLSearchParams({ q: String(p.query ?? ''), maxResults: String(Math.min(Number(p.max ?? 10), 25)) });
      const res = await gapi(ctx, 'gmail', `${GM}/messages?${q}`);
      const out = [];
      for (const m of res.messages ?? []) {
        const d = await gapi(ctx, 'gmail', `${GM}/messages/${m.id}?format=metadata&metadataHeaders=From&metadataHeaders=Subject&metadataHeaders=Date`);
        out.push({ id: m.id, from: header(d.payload?.headers, 'from'), subject: header(d.payload?.headers, 'subject'), date: header(d.payload?.headers, 'date'), snippet: d.snippet });
      }
      return out;
    }
    case 'read_email': {
      const d = await gapi(ctx, 'gmail', `${GM}/messages/${encodeURIComponent(String(p.id))}?format=full`);
      return { id: d.id, from: header(d.payload?.headers, 'from'), to: header(d.payload?.headers, 'to'), subject: header(d.payload?.headers, 'subject'), date: header(d.payload?.headers, 'date'), body: decodeBody(d.payload).slice(0, 20_000) };
    }
    case 'draft_email': {
      const raw = b64url(rfc822({ to: list(p.to), cc: list(p.cc), subject: String(p.subject ?? ''), body: String(p.body ?? '') }));
      const d = await gapi(ctx, 'gmail', `${GM}/drafts`, { method: 'POST', body: JSON.stringify({ message: { raw } }) });
      return { id: d.id, status: 'draft saved' };
    }
    case 'send_email': {
      const raw = b64url(rfc822({ to: list(p.to), cc: list(p.cc), subject: String(p.subject ?? ''), body: String(p.body ?? '') }));
      const d = await gapi(ctx, 'gmail', `${GM}/messages/send`, { method: 'POST', body: JSON.stringify({ raw }) });
      return { id: d.id, status: 'sent' };
    }
  }
  throw new ConnectorError('unknown_operation', op);
});

const CAL = 'https://www.googleapis.com/calendar/v3/calendars/primary/events';
export const gcal = googleConnector('gcal', 'Google Calendar', 'See your schedule and (with approval) add events.', async (ctx, op, p) => {
  if (op === 'list_events') {
    const q = new URLSearchParams({ timeMin: new Date(String(p.from ?? new Date().toISOString())).toISOString(), timeMax: new Date(String(p.to ?? new Date(Date.now() + 14 * 86400_000).toISOString())).toISOString(), singleEvents: 'true', orderBy: 'startTime', maxResults: '50' });
    const r = await gapi(ctx, 'gcal', `${CAL}?${q}`);
    return (r.items ?? []).map((e: any) => ({ id: e.id, title: e.summary, start: e.start?.dateTime ?? e.start?.date, end: e.end?.dateTime ?? e.end?.date, location: e.location, attendees: (e.attendees ?? []).map((a: any) => a.email) }));
  }
  if (op === 'create_event') {
    const body = { summary: p.title, location: p.location, description: p.notes, start: { dateTime: new Date(String(p.start)).toISOString() }, end: { dateTime: new Date(String(p.end ?? new Date(new Date(String(p.start)).getTime() + 3600_000).toISOString())).toISOString() }, attendees: list(p.attendees).map((email) => ({ email })) };
    const r = await gapi(ctx, 'gcal', `${CAL}?sendUpdates=all`, { method: 'POST', body: JSON.stringify(body) });
    return { id: r.id, status: 'created', link: r.htmlLink };
  }
  throw new ConnectorError('unknown_operation', op);
});

const DRV = 'https://www.googleapis.com/drive/v3/files';
export const gdrive = googleConnector('gdrive', 'Google Drive', 'Search and read your documents.', async (ctx, op, p) => {
  if (op === 'search_files') {
    const q = new URLSearchParams({ q: `fullText contains '${String(p.query ?? '').replace(/['\\]/g, ' ')}' and trashed = false`, pageSize: '10', fields: 'files(id,name,mimeType,modifiedTime)' });
    return (await gapi(ctx, 'gdrive', `${DRV}?${q}`)).files ?? [];
  }
  if (op === 'read_file') {
    const id = encodeURIComponent(String(p.id));
    const meta = await gapi(ctx, 'gdrive', `${DRV}/${id}?fields=id,name,mimeType`);
    const tok = await accessToken(ctx, 'gdrive');
    const url = String(meta.mimeType).startsWith('application/vnd.google-apps') ? `${DRV}/${id}/export?mimeType=text/plain` : `${DRV}/${id}?alt=media`;
    const r = await fetch(url, { headers: { authorization: `Bearer ${tok}` } });
    if (!r.ok) throw new ConnectorError('google_api', `Drive ${r.status}`);
    return { id: meta.id, name: meta.name, text: (await r.text()).slice(0, 50_000) };
  }
  throw new ConnectorError('unknown_operation', op);
});
