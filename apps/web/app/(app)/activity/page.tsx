'use client';
import { useSearchParams } from 'next/navigation';
import { Suspense, useCallback, useEffect, useState } from 'react';
import type { AuditEvent } from '@muse/core';
import { speechLocale, strings, type Strings } from '@muse/core/i18n';
import { api } from '../../../lib/api';
import { useMuse } from '../../../lib/store';

const ACTOR: Record<string, keyof Strings> = { user: 'actorUser', agent: 'actorAgent', subagent: 'actorSubagent', sentinel: 'actorSentinel', system: 'actorSystem' };

function Activity() {
  const { s } = useMuse();
  const t = strings(s.me!.settings.language);
  const locale = speechLocale(s.me!.settings.language);
  const params = useSearchParams();
  const taskId = params.get('task') ?? undefined;
  const [data, setData] = useState<{ events: AuditEvent[]; planned: { taskId: string; title: string; step: string }[]; chainValid: boolean } | null>(null);
  const [more, setMore] = useState(true);
  const load = useCallback(async () => { const d = await api.audit({ taskId }); setData(d); setMore(d.events.length >= 100); }, [taskId]);
  useEffect(() => { void load(); }, [load, s.version]);
  const loadMore = async () => {
    if (!data?.events.length) return;
    const d = await api.audit({ taskId, before: data.events.at(-1)!.seq });
    setData({ ...data, events: [...data.events, ...d.events] });
    setMore(d.events.length >= 100);
  };
  return (
    <main className="page">
      <h1>{t.activity}</h1>
      <p className="lead">{t.activityLead}</p>
      {data && <p className={`chip ${data.chainValid ? 'ok' : 'bad'}`}>{data.chainValid ? t.chainOk : t.chainBad}</p>}
      {data?.planned.length ? (
        <section style={{ margin: '20px 0' }}>
          <h2 style={{ fontSize: '1.1rem' }}>{t.plannedNext}</h2>
          <ul className="timeline">{data.planned.map((p, i) => <li key={i} className="planned"><strong>{p.step}</strong><div className="muted" style={{ fontSize: '.85rem' }}>{p.title}</div></li>)}</ul>
        </section>
      ) : null}
      <section>
        <h2 style={{ fontSize: '1.1rem' }}>{t.doneSoFar}</h2>
        {!data ? <p className="muted">{t.loading}</p> : data.events.length === 0 ? <p className="empty">{t.nothingYet}</p> : (
          <ul className="timeline">
            {data.events.map((e) => (
              <li key={e.id} className={e.actor}>
                <div className="row" style={{ gap: 8 }}>
                  <span className="chip">{ACTOR[e.actor] ? t[ACTOR[e.actor]!] : e.actor}</span>
                  <time dateTime={e.createdAt}>{new Date(e.createdAt).toLocaleString(locale)}</time>
                </div>
                <div style={{ marginTop: 4 }}>{e.summary}</div>
                {Object.keys(e.data ?? {}).length > 0 && (
                  <details><summary className="muted" style={{ fontSize: '.8rem', cursor: 'pointer' }}>{t.details}</summary>
                    <pre style={{ fontSize: '.75rem', whiteSpace: 'pre-wrap', overflowWrap: 'anywhere', background: 'var(--c-surface-alt)', padding: 10, borderRadius: 12 }}>{JSON.stringify(e.data, null, 2)}</pre>
                  </details>
                )}
              </li>
            ))}
          </ul>
        )}
        {more && data?.events.length ? <button className="btn secondary" style={{ marginTop: 16 }} onClick={() => void loadMore()}>{t.loadOlder}</button> : null}
      </section>
    </main>
  );
}

export default function ActivityPage() {
  return <Suspense fallback={<main className="page"><p className="muted">Loading…</p></main>}><Activity /></Suspense>;
}
