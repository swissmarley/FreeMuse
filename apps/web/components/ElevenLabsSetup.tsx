'use client';
/** Connect ElevenLabs with the user's own API key (free plan works). The key stays encrypted on the server. */
import { useState } from 'react';
import { fmt, type Strings } from '@muse/core/i18n';
import type { ElevenVoice } from '@muse/core/voice';
import { api } from '../lib/api';
import { loadVoiceConfig } from '../lib/voice';

export function ElevenLabsSetup({ t, name, status, onChange, toast }: {
  t: Strings;
  name: string;
  status: { configured: boolean; keyHint: string | null } | null;
  onChange: (voices?: ElevenVoice[]) => void;
  toast: (s: string) => void;
}) {
  const [key, setKey] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const save = async (e: React.FormEvent) => {
    e.preventDefault();
    setBusy(true);
    setError('');
    try {
      const r = await api.saveElevenlabsKey(key.trim());
      setKey('');
      await loadVoiceConfig(true);
      toast(t.elKeySaved);
      onChange(r.voices);
    } catch (er) { setError((er as Error).message); } finally { setBusy(false); }
  };
  const remove = async () => {
    await api.removeElevenlabsKey();
    await loadVoiceConfig(true);
    toast(t.elKeyRemoved);
    onChange();
  };
  return (
    <div className="stack el-setup">
      <div className="row" style={{ justifyContent: 'space-between' }}>
        <strong>🎙️ {t.elTitle}</strong>
        {status?.configured && <span className="chip ok">{fmt(t.elConnectedAs, { hint: status.keyHint ?? '' })}</span>}
      </div>
      {status?.configured ? (
        <div className="row">
          <button type="button" className="btn ghost" onClick={() => void remove()}>{t.elRemoveKey}</button>
        </div>
      ) : (
        <>
          <p className="muted" style={{ margin: 0 }}>{fmt(t.elIntro, { name })}</p>
          <p className="hint" style={{ margin: 0 }}>{t.elKeySteps} <a href="https://elevenlabs.io/app/settings/api-keys" target="_blank" rel="noopener noreferrer">{t.elGetKey}</a></p>
          <form className="row" onSubmit={save}>
            <label className="sr-only" htmlFor="elkey">{t.elApiKey}</label>
            <input id="elkey" className="input" style={{ flex: 1, minWidth: 220 }} type="password" autoComplete="off" spellCheck={false} placeholder="sk_…" value={key} onChange={(e) => setKey(e.target.value)} />
            <button className="btn" type="submit" disabled={busy || key.trim().length < 20}>{busy ? t.elChecking : t.elSaveKey}</button>
          </form>
          {error && <p role="alert" style={{ color: 'var(--c-danger)', margin: 0 }}>{error}</p>}
        </>
      )}
      <span className="hint">{t.elStoredNote}</span>
    </div>
  );
}
