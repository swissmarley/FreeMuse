/**
 * Typed API client shared by web and mobile. SSE is implemented over XMLHttpRequest progress events so the same
 * code works in browsers and React Native (whose fetch has no streaming body).
 */
import type {
  Approval, AuditEvent, ChatMessage, Connection, ConnectorInfo, Memory, StreamEvent, Task, UserSettings,
} from './schemas';
import type { AvatarSettings } from './avatar/config';

export interface ClientOptions {
  baseUrl: string;
  getToken?: () => string | null | Promise<string | null>;
  /** Web uses an httpOnly cookie; mobile sends a bearer token. */
  credentials?: 'include' | 'omit';
  /** Sent as x-muse-client (CSRF guard for cookie sessions). */
  clientName?: string;
}

export class ApiError extends Error {
  constructor(public status: number, public code: string, message: string) {
    super(message);
  }
}

export interface Me {
  id: string;
  email: string;
  createdAt: string;
  avatar: AvatarSettings;
  settings: UserSettings;
  onboarded: boolean;
}

export class MuseClient {
  constructor(private opts: ClientOptions) {}

  private async headers(json = true): Promise<Record<string, string>> {
    const h: Record<string, string> = { 'x-muse-client': this.opts.clientName ?? 'web' };
    if (json) h['content-type'] = 'application/json';
    const tok = await this.opts.getToken?.();
    if (tok) h.authorization = `Bearer ${tok}`;
    return h;
  }

  async req<T>(method: string, path: string, body?: unknown): Promise<T> {
    const res = await fetch(this.opts.baseUrl + path, {
      method,
      headers: await this.headers(body !== undefined),
      body: body === undefined ? undefined : JSON.stringify(body),
      credentials: this.opts.credentials ?? 'include',
    });
    const text = await res.text();
    const data = text ? JSON.parse(text) : {};
    if (!res.ok) throw new ApiError(res.status, data.code ?? 'error', data.message ?? res.statusText);
    return data as T;
  }

  // auth
  signup(input: { email: string; password: string; birthDate: string; acceptTerms: true }) {
    return this.req<{ token: string; me: Me }>('POST', '/v1/auth/signup', input);
  }
  login(email: string, password: string) {
    return this.req<{ token: string; me: Me }>('POST', '/v1/auth/login', { email, password });
  }
  logout() { return this.req<{ ok: true }>('POST', '/v1/auth/logout', {}); }
  me() { return this.req<Me>('GET', '/v1/me'); }
  completeOnboarding() { return this.req<Me>('POST', '/v1/me/onboarded', {}); }

  // chat
  history(conversationId = 'default', before?: string) {
    const q = before ? `?before=${encodeURIComponent(before)}` : '';
    return this.req<{ messages: ChatMessage[] }>('GET', `/v1/conversations/${conversationId}/messages${q}`);
  }
  send(text: string, conversationId = 'default', attachments: { fileId: string }[] = []) {
    return this.req<{ message: ChatMessage; turnId: string }>('POST', `/v1/conversations/${conversationId}/messages`, { text, attachments });
  }
  uploadFile(name: string, mime: string, base64: string) {
    return this.req<{ fileId: string }>('POST', '/v1/files', { name, mime, base64 });
  }

  // approvals / audit / tasks
  approvals(status = 'pending') { return this.req<{ approvals: Approval[] }>('GET', `/v1/approvals?status=${status}`); }
  resolveApproval(id: string, decision: 'approve' | 'reject', editedPayload?: Record<string, unknown>) {
    return this.req<{ approval: Approval }>('POST', `/v1/approvals/${id}`, { decision, editedPayload });
  }
  audit(params: { taskId?: string; before?: number } = {}) {
    const q = new URLSearchParams();
    if (params.taskId) q.set('taskId', params.taskId);
    if (params.before) q.set('before', String(params.before));
    return this.req<{ events: AuditEvent[]; planned: { taskId: string; title: string; step: string }[]; chainValid: boolean }>('GET', `/v1/audit?${q}`);
  }
  tasks() { return this.req<{ tasks: Task[] }>('GET', '/v1/tasks'); }
  cancelTask(id: string) { return this.req<{ task: Task }>('POST', `/v1/tasks/${id}/cancel`, {}); }

  // memory
  memories() { return this.req<{ memories: Memory[] }>('GET', '/v1/memories'); }
  deleteMemory(id: string) { return this.req<{ ok: true }>('DELETE', `/v1/memories/${id}`); }
  addMemory(content: string) { return this.req<{ memory: Memory }>('POST', '/v1/memories', { content }); }

  // connections
  connectors() { return this.req<{ connectors: ConnectorInfo[] }>('GET', '/v1/connectors'); }
  connections() { return this.req<{ connections: Connection[] }>('GET', '/v1/connections'); }
  connect(connector: string, scopes: string[]) {
    return this.req<{ authorizeUrl?: string; connection?: Connection }>('POST', `/v1/connectors/${connector}/connect`, { scopes });
  }
  updateScopes(id: string, scopes: string[]) { return this.req<{ connection: Connection; authorizeUrl?: string }>('PATCH', `/v1/connections/${id}`, { scopes }); }
  disconnect(id: string) { return this.req<{ ok: true }>('DELETE', `/v1/connections/${id}`); }

  // vault (write-only from the client's perspective: values are never returned)
  vaultList() { return this.req<{ items: { id: string; service: string; username: string; createdAt: string }[] }>('GET', '/v1/vault'); }
  vaultPut(service: string, username: string, password: string) { return this.req<{ id: string }>('POST', '/v1/vault', { service, username, password }); }
  vaultDelete(id: string) { return this.req<{ ok: true }>('DELETE', `/v1/vault/${id}`); }

  // avatar & settings
  saveAvatar(a: AvatarSettings) { return this.req<{ avatar: AvatarSettings }>('PUT', '/v1/me/avatar', a); }
  saveSettings(s: Partial<UserSettings>) { return this.req<{ settings: UserSettings }>('PATCH', '/v1/me/settings', s); }
  exportData() { return this.req<Record<string, unknown>>('GET', '/v1/me/export'); }
  deleteAccount() { return this.req<{ ok: true }>('DELETE', '/v1/me'); }

  // push
  vapidKey() { return this.req<{ publicKey: string | null }>('GET', '/v1/push/vapid'); }
  registerPush(sub: { kind: 'webpush' | 'expo'; token: unknown }) { return this.req<{ ok: true }>('POST', '/v1/push/register', sub); }
  notifications() { return this.req<{ notifications: { id: string; title: string; body: string; url: string; read: boolean; createdAt: string }[] }>('GET', '/v1/notifications'); }

  // voice
  transcribe(base64Audio: string, mime: string) { return this.req<{ text: string }>('POST', '/v1/voice/transcribe', { audio: base64Audio, mime }); }

  /** Subscribe to server events. Returns an unsubscribe function. Reconnects with backoff. */
  stream(onEvent: (e: StreamEvent) => void, onStatus?: (s: 'open' | 'closed') => void): () => void {
    let closed = false;
    let xhr: XMLHttpRequest | null = null;
    let retry = 500;
    const connect = async () => {
      if (closed) return;
      const tok = await this.opts.getToken?.();
      xhr = new XMLHttpRequest();
      xhr.open('GET', this.opts.baseUrl + '/v1/events');
      xhr.setRequestHeader('accept', 'text/event-stream');
      if (tok) xhr.setRequestHeader('authorization', `Bearer ${tok}`);
      xhr.withCredentials = (this.opts.credentials ?? 'include') === 'include';
      let seen = 0;
      let buf = '';
      xhr.onprogress = () => {
        if (!xhr) return;
        retry = 500;
        const chunk = xhr.responseText.slice(seen);
        seen = xhr.responseText.length;
        buf += chunk;
        const parts = buf.split('\n\n');
        buf = parts.pop() ?? '';
        for (const p of parts) {
          const data = p.split('\n').filter((l) => l.startsWith('data:')).map((l) => l.slice(5).trim()).join('\n');
          if (!data) continue;
          try { onEvent(JSON.parse(data) as StreamEvent); } catch { /* ignore malformed */ }
        }
      };
      xhr.onreadystatechange = () => {
        if (!xhr) return;
        if (xhr.readyState === 2) onStatus?.('open');
        if (xhr.readyState === 4) {
          onStatus?.('closed');
          if (!closed) setTimeout(connect, (retry = Math.min(retry * 2, 15_000)));
        }
      };
      xhr.send();
    };
    void connect();
    return () => { closed = true; xhr?.abort(); };
  }
}
