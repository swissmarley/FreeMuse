'use client';
import Link from 'next/link';
import { useCallback, useEffect, useState } from 'react';
import type { Task } from '@muse/core';
import { strings } from '@muse/core/i18n';
import { RichText } from '../../../components/RichText';
import { api } from '../../../lib/api';
import { useMuse } from '../../../lib/store';

const STATUS: Record<string, { label: string; cls: string }> = {
  queued: { label: 'Starting', cls: '' }, running: { label: 'Working', cls: 'ok' }, waiting_approval: { label: 'Needs your OK', cls: 'warn' },
  scheduled: { label: 'Will check back', cls: '' }, done: { label: 'Done', cls: 'ok' }, failed: { label: 'Stopped', cls: 'bad' }, cancelled: { label: 'Cancelled', cls: '' },
};
const STEP_ICON: Record<string, string> = { pending: '○', running: '◐', done: '●', blocked: '⚠', skipped: '–', failed: '✕' };

export default function TasksPage() {
  const { s, toast } = useMuse();
  const t = strings(s.me!.settings.language);
  const [tasks, setTasks] = useState<Task[] | null>(null);
  const load = useCallback(async () => setTasks((await api.tasks()).tasks), []);
  useEffect(() => { void load(); }, [load, s.version]);
  const active = tasks?.filter((x) => !['done', 'failed', 'cancelled'].includes(x.status)) ?? [];
  const past = tasks?.filter((x) => ['done', 'failed', 'cancelled'].includes(x.status)) ?? [];

  const card = (task: Task) => (
    <article key={task.id} className="card pop" aria-labelledby={`t-${task.id}`}>
      <div className="row" style={{ justifyContent: 'space-between' }}>
        <h2 id={`t-${task.id}`} style={{ fontSize: '1.05rem', margin: 0 }}>{task.title}</h2>
        <span className={`chip ${STATUS[task.status]?.cls ?? ''}`}>{STATUS[task.status]?.label ?? task.status}</span>
      </div>
      <div className="progress" style={{ margin: '12px 0' }} role="progressbar" aria-valuenow={Math.round(task.progress * 100)} aria-valuemin={0} aria-valuemax={100} aria-label="Progress">
        <div style={{ width: `${Math.round(task.progress * 100)}%` }} />
      </div>
      <ol className="steps">
        {task.plan.map((st) => <li key={st.id}><span aria-hidden>{STEP_ICON[st.status]}</span><span>{st.title}{st.note ? <span className="muted"> · {st.note}</span> : null}<span className="sr-only"> ({st.status})</span></span></li>)}
      </ol>
      {task.nextRunAt && task.status === 'scheduled' && <p className="muted" style={{ fontSize: '.85rem' }}>Next check: {new Date(task.nextRunAt).toLocaleString()}</p>}
      {task.result && <p><RichText text={task.result} /></p>}
      <div className="row" style={{ marginTop: 10 }}>
        <Link className="btn ghost" href={`/activity?task=${task.id}`}>See activity</Link>
        {task.status === 'waiting_approval' && <Link className="btn" href="/approvals">Review</Link>}
        {!['done', 'failed', 'cancelled'].includes(task.status) && <button className="btn ghost" onClick={async () => { await api.cancelTask(task.id); toast('Task cancelled'); void load(); }}>Cancel</button>}
      </div>
    </article>
  );

  return (
    <main className="page">
      <h1>{t.workingOn}</h1>
      <p className="lead">Background tasks keep going when you close the app. You&apos;ll get a notification when something changes or needs your OK.</p>
      <div className="stack">
        {tasks === null ? <p className="muted">Loading…</p> : active.length === 0 ? <p className="empty">No active tasks. Ask me to take something off your plate!</p> : active.map(card)}
      </div>
      {past.length > 0 && <><h2 style={{ marginTop: 32 }}>Finished</h2><div className="stack">{past.map(card)}</div></>}
    </main>
  );
}
