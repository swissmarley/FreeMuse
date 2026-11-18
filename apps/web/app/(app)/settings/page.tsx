'use client';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useEffect, useState } from 'react';
import type { UserSettings } from '@muse/core';
import { BRAND } from '@muse/core/brand';
import { fmt, LANGUAGES, speechLocale, strings, type Strings } from '@muse/core/i18n';
import { ElevenLabsSetup } from '../../../components/ElevenLabsSetup';
import { api } from '../../../lib/api';
import { enablePush } from '../../../lib/push';
import { useMuse } from '../../../lib/store';
import { loadVoiceConfig } from '../../../lib/voice';

function Toggle({ label, hint, checked, onChange, disabled }: { label: string; hint?: string; checked: boolean; onChange: (v: boolean) => void; disabled?: boolean }) {
  return (
    <label className="row" style={{ justifyContent: 'space-between', cursor: disabled ? 'default' : 'pointer', flexWrap: 'nowrap', opacity: disabled ? 0.6 : 1 }}>
      <span><strong>{label}</strong>{hint && <><br /><span className="muted" style={{ fontSize: '.85rem' }}>{hint}</span></>}</span>
      <span className="switch"><input type="checkbox" checked={checked} disabled={disabled} onChange={(e) => onChange(e.target.checked)} aria-label={label} /><span /></span>
    </label>
  );
}

/** Explicit, informed consent before Contributor mode is turned on. */
function ContributorConsent({ t, onAgree, onCancel }: { t: Strings; onAgree: () => void; onCancel: () => void }) {
  const [checked, setChecked] = useState(false);
  useEffect(() => {
    const k = (e: KeyboardEvent) => { if (e.key === 'Escape') onCancel(); };
    window.addEventListener('keydown', k);
    return () => window.removeEventListener('keydown', k);
  }, [onCancel]);
  return (
    <div className="modal-backdrop" role="presentation" onClick={onCancel}>
      <div className="card stack modal pop" role="dialog" aria-modal="true" aria-labelledby="cm-title" onClick={(e) => e.stopPropagation()}>
        <h2 id="cm-title" style={{ fontSize: '1.15rem', margin: 0 }}>{t.contributorConsentTitle}</h2>
        <p style={{ margin: 0 }}>{t.contributorConsentBody}</p>
        <label className="row" style={{ alignItems: 'flex-start', flexWrap: 'nowrap' }}>
          <input type="checkbox" checked={checked} onChange={(e) => setChecked(e.target.checked)} style={{ marginTop: 4 }} autoFocus />
          <span>{t.contributorConsentCheck}</span>
        </label>
        <div className="row" style={{ justifyContent: 'flex-end' }}>
          <button className="btn ghost" onClick={onCancel}>{t.cancel}</button>
          <button className="btn" disabled={!checked} onClick={onAgree}>{t.contributorAgree}</button>
        </div>
      </div>
    </div>
  );
}

export default function SettingsPage() {
  const { s, refreshMe, toast } = useMuse();
  const router = useRouter();
  const me = s.me!;
  const st = me.settings;
  const t = strings(st.language);
  const [domains, setDomains] = useState(st.blockedDomains.join(', '));
  const [consent, setConsent] = useState(false);
  const [eleven, setEleven] = useState<{ configured: boolean; keyHint: string | null } | null>(null);
  const loadEleven = () => void api.elevenlabsStatus().then(setEleven).catch(() => setEleven(null));
  useEffect(loadEleven, []);
  const contributorAllowed = me.features?.contributorMode !== false;

  const save = async (patch: Partial<UserSettings> & { contributorConsent?: true }) => {
    try {
      await api.saveSettings(patch as Partial<UserSettings>);
      await refreshMe();
      toast(strings(patch.language ?? st.language).saved);
    } catch (e) { toast((e as Error).message); }
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
        <section className="card stack" aria-labelledby="app">
          <h2 id="app" style={{ fontSize: '1.05rem', margin: 0 }}>{t.app}</h2>
          <label className="field">{t.language}<span className="hint">{fmt(t.languageHint, { name: me.avatar.name })}</span>
            <select className="input" value={st.language} onChange={(e) => void save({ language: e.target.value })}>
              {Object.entries(LANGUAGES).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
            </select>
          </label>
          <label className="field">{t.theme}<select className="input" value={st.theme} onChange={(e) => void save({ theme: e.target.value as UserSettings['theme'] })}>
            <option value="system">{t.themeSystem}</option><option value="light">{t.themeLight}</option><option value="dark">{t.themeDark}</option>
          </select></label>
          <Toggle label={t.reduceMotion} hint={t.reduceMotionHint} checked={st.reducedMotion} onChange={(v) => void save({ reducedMotion: v })} />
          <button className="btn secondary" onClick={async () => { const r = await enablePush(); toast(r === 'enabled' ? t.notificationsOn : r === 'denied' ? t.notificationsBlocked : r === 'unconfigured' ? t.notificationsUnconfigured : t.notificationsUnsupported); }}>{t.enableNotifications}</button>
        </section>

        <section className="card stack" aria-labelledby="voice-h">
          <h2 id="voice-h" style={{ fontSize: '1.05rem', margin: 0 }}>{t.voice}</h2>
          <ElevenLabsSetup t={t} name={me.avatar.name} status={eleven} toast={toast} onChange={() => { loadEleven(); void loadVoiceConfig(true); }} />
          <Link className="btn secondary" href="/avatar">{fmt(t.customiseName, { name: me.avatar.name })} → {t.voice}</Link>
        </section>

        <section className="card stack" aria-labelledby="priv">
          <h2 id="priv" style={{ fontSize: '1.05rem', margin: 0 }}>{t.privacyAndData}</h2>
          <Toggle label={t.contributorMode} hint={contributorAllowed ? t.contributorModeHint : t.contributorUnavailable} checked={st.contributorMode} disabled={!contributorAllowed && !st.contributorMode}
            onChange={(v) => (v ? setConsent(true) : void save({ contributorMode: false }))} />
          {st.contributorMode && st.contributorConsentAt && <span className="chip warn">{fmt(t.contributorOn, { date: new Date(st.contributorConsentAt).toLocaleDateString(speechLocale(st.language)) })}</span>}
          <Toggle label={t.proactiveSuggestions} hint={t.proactiveSuggestionsHint} checked={st.proactiveSuggestions} onChange={(v) => void save({ proactiveSuggestions: v })} />
          <Toggle label={t.autoSaveDrafts} hint={t.autoSaveDraftsHint} checked={st.autoApproveDrafts} onChange={(v) => void save({ autoApproveDrafts: v })} />
          <label className="field">{t.blockedWebsites}<span className="hint">{t.blockedWebsitesHint}</span>
            <div className="row"><input className="input" style={{ flex: 1 }} value={domains} onChange={(e) => setDomains(e.target.value)} placeholder="example.com, other.org" />
              <button className="btn secondary" onClick={() => void save({ blockedDomains: domains.split(/[,\s]+/).map((d) => d.trim().toLowerCase()).filter(Boolean) })}>{t.save}</button></div>
          </label>
          <div className="row">
            <button className="btn secondary" onClick={() => void exportData()}>{t.exportData}</button>
            <button className="btn danger" onClick={async () => {
              if (!window.confirm(t.deleteConfirm)) return;
              await api.deleteAccount();
              await refreshMe();
              router.replace('/onboarding');
            }}>{t.deleteAll}</button>
          </div>
          <p className="muted" style={{ fontSize: '.85rem' }}>{t.dataStored}{process.env.NEXT_PUBLIC_DATA_REGION ? ` (${process.env.NEXT_PUBLIC_DATA_REGION})` : ''}</p>
        </section>

        <section className="card stack">
          <p className="muted" style={{ margin: 0 }}>{BRAND.appName} · {BRAND.aiDisclosure}</p>
          <p className="muted" style={{ margin: 0, fontSize: '.85rem' }}>{fmt(t.signedInAs, { email: me.email })}</p>
          <button className="btn ghost" onClick={async () => { await api.logout(); await refreshMe(); router.replace('/onboarding'); }}>{t.signOut}</button>
        </section>
      </div>
      {consent && (
        <ContributorConsent t={t} onCancel={() => setConsent(false)} onAgree={() => { setConsent(false); void save({ contributorMode: true, contributorConsent: true }); }} />
      )}
    </main>
  );
}
