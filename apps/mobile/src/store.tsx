import { createContext, useCallback, useContext, useEffect, useMemo, useReducer, type ReactNode } from 'react';
import type { ChatMessage, Me, StreamEvent } from '@muse/core';
import { api, getToken, loadServerUrl, setToken } from './api';

/** Point the client at the saved server address once, before the first request. */
let serverReady: Promise<unknown> | null = null;
const ensureServer = () => (serverReady ??= loadServerUrl().catch(() => api.baseUrl));

export interface Activity { callId: string; label: string; done: boolean; ok: boolean }

interface State {
  me: Me | null | undefined;
  messages: ChatMessage[];
  streaming: { turnId: string; text: string } | null;
  thinking: boolean;
  activities: Activity[];
  pendingApprovals: number;
  tasksRunning: number;
  completedAt: number;
  version: number;
}
type Action = { t: 'me'; me: Me | null } | { t: 'history'; messages: ChatMessage[] } | { t: 'sent'; message: ChatMessage } | { t: 'event'; e: StreamEvent } | { t: 'counts'; a: number; k: number };

const initial: State = { me: undefined, messages: [], streaming: null, thinking: false, activities: [], pendingApprovals: 0, tasksRunning: 0, completedAt: 0, version: 0 };
const add = (l: ChatMessage[], m: ChatMessage) => (l.some((x) => x.id === m.id) ? l : [...l, m]);

export function reducer(s: State, a: Action): State {
  switch (a.t) {
    case 'me': return { ...s, me: a.me };
    case 'history': return { ...s, messages: a.messages };
    case 'sent': return { ...s, messages: add(s.messages, a.message), thinking: true, activities: [] };
    case 'counts': return { ...s, pendingApprovals: a.a, tasksRunning: a.k };
    case 'event': {
      const e = a.e;
      switch (e.type) {
        case 'turn.start': return { ...s, thinking: true, streaming: { turnId: e.turnId, text: '' }, activities: [] };
        case 'text.delta': return { ...s, streaming: { turnId: e.turnId, text: (s.streaming?.turnId === e.turnId ? s.streaming.text : '') + e.delta } };
        case 'tool.start': return { ...s, activities: [...s.activities, { callId: e.callId, label: e.label, done: false, ok: true }] };
        case 'tool.end': return { ...s, activities: s.activities.map((x) => (x.callId === e.callId ? { ...x, done: true, ok: e.ok } : x)) };
        case 'turn.end': return { ...s, thinking: false, streaming: null, activities: [], messages: e.message ? add(s.messages, e.message) : s.messages, completedAt: Date.now() };
        case 'message.created': return { ...s, messages: add(s.messages, e.message) };
        case 'approval.created': return { ...s, pendingApprovals: s.pendingApprovals + 1, version: s.version + 1 };
        case 'approval.resolved': return { ...s, pendingApprovals: Math.max(0, s.pendingApprovals - 1), version: s.version + 1 };
        case 'task.updated': case 'memory.updated': return { ...s, version: s.version + 1 };
        default: return s;
      }
    }
  }
}

interface Ctx { s: State; refreshMe(): Promise<void>; send(text: string, attachments?: { fileId: string }[], channel?: 'text' | 'voice'): Promise<void>; refreshCounts(): Promise<void>; signIn(token: string): Promise<void>; signOut(): Promise<void> }
const C = createContext<Ctx | null>(null);

export function MuseProvider({ children }: { children: ReactNode }) {
  const [s, dispatch] = useReducer(reducer, initial);
  const refreshMe = useCallback(async () => {
    await ensureServer();
    if (!(await getToken())) return dispatch({ t: 'me', me: null });
    try { dispatch({ t: 'me', me: await api.me() }); } catch { dispatch({ t: 'me', me: null }); }
  }, []);
  const refreshCounts = useCallback(async () => {
    try {
      const [a, t] = await Promise.all([api.approvals('pending'), api.tasks()]);
      dispatch({ t: 'counts', a: a.approvals.length, k: t.tasks.filter((x) => ['running', 'queued', 'scheduled', 'waiting_approval'].includes(x.status)).length });
    } catch { /* offline */ }
  }, []);
  useEffect(() => { void refreshMe(); }, [refreshMe]);
  const meId = s.me?.id;
  useEffect(() => {
    if (!meId) return;
    void api.history().then((h) => dispatch({ t: 'history', messages: h.messages })).catch(() => {});
    void refreshCounts();
    return api.stream((e) => { dispatch({ t: 'event', e }); if (e.type === 'task.updated') void refreshCounts(); });
  }, [meId, refreshCounts]);
  const send = useCallback(async (text: string, attachments: { fileId: string }[] = [], channel: 'text' | 'voice' = 'text') => {
    const r = await api.send(text, 'default', attachments, channel);
    dispatch({ t: 'sent', message: r.message });
  }, []);
  const signIn = useCallback(async (token: string) => { await setToken(token); await refreshMe(); }, [refreshMe]);
  const signOut = useCallback(async () => { await api.logout().catch(() => {}); await setToken(null); dispatch({ t: 'me', me: null }); }, []);
  const value = useMemo(() => ({ s, refreshMe, send, refreshCounts, signIn, signOut }), [s, refreshMe, send, refreshCounts, signIn, signOut]);
  return <C.Provider value={value}>{children}</C.Provider>;
}

export function useMuse() {
  const c = useContext(C);
  if (!c) throw new Error('useMuse outside provider');
  return c;
}
