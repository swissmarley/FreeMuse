'use client';
import Link from 'next/link';
import { useCallback, useEffect, useState } from 'react';
import type { Task } from '@muse/core';
import { fmt, speechLocale, strings, type Strings } from '@muse/core/i18n';
import { RichText } from '../../../components/RichText';
import { api } from '../../../lib/api';
import { useMuse } from '../../../lib/store';

const STATUS: Record<string, { label: keyof Strings; cls: string }> = {
  queued: { label: 'statusQueued', cls: '' }, running: { label: 'statusRunning', cls: 'ok' }, waiting_approval: { label: 'statusWaiting', cls: 'warn' },
  scheduled: { label: 'statusScheduled', cls: '' }, done: { label: 'statusDone', cls: 'ok' }, failed: { label: 'statusFailed', cls: 'bad' }, cancelled: { label: 'statusCancelled', cls: '' },
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
        <span className={`chip ${STATUS[task.status]?.cls ?? ''}`}>{STATUS[task.status] ? t[STATUS[task.status]!.label] : task.status}</span>
      </div>
      <div className="progress" style={{ margin: '12px 0' }} role="progressbar" aria-valuenow={Math.round(task.progress * 100)} aria-valuemin={0} aria-valuemax={100} aria-label={t.progress}>
        <div style={{ width: `${Math.round(task.progress * 100)}%` }} />
      </div>
      <ol className="steps">
        {task.plan.map((st) => <li key={st.id}><span aria-hidden>{STEP_ICON[st.status]}</span><span>{st.title}{st.note ? <span className="muted"> · {st.note}</span> : null}<span className="sr-only"> ({st.status})</span></span></li>)}
      </ol>
      {task.nextRunAt && task.status === 'scheduled' && <p className="muted" style={{ fontSize: '.85rem' }}>{fmt(t.nextCheck, { when: new Date(task.nextRunAt).toLocaleString(speechLocale(s.me!.settings.language)) })}</p>}
      {task.result && <p><RichText text={task.result} /></p>}
      <div className="row" style={{ marginTop: 10 }}>
        <Link className="btn ghost" href={`/activity?task=${task.id}`}>{t.seeActivityBtn}</Link>
        {task.status === 'waiting_approval' && <Link className="btn" href="/approvals">{t.review}</Link>}
        {!['done', 'failed', 'cancelled'].includes(task.status) && <button className="btn ghost" onClick={async () => { await api.cancelTask(task.id); toast(t.taskCancelled); void load(); }}>{t.cancel}</button>}
      </div>
    </article>
  );

  return (
    <main className="page">
      <h1>{t.workingOn}</h1>
      <p className="lead">{t.tasksLead}</p>
      <div className="stack">
        {tasks === null ? <p className="muted">{t.loading}</p> : active.length === 0 ? <p className="empty">{t.noActiveTasks}</p> : active.map(card)}
      </div>
      {past.length > 0 && <><h2 style={{ marginTop: 32 }}>{t.finished}</h2><div className="stack">{past.map(card)}</div></>}
    </main>
  );
}
