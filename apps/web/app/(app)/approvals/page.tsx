'use client';
import { Fragment, useCallback, useEffect, useState } from 'react';
import type { Approval } from '@muse/core';
import { strings } from '@muse/core/i18n';
import { api } from '../../../lib/api';
import { useMuse } from '../../../lib/store';

const CLASS_LABEL: Record<string, string> = { send: 'Send', spend: 'Purchase', write: 'Calendar', login: 'Sign in', draft: 'Draft', read: 'Read', navigate: 'Browse' };
const EDITABLE = ['to', 'cc', 'subject', 'body', 'title', 'start', 'end', 'location', 'notes', 'attendees'];

function ApprovalCard({ a, onDone }: { a: Approval; onDone: () => void }) {
  const { toast, refreshCounts } = useMuse();
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState<Record<string, string>>({});
  const [busy, setBusy] = useState(false);
  const editable = Object.keys(a.payload).filter((k) => EDITABLE.includes(k));

  const decide = async (decision: 'approve' | 'reject') => {
    setBusy(true);
    try {
      let edited: Record<string, unknown> | undefined;
      if (editing && decision === 'approve') {
        edited = {};
        for (const [k, v] of Object.entries(draft)) edited[k] = Array.isArray(a.payload[k]) ? v.split(/[,;]\s*/).filter(Boolean) : v;
      }
      const r = await api.resolveApproval(a.id, decision, edited);
      if (decision === 'approve') navigator.vibrate?.([12, 40, 18]); // haptic confirmation where supported
      toast(decision === 'approve' ? (r.approval.status === 'executed' ? 'Approved and done ✓' : `Approved, but it failed: ${(r.approval as any).result?.error ?? ''}`) : 'Declined');
      await refreshCounts();
      onDone();
    } catch (e) {
      toast((e as Error).message);
    } finally {
      setBusy(false);
    }
  };

  const show = (v: unknown) => (Array.isArray(v) ? v.join(', ') : typeof v === 'object' ? JSON.stringify(v) : String(v));
  return (
    <article className={`card pop risk-${a.risk.level}`} aria-labelledby={`ap-${a.id}`}>
      <div className="row" style={{ justifyContent: 'space-between' }}>
        <span className="chip">{CLASS_LABEL[a.actionClass] ?? a.actionClass} · {a.connector.replace('_', ' ')}</span>
        <span className={`chip ${a.risk.level === 'high' ? 'bad' : a.risk.level === 'medium' ? 'warn' : 'ok'}`}>Risk: {a.risk.level}</span>
      </div>
      <h2 id={`ap-${a.id}`} style={{ fontSize: '1.1rem', margin: '12px 0' }}>{a.title}</h2>
      {editing ? (
        <div className="stack">
          {editable.map((k) => (
            <label key={k} className="field">{k}
              {k === 'body' || k === 'notes'
                ? <textarea className="input" rows={7} defaultValue={show(a.payload[k])} onChange={(e) => setDraft((d) => ({ ...d, [k]: e.target.value }))} />
                : <input className="input" defaultValue={show(a.payload[k])} onChange={(e) => setDraft((d) => ({ ...d, [k]: e.target.value }))} />}
            </label>
          ))}
          <p className="muted" style={{ fontSize: '.85rem' }}>Edited actions are checked again by Sentinel before they run.</p>
        </div>
      ) : (
        <dl className="kv">
          {Object.entries(a.preview).filter(([, v]) => v !== '' && v != null && !(Array.isArray(v) && v.length === 0)).map(([k, v]) => (<Fragment key={k}><dt>{k}</dt><dd>{show(v)}</dd></Fragment>))}
        </dl>
      )}
      {a.risk.reasons.length > 0 && (
        <ul className="muted" style={{ fontSize: '.85rem', margin: '12px 0 0', paddingLeft: 18 }} aria-label="Why this needs approval">
          {a.risk.reasons.map((r) => <li key={r}>{r}</li>)}
        </ul>
      )}
      {a.status === 'pending' ? (
        <div className="row" style={{ marginTop: 16 }}>
          <button className="btn" disabled={busy} onClick={() => void decide('approve')}>{editing ? 'Approve edited' : 'Approve'}</button>
          {editable.length > 0 && <button className="btn secondary" disabled={busy} onClick={() => setEditing((x) => !x)}>{editing ? 'Cancel edit' : 'Edit'}</button>}
          <button className="btn ghost" disabled={busy} onClick={() => void decide('reject')}>Reject</button>
        </div>
      ) : <p className="chip" style={{ marginTop: 12 }}>{a.status}</p>}
    </article>
  );
}

export default function ApprovalsPage() {
  const { s } = useMuse();
  const t = strings(s.me!.settings.language);
  const [tab, setTab] = useState<'pending' | 'all'>('pending');
  const [items, setItems] = useState<Approval[] | null>(null);
  const load = useCallback(async () => setItems((await api.approvals(tab)).approvals), [tab]);
  useEffect(() => { void load(); }, [load, s.version]);
  return (
    <main className="page">
      <h1>{t.approvals}</h1>
      <p className="lead">Anything sensitive waits here for you. Nothing is sent, bought or submitted until you approve.</p>
      <div className="row" role="tablist" style={{ marginBottom: 16 }}>
        <button role="tab" aria-selected={tab === 'pending'} className={`btn ${tab === 'pending' ? '' : 'secondary'}`} onClick={() => setTab('pending')}>Waiting</button>
        <button role="tab" aria-selected={tab === 'all'} className={`btn ${tab === 'all' ? '' : 'secondary'}`} onClick={() => setTab('all')}>History</button>
      </div>
      <div className="stack">
        {items === null ? <p className="muted">Loading…</p> : items.length === 0 ? <p className="empty">{t.nothingPending}</p> : items.map((a) => <ApprovalCard key={a.id} a={a} onDone={() => void load()} />)}
      </div>
    </main>
  );
}
