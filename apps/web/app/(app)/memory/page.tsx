'use client';
import { useCallback, useEffect, useState } from 'react';
import type { Memory } from '@muse/core';
import { strings } from '@muse/core/i18n';
import { api } from '../../../lib/api';
import { useMuse } from '../../../lib/store';

const KIND: Record<string, string> = { fact: 'About you', preference: 'Preference', person: 'People', goal: 'Goal', routine: 'Routine' };

export default function MemoryPage() {
  const { s, toast } = useMuse();
  const t = strings(s.me!.settings.language);
  const [mems, setMems] = useState<Memory[] | null>(null);
  const [q, setQ] = useState('');
  const [add, setAdd] = useState('');
  const load = useCallback(async () => setMems((await api.memories()).memories), []);
  useEffect(() => { void load(); }, [load, s.version]);
  const shown = (mems ?? []).filter((m) => m.content.toLowerCase().includes(q.toLowerCase()));
  return (
    <main className="page">
      <h1>{t.memory}</h1>
      <p className="lead">What {s.me!.avatar.name} remembers to help you better. Delete anything, any time, or just say “forget …” in chat.</p>
      <form className="row" style={{ marginBottom: 16 }} onSubmit={async (e) => { e.preventDefault(); if (!add.trim()) return; await api.addMemory(add.trim()); setAdd(''); toast('Saved'); void load(); }}>
        <label className="sr-only" htmlFor="addmem">Add a memory</label>
        <input id="addmem" className="input" style={{ flex: 1 }} placeholder="Add something to remember…" value={add} onChange={(e) => setAdd(e.target.value)} maxLength={500} />
        <button className="btn" type="submit">Add</button>
      </form>
      <label className="sr-only" htmlFor="memsearch">Search memories</label>
      <input id="memsearch" className="input" placeholder="Search…" value={q} onChange={(e) => setQ(e.target.value)} style={{ marginBottom: 16 }} />
      <div className="stack">
        {mems === null ? <p className="muted">Loading…</p> : shown.length === 0 ? <p className="empty">Nothing remembered yet.</p> : shown.map((m) => (
          <div key={m.id} className="card row pop" style={{ justifyContent: 'space-between', padding: 14 }}>
            <div style={{ flex: 1, minWidth: 200 }}>
              <div>{m.content}</div>
              <div className="muted" style={{ fontSize: '.8rem' }}>{KIND[m.kind] ?? m.kind} · from {m.source} · {new Date(m.createdAt).toLocaleDateString()}</div>
            </div>
            <button className="btn ghost" aria-label={`Forget: ${m.content}`} onClick={async () => { await api.deleteMemory(m.id); toast('Forgotten'); void load(); }}>{t.forget}</button>
          </div>
        ))}
      </div>
    </main>
  );
}
