'use client';
import { useSearchParams } from 'next/navigation';
import { Suspense, useCallback, useEffect, useRef, useState } from 'react';
import type { Connection, ConnectorInfo } from '@muse/core';
import { fmt, strings, type Strings } from '@muse/core/i18n';
import { api } from '../../../lib/api';
import { useMuse } from '../../../lib/store';

type GoogleSetup = Awaited<ReturnType<typeof api.googleSetup>>;

const ICONS: Record<string, string> = { gmail: '✉️', gcal: '📅', gdrive: '📁' };
const SHORT: Record<string, string> = { gmail: 'Gmail', gcal: 'Calendar', gdrive: 'Drive' };

function useT(): Strings {
  const { s } = useMuse();
  return strings(s.me?.settings.language);
}

function CopyField({ label, value }: { label: string; value: string }) {
  const t = useT();
  const [copied, setCopied] = useState(false);
  return (
    <div className="copy-field">
      <span className="hint">{label}</span>
      <div className="row" style={{ flexWrap: 'nowrap' }}>
        <code>{value}</code>
        <button type="button" className="btn ghost" onClick={() => { void navigator.clipboard?.writeText(value); setCopied(true); setTimeout(() => setCopied(false), 1500); }}>{copied ? t.copied : t.copy}</button>
      </div>
    </div>
  );
}

/** Step-by-step guide: create a Google OAuth client and paste it here. No env vars, no restart. */
function GoogleSetupGuide({ setup, onSaved, onClose }: { setup: GoogleSetup; onSaved: () => void; onClose: () => void }) {
  const { toast } = useMuse();
  const t = useT();
  const [clientId, setClientId] = useState('');
  const [secret, setSecret] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const ref = useRef<HTMLElement>(null);
  useEffect(() => { ref.current?.scrollIntoView({ behavior: 'smooth', block: 'start' }); }, []);
  const save = async (e: React.FormEvent) => {
    e.preventDefault();
    setBusy(true);
    setError('');
    try {
      const r = await api.saveGoogleSetup(clientId, secret);
      toast(r.verified ? t.gsDone : t.gsSavedUnverified);
      onSaved();
    } catch (er) { setError((er as Error).message); } finally { setBusy(false); }
  };
  const local = /localhost|127\.0\.0\.1/.test(setup.redirectUri);
  return (
    <section ref={ref} className="card stack setup-guide pop" aria-labelledby="gsetup-h">
      <div className="row" style={{ justifyContent: 'space-between' }}>
        <h2 id="gsetup-h" style={{ fontSize: '1.1rem', margin: 0 }}>{t.gsTitle} <span className="chip">{t.gsOnce}</span></h2>
        <button type="button" className="btn ghost" onClick={onClose} aria-label={t.close}>✕</button>
      </div>
      <p className="muted" style={{ margin: 0 }}>{t.gsIntro}</p>
      <ol className="setup-steps">
        <li>
          {t.gsStep1}{' '}
          <a href="https://console.cloud.google.com/projectcreate" target="_blank" rel="noopener noreferrer">{t.gsOpen}</a>
        </li>
        <li>
          {t.gsStep2}{' '}
          <a href="https://console.cloud.google.com/flows/enableapi?apiid=gmail.googleapis.com,calendar-json.googleapis.com,drive.googleapis.com" target="_blank" rel="noopener noreferrer">{t.gsOpen}</a>
        </li>
        <li>
          {t.gsStep3}{' '}
          <a href="https://console.cloud.google.com/auth/overview" target="_blank" rel="noopener noreferrer">{t.gsOpen}</a>
        </li>
        <li>
          {t.gsStep4}{' '}
          <a href="https://console.cloud.google.com/auth/clients/create" target="_blank" rel="noopener noreferrer">{t.gsOpen}</a>
          <CopyField label={t.gsRedirect} value={setup.redirectUri} />
          {!local && !setup.redirectUri.startsWith('https://') && <p className="hint" style={{ color: 'var(--c-warning)' }}>{t.gsHttpsOnly}</p>}
        </li>
        <li>
          {t.gsStep5}
          <form className="stack" onSubmit={save} style={{ marginTop: 8 }}>
            <label className="field">Client ID<input className="input" required autoComplete="off" spellCheck={false} placeholder="1234…apps.googleusercontent.com" value={clientId} onChange={(e) => setClientId(e.target.value.trim())} /></label>
            <label className="field">Client secret<input className="input" required type="password" autoComplete="off" placeholder="GOCSPX-…" value={secret} onChange={(e) => setSecret(e.target.value.trim())} /></label>
            {error && <p role="alert" style={{ color: 'var(--c-danger)', margin: 0 }}>{error}</p>}
            <button className="btn" type="submit" disabled={busy || !clientId || !secret}>{busy ? t.gsChecking : t.gsSave}</button>
            <span className="hint">{t.gsStoredNote}</span>
          </form>
        </li>
      </ol>
    </section>
  );
}

function QuickStart({ cons, conns, setup, openSetup }: { cons: ConnectorInfo[]; conns: Connection[]; setup: GoogleSetup | null; openSetup: () => void }) {
  const { toast } = useMuse();
  const t = useT();
  const google = cons.filter((c) => c.group === 'google');
  const [picked, setPicked] = useState<string[]>(['gmail', 'gcal', 'gdrive']);
  const [busy, setBusy] = useState<string | null>(null);
  const has = (id: string) => conns.some((x) => x.connector === id);
  const googleAccount = conns.find((x) => google.some((g) => g.id === x.connector))?.account;
  const googleAvailable = google.some((g) => g.available);
  const missingGoogle = google.filter((g) => !has(g.id));

  const connectGoogle = async () => {
    setBusy('google');
    try {
      const r = await api.quickConnect('google', picked.filter((p) => missingGoogle.some((g) => g.id === p)));
      if (r.authorizeUrl) window.location.href = r.authorizeUrl;
    } catch (e) { toast((e as Error).message); setBusy(null); }
  };

  return (
    <section className="quick-grid" aria-label="Quick start">
      <article className="card quick-tile">
        <div className="quick-icon" aria-hidden>✉️📅📁</div>
        <h2>Google</h2>
        <p className="muted">{t.googleOneSignIn}</p>
        {missingGoogle.length === 0 ? (
          <span className="chip ok">{t.connected}{googleAccount ? ` · ${googleAccount}` : ''}</span>
        ) : googleAvailable ? (
          <>
            <div className="row" role="group" aria-label="Google services to connect">
              {missingGoogle.map((g) => (
                <label key={g.id} className={`chip ${picked.includes(g.id) ? 'ok' : ''}`} style={{ cursor: 'pointer' }}>
                  <input type="checkbox" className="sr-only" checked={picked.includes(g.id)} onChange={() => setPicked((p) => (p.includes(g.id) ? p.filter((x) => x !== g.id) : [...p, g.id]))} />
                  {picked.includes(g.id) ? '✓ ' : ''}{SHORT[g.id] ?? g.name}
                </label>
              ))}
            </div>
            <button className="btn" disabled={busy !== null || !picked.some((p) => missingGoogle.some((g) => g.id === p))} onClick={() => void connectGoogle()}>{busy === 'google' ? t.openingGoogle : t.connectWithGoogle}</button>
            {setup?.source === 'you' && <span className="hint">{t.usingYourGoogleApp} · <button type="button" className="linkish" onClick={openSetup}>{t.change}</button></span>}
          </>
        ) : (
          <>
            <button className="btn" onClick={openSetup}>{t.setUpGoogle}</button>
            <span className="hint">{t.setupOnce}</span>
          </>
        )}
      </article>
    </section>
  );
}

function ConnectorCard({ c, conn, reload, openSetup }: { c: ConnectorInfo; conn?: Connection; reload: () => void; openSetup: () => void }) {
  const { toast } = useMuse();
  const t = useT();
  const recommended = c.recommended ?? ['read'];
  const [scopes, setScopes] = useState<string[]>(conn?.scopes ?? recommended);
  const [busy, setBusy] = useState(false);
  useEffect(() => { if (conn) setScopes(conn.scopes); }, [conn]);
  const toggle = (id: string) => setScopes((s) => (s.includes(id) ? s.filter((x) => x !== id) : [...s, id]));
  const connect = async (sc = scopes) => {
    setBusy(true);
    try {
      if (conn) {
        const r = await api.updateScopes(conn.id, sc);
        if (r.authorizeUrl) { window.location.href = r.authorizeUrl; return; }
        toast(t.permissionsUpdated);
      } else {
        const r = await api.connect(c.id, sc);
        if (r.authorizeUrl) { window.location.href = r.authorizeUrl; return; }
        toast(fmt(t.nameConnected, { name: c.name }));
      }
      reload();
    } catch (e) { toast((e as Error).message); } finally { setBusy(false); }
  };
  const dirty = conn && (scopes.length !== conn.scopes.length || scopes.some((s) => !conn.scopes.includes(s)));
  return (
    <article className="card conn-card" aria-labelledby={`c-${c.id}`}>
      <div className="row" style={{ justifyContent: 'space-between', flexWrap: 'nowrap', alignItems: 'flex-start' }}>
        <div className="row" style={{ flexWrap: 'nowrap', alignItems: 'flex-start' }}>
          <span className="conn-icon" aria-hidden>{ICONS[c.id] ?? '🔌'}</span>
          <div>
            <h3 id={`c-${c.id}`} style={{ fontSize: '1.02rem', margin: 0 }}>{c.name}</h3>
            <p className="muted" style={{ margin: '4px 0 0', fontSize: '.9rem' }}>{c.description}</p>
          </div>
        </div>
        {conn ? <span className="chip ok">✓ {t.connected}{conn.account ? ` · ${conn.account}` : ''}</span>
          : c.available ? <button className="btn" disabled={busy || scopes.length === 0} onClick={() => void connect()}>{busy ? '…' : t.connect}</button>
          : <button className="btn secondary" onClick={openSetup}>{t.setUp}</button>}
      </div>
      <details className="perm-details">
        <summary>{conn ? t.permissions : t.customisePermissions} · {c.scopes.filter((s) => scopes.includes(s.id)).map((s) => s.label).join(', ') || t.none}</summary>
        <div className="stack" style={{ gap: 8, marginTop: 10 }}>
          {c.scopes.map((s) => (
            <label key={s.id} className="row" style={{ justifyContent: 'space-between', cursor: 'pointer', flexWrap: 'nowrap' }}>
              <span><strong>{s.label}</strong><br /><span className="muted" style={{ fontSize: '.85rem' }}>{s.description}</span></span>
              <span className="switch"><input type="checkbox" checked={scopes.includes(s.id)} onChange={() => toggle(s.id)} aria-label={s.label} /><span /></span>
            </label>
          ))}
          <div className="row">
            {conn && <button className="btn" disabled={busy || !dirty || scopes.length === 0} onClick={() => void connect()}>{t.savePermissions}</button>}
            {conn && <button className="btn ghost" disabled={busy} onClick={async () => { await api.disconnect(conn.id); toast(fmt(t.nameDisconnected, { name: c.name })); reload(); }}>{t.disconnect}</button>}
          </div>
        </div>
      </details>
    </article>
  );
}

function Vault() {
  const { toast } = useMuse();
  const t = useT();
  const [items, setItems] = useState<{ id: string; service: string; username: string }[]>([]);
  const [f, setF] = useState({ service: '', username: '', password: '' });
  const load = useCallback(async () => setItems((await api.vaultList()).items), []);
  useEffect(() => { void load(); }, [load]);
  return (
    <section className="card" aria-labelledby="vault-h" style={{ marginTop: 24 }}>
      <h2 id="vault-h" style={{ fontSize: '1.05rem', margin: 0 }}>{t.savedLogins}</h2>
      <p className="muted" style={{ fontSize: '.9rem' }}>{t.savedLoginsBody}</p>
      <ul className="stack" style={{ listStyle: 'none', padding: 0 }}>
        {items.map((i) => (
          <li key={i.id} className="row" style={{ justifyContent: 'space-between' }}>
            <span>🔒 <strong>{i.service}</strong> · {i.username}</span>
            <button className="btn ghost" onClick={async () => { await api.vaultDelete(i.id); void load(); }}>{t.remove}</button>
          </li>
        ))}
      </ul>
      <details>
        <summary style={{ cursor: 'pointer', fontWeight: 700 }}>{t.addLogin}</summary>
        <form className="stack" style={{ marginTop: 10 }} onSubmit={async (e) => { e.preventDefault(); try { await api.vaultPut(f.service, f.username, f.password); setF({ service: '', username: '', password: '' }); toast(t.loginSaved); void load(); } catch (er) { toast((er as Error).message); } }}>
          <label className="field">{t.website}<input className="input" placeholder="shop.example.com" value={f.service} onChange={(e) => setF({ ...f, service: e.target.value })} /></label>
          <label className="field">{t.usernameOrEmail}<input className="input" autoComplete="off" value={f.username} onChange={(e) => setF({ ...f, username: e.target.value })} /></label>
          <label className="field">{t.password}<input className="input" type="password" autoComplete="new-password" value={f.password} onChange={(e) => setF({ ...f, password: e.target.value })} /></label>
          <button className="btn" type="submit" disabled={!f.service || !f.username || !f.password}>{t.saveLogin}</button>
        </form>
      </details>
    </section>
  );
}

function Connections() {
  const { toast } = useMuse();
  const t = useT();
  const params = useSearchParams();
  const [cons, setCons] = useState<ConnectorInfo[]>([]);
  const [conns, setConns] = useState<Connection[]>([]);
  const [setup, setSetup] = useState<GoogleSetup | null>(null);
  const [showSetup, setShowSetup] = useState(false);
  const load = useCallback(async () => {
    const [a, b, g] = await Promise.all([api.connectors(), api.connections(), api.googleSetup().catch(() => null)]);
    setCons(a.connectors);
    setConns(b.connections);
    setSetup(g);
  }, []);
  useEffect(() => { void load(); }, [load]);
  useEffect(() => {
    if (params.get('connected')) toast(fmt(t.nameConnected, { name: params.get('connected')! }));
    if (params.get('error')) toast(fmt(t.connectionFailed, { error: params.get('error')! }));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [params, toast]);
  const openSetup = () => setShowSetup(true);
  return (
    <main className="page">
      <h1>{t.connections}</h1>
      <p className="lead">{t.connectionsLead}</p>
      <QuickStart cons={cons} conns={conns} setup={setup} openSetup={openSetup} />
      {showSetup && setup && <GoogleSetupGuide setup={setup} onClose={() => setShowSetup(false)} onSaved={() => { setShowSetup(false); void load(); }} />}
      <h2 style={{ fontSize: '1.1rem', margin: '24px 0 10px' }}>{t.yourApps}</h2>
      <div className="stack">{cons.map((c) => <ConnectorCard key={c.id} c={c} conn={conns.find((x) => x.connector === c.id)} reload={() => void load()} openSetup={openSetup} />)}</div>
      {setup?.source === 'you' && (
        <p className="hint" style={{ marginTop: 12 }}>
          {t.googleApp}: {setup.clientIdHint} · <button type="button" className="linkish" onClick={openSetup}>{t.replace}</button> ·{' '}
          <button type="button" className="linkish" onClick={async () => { await api.removeGoogleSetup(); toast(t.googleAppRemoved); void load(); }}>{t.remove.toLowerCase()}</button>
        </p>
      )}
      <Vault />
    </main>
  );
}

export default function ConnectionsPage() {
  return <Suspense fallback={<main className="page"><p className="muted">Loading…</p></main>}><Connections /></Suspense>;
}
