'use client';
import { useRouter } from 'next/navigation';
import { useState } from 'react';
import type { UserSettings } from '@muse/core';
import { BRAND } from '@muse/core/brand';
import { LANGUAGES, strings } from '@muse/core/i18n';
import { api } from '../../../lib/api';
import { enablePush } from '../../../lib/push';
import { useMuse } from '../../../lib/store';

function Toggle({ label, hint, checked, onChange }: { label: string; hint?: string; checked: boolean; onChange: (v: boolean) => void }) {
  return (
    <label className="row" style={{ justifyContent: 'space-between', cursor: 'pointer' }}>
      <span><strong>{label}</strong>{hint && <><br /><span className="muted" style={{ fontSize: '.85rem' }}>{hint}</span></>}</span>
      <span className="switch"><input type="checkbox" checked={checked} onChange={(e) => onChange(e.target.checked)} aria-label={label} /><span /></span>
    </label>
  );
}

export default function SettingsPage() {
  const { s, refreshMe, toast } = useMuse();
  const router = useRouter();
  const st = s.me!.settings;
  const t = strings(st.language);
  const [domains, setDomains] = useState(st.blockedDomains.join(', '));
  const save = async (patch: Partial<UserSettings>) => {
    try { await api.saveSettings(patch); await refreshMe(); toast('Saved'); } catch (e) { toast((e as Error).message); }
  };
  const exportData = async () => {
    const data = await api.exportData();
    const url = URL.createObjectURL(new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' }));
    const a = document.createElement('a');
    a.href = url;
    a.download = `my-data-${new Date().toISOString().slice(0, 10)}.json`;
    a.click();
    URL.revokeObjectURL(url);
  };
  return (
    <main className="page">
      <h1>{t.settings}</h1>
      <div className="stack">
        <section className="card stack" aria-labelledby="priv">
          <h2 id="priv" style={{ fontSize: '1.05rem', margin: 0 }}>Privacy &amp; data</h2>
          <Toggle label={t.trainingOptOut} hint="On by default. When on, only Standard-mode model access is used, where your content is not used for training." checked={st.trainingOptOut} onChange={(v) => void save({ trainingOptOut: v })} />
          <Toggle label="Proactive suggestions" hint="Let me suggest things based on what I remember." checked={st.proactiveSuggestions} onChange={(v) => void save({ proactiveSuggestions: v })} />
          <Toggle label="Auto-save drafts" hint="Drafts (not sending) don't need approval. Sending always does." checked={st.autoApproveDrafts} onChange={(v) => void save({ autoApproveDrafts: v })} />
          <label className="field">Blocked websites<span className="hint">Comma-separated domains the agent must never open or use.</span>
            <div className="row"><input className="input" style={{ flex: 1 }} value={domains} onChange={(e) => setDomains(e.target.value)} placeholder="example.com, other.org" />
              <button className="btn secondary" onClick={() => void save({ blockedDomains: domains.split(/[,\s]+/).map((d) => d.trim().toLowerCase()).filter(Boolean) })}>Save</button></div>
          </label>
          <div className="row">
            <button className="btn secondary" onClick={() => void exportData()}>{t.exportData}</button>
            <button className="btn danger" onClick={async () => {
              if (!window.confirm('Delete your account and ALL data (chats, memories, tasks, audit trail, connections)? This cannot be undone.')) return;
              await api.deleteAccount();
              await refreshMe();
              router.replace('/onboarding');
            }}>{t.deleteAll}</button>
          </div>
          <p className="muted" style={{ fontSize: '.85rem' }}>Data is stored on your own server{process.env.NEXT_PUBLIC_DATA_REGION ? ` (region: ${process.env.NEXT_PUBLIC_DATA_REGION})` : ''}. See PRIVACY.md.</p>
        </section>
        <section className="card stack" aria-labelledby="app">
          <h2 id="app" style={{ fontSize: '1.05rem', margin: 0 }}>App</h2>
          <label className="field">{t.language}<select className="input" value={st.language} onChange={(e) => void save({ language: e.target.value })}>
            {Object.entries(LANGUAGES).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
          </select></label>
          <label className="field">Theme<select className="input" value={st.theme} onChange={(e) => void save({ theme: e.target.value as UserSettings['theme'] })}>
            <option value="system">Match system</option><option value="light">Light</option><option value="dark">Dark</option>
          </select></label>
          <Toggle label="Reduce motion" hint="Keep the avatar and screens still." checked={st.reducedMotion} onChange={(v) => void save({ reducedMotion: v })} />
          <button className="btn secondary" onClick={async () => { const r = await enablePush(); toast(r === 'enabled' ? 'Notifications on' : r === 'denied' ? 'Notifications blocked in your browser' : r === 'unconfigured' ? 'Push is not configured on the server (VAPID keys)' : 'Not supported in this browser'); }}>Enable notifications</button>
        </section>
        <section className="card stack">
          <p className="muted" style={{ margin: 0 }}>{BRAND.appName} · {BRAND.aiDisclosure}</p>
          <p className="muted" style={{ margin: 0, fontSize: '.85rem' }}>Signed in as {s.me!.email}</p>
          <button className="btn ghost" onClick={async () => { await api.logout(); await refreshMe(); router.replace('/onboarding'); }}>Sign out</button>
        </section>
      </div>
    </main>
  );
}
