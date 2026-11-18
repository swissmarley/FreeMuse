'use client';
import { useCallback, useEffect, useState } from 'react';
import type { Memory } from '@muse/core';
import { fmt, speechLocale, strings, type Strings } from '@muse/core/i18n';
import { api } from '../../../lib/api';
import { useMuse } from '../../../lib/store';

const KIND: Record<string, keyof Strings> = { fact: 'kindFact', preference: 'kindPreference', person: 'kindPerson', goal: 'kindGoal', routine: 'kindRoutine' };

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
      <p className="lead">{fmt(t.memoryLead, { name: s.me!.avatar.name })}</p>
      <form className="row" style={{ marginBottom: 16 }} onSubmit={async (e) => { e.preventDefault(); if (!add.trim()) return; await api.addMemory(add.trim()); setAdd(''); toast(t.saved); void load(); }}>
        <label className="sr-only" htmlFor="addmem">{t.addMemory}</label>
        <input id="addmem" className="input" style={{ flex: 1 }} placeholder={t.addMemoryPlaceholder} value={add} onChange={(e) => setAdd(e.target.value)} maxLength={500} />
        <button className="btn" type="submit">{t.add}</button>
      </form>
      <label className="sr-only" htmlFor="memsearch">{t.searchMemories}</label>
      <input id="memsearch" className="input" placeholder={t.searchMemories} value={q} onChange={(e) => setQ(e.target.value)} style={{ marginBottom: 16 }} />
      <div className="stack">
        {mems === null ? <p className="muted">{t.loading}</p> : shown.length === 0 ? <p className="empty">{t.nothingRemembered}</p> : shown.map((m) => (
          <div key={m.id} className="card row pop" style={{ justifyContent: 'space-between', padding: 14 }}>
            <div style={{ flex: 1, minWidth: 200 }}>
              <div>{m.content}</div>
              <div className="muted" style={{ fontSize: '.8rem' }}>{KIND[m.kind] ? t[KIND[m.kind]!] : m.kind} · {fmt(t.fromSource, { source: m.source })} · {new Date(m.createdAt).toLocaleDateString(speechLocale(s.me!.settings.language))}</div>
            </div>
            <button className="btn ghost" aria-label={`${t.forget}: ${m.content}`} onClick={async () => { await api.deleteMemory(m.id); toast(t.forgotten); void load(); }}>{t.forget}</button>
          </div>
        ))}
      </div>
    </main>
  );
}
