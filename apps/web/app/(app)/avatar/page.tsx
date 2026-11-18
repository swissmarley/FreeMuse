'use client';
import { useEffect, useState } from 'react';
import { type AvatarSettings, type AvatarState, AVATAR_STATES, GLASSES, HATS, SCARVES } from '@muse/core/avatar';
import { Avatar } from '../../../components/Avatar';
import { api } from '../../../lib/api';
import { useMuse } from '../../../lib/store';
import { DeviceTTS } from '../../../lib/voice';

const COLORS = ['#F3E7D3', '#F7D9C4', '#E8D5F2', '#CFE3F5', '#D7EBD3', '#F6E3A6', '#C9465A', '#6B4E31', '#3A2A1B', '#8DB7D9'];
const SLIDERS: { key: keyof AvatarSettings['personality']; label: string; lo: string; hi: string }[] = [
  { key: 'warmth', label: 'Warmth', lo: 'Neutral', hi: 'Very warm' },
  { key: 'playfulness', label: 'Playfulness', lo: 'Serious', hi: 'Playful' },
  { key: 'verbosity', label: 'Detail', lo: 'Brief', hi: 'Detailed' },
  { key: 'proactivity', label: 'Initiative', lo: 'Only when asked', hi: 'Proactive' },
  { key: 'formality', label: 'Formality', lo: 'Casual', hi: 'Formal' },
];

function Swatches({ value, onChange, label, allowNone }: { value: string; onChange: (v: string) => void; label: string; allowNone?: boolean }) {
  return (
    <div role="group" aria-label={label} className="swatches">
      {allowNone && <button type="button" className="swatch" aria-pressed={value === ''} aria-label="Natural" onClick={() => onChange('')} style={{ background: 'repeating-linear-gradient(45deg,#eee,#eee 4px,#fff 4px,#fff 8px)' }} />}
      {COLORS.map((c) => <button key={c} type="button" className="swatch" aria-pressed={value === c} aria-label={c} onClick={() => onChange(c)} style={{ background: c }} />)}
    </div>
  );
}

export default function AvatarPage() {
  const { s, refreshMe, toast } = useMuse();
  const [a, setA] = useState<AvatarSettings>(s.me!.avatar);
  const [preview, setPreview] = useState<AvatarState>('wave');
  const [voices, setVoices] = useState<SpeechSynthesisVoice[]>([]);
  const [saving, setSaving] = useState(false);
  useEffect(() => {
    const load = () => setVoices(window.speechSynthesis?.getVoices() ?? []);
    load();
    window.speechSynthesis?.addEventListener?.('voiceschanged', load);
    return () => window.speechSynthesis?.removeEventListener?.('voiceschanged', load);
  }, []);
  const o = a.outfit;
  const setO = (patch: Partial<AvatarSettings['outfit']>) => setA({ ...a, outfit: { ...o, ...patch } });
  const save = async () => {
    setSaving(true);
    try { await api.saveAvatar(a); await refreshMe(); toast('Saved ✓'); setPreview('happy'); } catch (e) { toast((e as Error).message); } finally { setSaving(false); }
  };
  return (
    <main className="page">
      <h1>Customise {a.name}</h1>
      <p className="lead">Name, look, personality and voice. Personality and persona shape how {a.name} talks to you.</p>
      <div style={{ display: 'grid', gridTemplateColumns: 'minmax(0,1fr)', gap: 20 }}>
        <section className="card" style={{ textAlign: 'center' }} aria-label="Preview">
          <Avatar settings={a} state={preview} size={200} reducedMotion={s.me!.settings.reducedMotion} />
          <div className="row" style={{ justifyContent: 'center', marginTop: 10 }}>
            {AVATAR_STATES.map((st) => <button key={st} className={`chip ${preview === st ? 'ok' : ''}`} onClick={() => setPreview(st)} aria-pressed={preview === st}>{st}</button>)}
          </div>
        </section>
        <section className="card stack">
          <label className="field">Name<input className="input" value={a.name} maxLength={40} onChange={(e) => setA({ ...a, name: e.target.value })} /></label>
          <div className="field"><span>Hat</span><div className="row">{HATS.map((h) => <button key={h} type="button" className={`chip ${o.hat === h ? 'ok' : ''}`} aria-pressed={o.hat === h} onClick={() => setO({ hat: h })}>{h}</button>)}</div></div>
          {o.hat !== 'none' && <div className="field"><span>Hat colour</span><Swatches label="Hat colour" value={o.hatColor} onChange={(v) => setO({ hatColor: v })} /></div>}
          <div className="field"><span>Glasses</span><div className="row">{GLASSES.map((g) => <button key={g} type="button" className={`chip ${o.glasses === g ? 'ok' : ''}`} aria-pressed={o.glasses === g} onClick={() => setO({ glasses: g })}>{g}</button>)}</div></div>
          <div className="field"><span>Scarf</span><div className="row">{SCARVES.map((g) => <button key={g} type="button" className={`chip ${o.scarf === g ? 'ok' : ''}`} aria-pressed={o.scarf === g} onClick={() => setO({ scarf: g })}>{g}</button>)}</div></div>
          {o.scarf !== 'none' && <div className="field"><span>Scarf colour</span><Swatches label="Scarf colour" value={o.scarfColor} onChange={(v) => setO({ scarfColor: v })} /></div>}
          <div className="field"><span>Hoodie colour</span><Swatches label="Hoodie colour" value={o.hoodieColor} onChange={(v) => setO({ hoodieColor: v })} /></div>
          <div className="field"><span>Fur tint</span><Swatches label="Fur tint" allowNone value={o.furTint} onChange={(v) => setO({ furTint: v })} /></div>
        </section>
        <section className="card stack" aria-label="Personality">
          <h2 style={{ fontSize: '1.05rem', margin: 0 }}>Personality</h2>
          {SLIDERS.map((sl) => (
            <label key={sl.key} className="field">{sl.label}
              <input type="range" min={0} max={100} value={a.personality[sl.key]} onChange={(e) => setA({ ...a, personality: { ...a.personality, [sl.key]: Number(e.target.value) } })} aria-valuetext={`${a.personality[sl.key]} of 100`} />
              <span className="hint row" style={{ justifyContent: 'space-between' }}><span>{sl.lo}</span><span>{sl.hi}</span></span>
            </label>
          ))}
          <label className="field">Persona (free text)<span className="hint">Style only, e.g. “a cheerful baking enthusiast who loves puns”. It can&apos;t override safety rules.</span>
            <textarea className="input" rows={3} maxLength={1000} value={a.persona} onChange={(e) => setA({ ...a, persona: e.target.value })} />
          </label>
        </section>
        <section className="card stack" aria-label="Voice">
          <h2 style={{ fontSize: '1.05rem', margin: 0 }}>Voice</h2>
          <label className="field">Voice<select className="input" value={a.voice.voiceId} onChange={(e) => setA({ ...a, voice: { ...a.voice, voiceId: e.target.value } })}>
            <option value="">System default</option>
            {voices.map((v) => <option key={v.voiceURI} value={v.voiceURI}>{v.name} ({v.lang})</option>)}
          </select></label>
          <label className="field">Speed<input type="range" min={0.5} max={2} step={0.05} value={a.voice.rate} onChange={(e) => setA({ ...a, voice: { ...a.voice, rate: Number(e.target.value) } })} /></label>
          <label className="field">Pitch<input type="range" min={0.5} max={2} step={0.05} value={a.voice.pitch} onChange={(e) => setA({ ...a, voice: { ...a.voice, pitch: Number(e.target.value) } })} /></label>
          <button type="button" className="btn secondary" onClick={() => { setPreview('speaking'); void new DeviceTTS(a.voice, s.me!.settings.language).speak(`Hi, I'm ${a.name}! How can I help today?`, () => {}).then(() => setPreview('idle')); }}>Try voice</button>
        </section>
      </div>
      <div className="row" style={{ position: 'sticky', bottom: 80, marginTop: 20 }}>
        <button className="btn" disabled={saving || !a.name.trim()} onClick={() => void save()}>Save</button>
      </div>
    </main>
  );
}
