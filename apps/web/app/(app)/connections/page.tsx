'use client';
import { useSearchParams } from 'next/navigation';
import { Suspense, useCallback, useEffect, useState } from 'react';
import type { Connection, ConnectorInfo } from '@muse/core';
import { api } from '../../../lib/api';
import { useMuse } from '../../../lib/store';

function ConnectorCard({ c, conn, reload }: { c: ConnectorInfo; conn?: Connection; reload: () => void }) {
  const { toast } = useMuse();
  const [scopes, setScopes] = useState<string[]>(conn?.scopes ?? c.scopes.filter((s) => s.id === 'read').map((s) => s.id));
  const [busy, setBusy] = useState(false);
  useEffect(() => { if (conn) setScopes(conn.scopes); }, [conn]);
  const toggle = (id: string) => setScopes((s) => (s.includes(id) ? s.filter((x) => x !== id) : [...s, id]));
  const connect = async () => {
    setBusy(true);
    try {
      if (conn) {
        const r = await api.updateScopes(conn.id, scopes);
        if (r.authorizeUrl) { window.location.href = r.authorizeUrl; return; }
        toast('Permissions updated');
      } else {
        const r = await api.connect(c.id, scopes);
        if (r.authorizeUrl) { window.location.href = r.authorizeUrl; return; }
        toast(`${c.name} connected`);
      }
      reload();
    } catch (e) { toast((e as Error).message); } finally { setBusy(false); }
  };
  return (
    <article className="card" aria-labelledby={`c-${c.id}`}>
      <div className="row" style={{ justifyContent: 'space-between' }}>
        <div>
          <h2 id={`c-${c.id}`} style={{ fontSize: '1.05rem', margin: 0 }}>{c.name} {c.kind === 'demo' && <span className="chip">Demo data</span>}</h2>
          <p className="muted" style={{ margin: '4px 0 0', fontSize: '.9rem' }}>{c.description}</p>
        </div>
        {conn ? <span className="chip ok">Connected{conn.account ? ` · ${conn.account}` : ''}</span> : null}
      </div>
      <fieldset style={{ border: 0, padding: 0, margin: '14px 0 0' }}>
        <legend className="muted" style={{ fontSize: '.85rem', fontWeight: 800, marginBottom: 6 }}>What can it do?</legend>
        <div className="stack" style={{ gap: 8 }}>
          {c.scopes.map((s) => (
            <label key={s.id} className="row" style={{ justifyContent: 'space-between', cursor: 'pointer' }}>
              <span><strong>{s.label}</strong><br /><span className="muted" style={{ fontSize: '.85rem' }}>{s.description}</span></span>
              <span className="switch"><input type="checkbox" checked={scopes.includes(s.id)} onChange={() => toggle(s.id)} aria-label={s.label} /><span /></span>
            </label>
          ))}
        </div>
      </fieldset>
      <div className="row" style={{ marginTop: 14 }}>
        {c.available ? <button className="btn" disabled={busy || scopes.length === 0} onClick={() => void connect()}>{conn ? 'Save permissions' : 'Connect'}</button> : <span className="muted">Needs GOOGLE_CLIENT_ID/SECRET on the server.</span>}
        {conn && <button className="btn ghost" disabled={busy} onClick={async () => { await api.disconnect(conn.id); toast(`${c.name} disconnected and access revoked`); reload(); }}>Disconnect &amp; revoke</button>}
      </div>
    </article>
  );
}

function Vault() {
  const { toast } = useMuse();
  const [items, setItems] = useState<{ id: string; service: string; username: string }[]>([]);
  const [f, setF] = useState({ service: '', username: '', password: '' });
  const load = useCallback(async () => setItems((await api.vaultList()).items), []);
  useEffect(() => { void load(); }, [load]);
  return (
    <section className="card" aria-labelledby="vault-h" style={{ marginTop: 24 }}>
      <h2 id="vault-h" style={{ fontSize: '1.05rem', margin: 0 }}>Saved logins (vault)</h2>
      <p className="muted" style={{ fontSize: '.9rem' }}>Encrypted. The agent can use a login on the matching website (always with your approval) but can never read the password.</p>
      <ul className="stack" style={{ listStyle: 'none', padding: 0 }}>
        {items.map((i) => (
          <li key={i.id} className="row" style={{ justifyContent: 'space-between' }}>
            <span>🔒 <strong>{i.service}</strong> · {i.username}</span>
            <button className="btn ghost" onClick={async () => { await api.vaultDelete(i.id); void load(); }}>Remove</button>
          </li>
        ))}
      </ul>
      <form className="stack" onSubmit={async (e) => { e.preventDefault(); try { await api.vaultPut(f.service, f.username, f.password); setF({ service: '', username: '', password: '' }); toast('Login saved securely'); void load(); } catch (er) { toast((er as Error).message); } }}>
        <label className="field">Website<input className="input" placeholder="shop.example.com" value={f.service} onChange={(e) => setF({ ...f, service: e.target.value })} /></label>
        <label className="field">Username or email<input className="input" autoComplete="off" value={f.username} onChange={(e) => setF({ ...f, username: e.target.value })} /></label>
        <label className="field">Password<input className="input" type="password" autoComplete="new-password" value={f.password} onChange={(e) => setF({ ...f, password: e.target.value })} /></label>
        <button className="btn" type="submit" disabled={!f.service || !f.username || !f.password}>Save login</button>
      </form>
    </section>
  );
}

function Connections() {
  const { toast } = useMuse();
  const params = useSearchParams();
  const [cons, setCons] = useState<ConnectorInfo[]>([]);
  const [conns, setConns] = useState<Connection[]>([]);
  const load = useCallback(async () => {
    const [a, b] = await Promise.all([api.connectors(), api.connections()]);
    setCons(a.connectors);
    setConns(b.connections);
  }, []);
  useEffect(() => { void load(); }, [load]);
  useEffect(() => {
    if (params.get('connected')) toast(`${params.get('connected')} connected`);
    if (params.get('error')) toast(`Connection failed: ${params.get('error')}`);
  }, [params, toast]);
  return (
    <main className="page">
      <h1>Connections &amp; permissions</h1>
      <p className="lead">You choose which apps the agent can use and exactly what it may do. Change or revoke access any time.</p>
      <div className="stack">{cons.map((c) => <ConnectorCard key={c.id} c={c} conn={conns.find((x) => x.connector === c.id)} reload={() => void load()} />)}</div>
      <Vault />
    </main>
  );
}

export default function ConnectionsPage() {
  return <Suspense fallback={<main className="page"><p className="muted">Loading…</p></main>}><Connections /></Suspense>;
}
