'use client';
import { createContext, useCallback, useContext, useEffect, useMemo, useReducer, useRef, type ReactNode } from 'react';
import type { ChatMessage, Me, StreamEvent } from '@muse/core';
import { fmt as format, strings } from '@muse/core/i18n';
import { api } from './api';

export interface Activity { callId: string; label: string; done: boolean; ok: boolean; summary?: string }
export interface Toast { id: number; text: string; href?: string }

interface State {
  me: Me | null | undefined;
  messages: ChatMessage[];
  streaming: { turnId: string; text: string } | null;
  thinking: boolean;
  activities: Activity[];
  pendingApprovals: number;
  tasksRunning: number;
  completedAt: number;
  online: boolean;
  toasts: Toast[];
  memoryCount: number | null;
  version: number; // bumps on task/approval/memory changes so pages can refetch
}

type Action =
  | { t: 'me'; me: Me | null }
  | { t: 'history'; messages: ChatMessage[] }
  | { t: 'sent'; message: ChatMessage }
  | { t: 'event'; e: StreamEvent }
  | { t: 'counts'; approvals: number; tasks: number }
  | { t: 'online'; v: boolean }
  | { t: 'toast'; toast: Toast }
  | { t: 'untoast'; id: number };

const initial: State = { me: undefined, messages: [], streaming: null, thinking: false, activities: [], pendingApprovals: 0, tasksRunning: 0, completedAt: 0, online: false, toasts: [], memoryCount: null, version: 0 };

function addMessage(list: ChatMessage[], m: ChatMessage) {
  return list.some((x) => x.id === m.id) ? list : [...list, m];
}

function reducer(s: State, a: Action): State {
  switch (a.t) {
    case 'me': return { ...s, me: a.me };
    case 'history': return { ...s, messages: a.messages };
    case 'sent': return { ...s, messages: addMessage(s.messages, a.message), thinking: true, activities: [] };
    case 'counts': return { ...s, pendingApprovals: a.approvals, tasksRunning: a.tasks };
    case 'online': return { ...s, online: a.v };
    case 'toast': return { ...s, toasts: [...s.toasts.slice(-2), a.toast] };
    case 'untoast': return { ...s, toasts: s.toasts.filter((t) => t.id !== a.id) };
    case 'event': {
      const e = a.e;
      switch (e.type) {
        case 'turn.start': return { ...s, thinking: true, streaming: { turnId: e.turnId, text: '' }, activities: [] };
        case 'text.delta': return { ...s, streaming: { turnId: e.turnId, text: (s.streaming?.turnId === e.turnId ? s.streaming.text : '') + e.delta } };
        case 'tool.start': return { ...s, activities: [...s.activities.filter((x) => x.callId !== e.callId), { callId: e.callId, label: e.label, done: false, ok: true }] };
        case 'tool.end': return { ...s, activities: s.activities.map((x) => (x.callId === e.callId ? { ...x, done: true, ok: e.ok, summary: e.summary } : x)) };
        case 'turn.end': return { ...s, thinking: false, streaming: null, activities: [], messages: e.message ? addMessage(s.messages, e.message) : s.messages, completedAt: Date.now() };
        case 'message.created': return { ...s, messages: addMessage(s.messages, e.message) };
        case 'approval.created': return { ...s, pendingApprovals: s.pendingApprovals + 1, version: s.version + 1 };
        case 'approval.resolved': return { ...s, pendingApprovals: Math.max(0, s.pendingApprovals - 1), version: s.version + 1 };
        case 'task.updated': return { ...s, version: s.version + 1, completedAt: e.status === 'done' ? Date.now() : s.completedAt };
        case 'memory.updated': return { ...s, memoryCount: e.count, version: s.version + 1 };
        default: return s;
      }
    }
  }
}

interface Ctx {
  s: State;
  refreshMe(): Promise<void>;
  send(text: string, attachments?: { fileId: string }[], channel?: 'text' | 'voice'): Promise<void>;
  refreshCounts(): Promise<void>;
  toast(text: string, href?: string): void;
}

const MuseCtx = createContext<Ctx | null>(null);

export function MuseProvider({ children }: { children: ReactNode }) {
  const [s, dispatch] = useReducer(reducer, initial);
  const toastId = useRef(0);

  const toast = useCallback((text: string, href?: string) => {
    const id = ++toastId.current;
    dispatch({ t: 'toast', toast: { id, text, href } });
    setTimeout(() => dispatch({ t: 'untoast', id }), 5000);
  }, []);

  const refreshMe = useCallback(async () => {
    try { dispatch({ t: 'me', me: await api.me() }); } catch { dispatch({ t: 'me', me: null }); }
  }, []);

  const refreshCounts = useCallback(async () => {
    try {
      const [a, t] = await Promise.all([api.approvals('pending'), api.tasks()]);
      dispatch({ t: 'counts', approvals: a.approvals.length, tasks: t.tasks.filter((x) => ['running', 'queued', 'scheduled', 'waiting_approval'].includes(x.status)).length });
    } catch { /* signed out */ }
  }, []);

  useEffect(() => { void refreshMe(); }, [refreshMe]);
  const langRef = useRef('en');
  langRef.current = s.me?.settings.language ?? 'en';

  const meId = s.me?.id;
  useEffect(() => {
    if (!meId) return;
    void api.history().then((h) => dispatch({ t: 'history', messages: h.messages })).catch(() => {});
    void refreshCounts();
    const stop = api.stream((e) => {
      dispatch({ t: 'event', e });
      const t = strings(langRef.current);
      if (e.type === 'approval.created') toast(format(t.needsYourOk, { title: e.title }), '/approvals');
      if (e.type === 'task.updated') void refreshCounts();
      if (e.type === 'message.created' && e.message.role === 'proactive') toast(t.newSuggestion, '/');
    }, (st) => dispatch({ t: 'online', v: st === 'open' }));
    return stop;
  }, [meId, refreshCounts, toast]);

  const send = useCallback(async (text: string, attachments: { fileId: string }[] = [], channel: 'text' | 'voice' = 'text') => {
    const r = await api.send(text, 'default', attachments, channel);
    dispatch({ t: 'sent', message: r.message });
  }, []);

  const value = useMemo(() => ({ s, refreshMe, send, refreshCounts, toast }), [s, refreshMe, send, refreshCounts, toast]);
  return <MuseCtx.Provider value={value}>{children}</MuseCtx.Provider>;
}

export function useMuse(): Ctx {
  const c = useContext(MuseCtx);
  if (!c) throw new Error('useMuse outside provider');
  return c;
}

/** Strings helper with {name} interpolation. */
export const fmt = format;
