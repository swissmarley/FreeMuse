import { describe, expect, it, vi } from 'vitest';

vi.mock('../src/api', () => ({ api: {}, getToken: async () => null, setToken: async () => {} }));
const { reducer } = await import('../src/store');

const base = { me: undefined, messages: [], streaming: null, thinking: false, activities: [], pendingApprovals: 0, tasksRunning: 0, completedAt: 0, version: 0 };

describe('mobile store reducer', () => {
  it('streams text and finalises the turn', () => {
    let s = reducer(base as any, { t: 'event', e: { type: 'turn.start', turnId: 't', conversationId: 'default' } });
    s = reducer(s, { t: 'event', e: { type: 'text.delta', turnId: 't', delta: 'Hel' } });
    s = reducer(s, { t: 'event', e: { type: 'text.delta', turnId: 't', delta: 'lo' } });
    expect(s.streaming?.text).toBe('Hello');
    s = reducer(s, { t: 'event', e: { type: 'turn.end', turnId: 't', message: { id: 'm', conversationId: 'default', role: 'assistant', text: 'Hello', citations: [], createdAt: '' } } });
    expect(s.streaming).toBeNull();
    expect(s.messages).toHaveLength(1);
    expect(s.thinking).toBe(false);
  });
  it('tracks approvals and tool activity', () => {
    let s = reducer(base as any, { t: 'event', e: { type: 'approval.created', approvalId: 'a', title: 'Send' } });
    expect(s.pendingApprovals).toBe(1);
    s = reducer(s, { t: 'event', e: { type: 'tool.start', turnId: 't', callId: 'c', name: 'x', label: 'Searching' } });
    s = reducer(s, { t: 'event', e: { type: 'tool.end', turnId: 't', callId: 'c', ok: true, summary: 'Done' } });
    expect(s.activities[0]).toMatchObject({ done: true, ok: true });
    s = reducer(s, { t: 'event', e: { type: 'approval.resolved', approvalId: 'a', status: 'executed' } });
    expect(s.pendingApprovals).toBe(0);
  });
});
