'use client';
import { useEffect, useState } from 'react';
import { type AvatarSettings, type AvatarState, AVATAR_STATES, GLASSES, HATS, SCARVES } from '@muse/core/avatar';
import { fmt, speechLocale, strings, type Strings } from '@muse/core/i18n';
import { DEFAULT_ELEVEN_VOICE, ELEVEN_DEFAULT_VOICES, ELEVEN_MODELS, type ElevenVoice, isNiceDeviceVoice, naturalVoiceSpeaks, rankDeviceVoices } from '@muse/core/voice';
import { Avatar } from '../../../components/Avatar';
import { ElevenLabsSetup } from '../../../components/ElevenLabsSetup';
import { api } from '../../../lib/api';
import { useMuse } from '../../../lib/store';
import { asVoiceLike, deviceVoices, loadVoiceConfig, previewVoice, useVoiceConfig } from '../../../lib/voice';

const COLORS = ['#F3E7D3', '#F7D9C4', '#E8D5F2', '#CFE3F5', '#D7EBD3', '#F6E3A6', '#C9465A', '#6B4E31', '#3A2A1B', '#8DB7D9'];
const SLIDERS: { key: keyof AvatarSettings['personality']; label: keyof Strings; lo: keyof Strings; hi: keyof Strings }[] = [
  { key: 'warmth', label: 'warmth', lo: 'warmthLo', hi: 'warmthHi' },
  { key: 'playfulness', label: 'playfulness', lo: 'playfulnessLo', hi: 'playfulnessHi' },
  { key: 'verbosity', label: 'verbosity', lo: 'verbosityLo', hi: 'verbosityHi' },
  { key: 'proactivity', label: 'proactivity', lo: 'proactivityLo', hi: 'proactivityHi' },
  { key: 'formality', label: 'formality', lo: 'formalityLo', hi: 'formalityHi' },
];

function Swatches({ value, onChange, label, allowNone, noneLabel }: { value: string; onChange: (v: string) => void; label: string; allowNone?: boolean; noneLabel?: string }) {
  return (
    <div role="group" aria-label={label} className="swatches">
      {allowNone && <button type="button" className="swatch" aria-pressed={value === ''} aria-label={noneLabel} onClick={() => onChange('')} style={{ background: 'repeating-linear-gradient(45deg,#eee,#eee 4px,#fff 4px,#fff 8px)' }} />}
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
  const [trying, setTrying] = useState<string | null>(null);
  const [elVoices, setElVoices] = useState<ElevenVoice[]>([]);
  const vcfg = useVoiceConfig();
  const [elStatus, setElStatus] = useState<{ configured: boolean; keyHint: string | null } | null>(null);
  const lang = s.me!.settings.language;
  const t = strings(lang);
  useEffect(() => {
    void deviceVoices().then(setVoices);
    const load = () => setVoices(window.speechSynthesis?.getVoices() ?? []);
    window.speechSynthesis?.addEventListener?.('voiceschanged', load);
    return () => window.speechSynthesis?.removeEventListener?.('voiceschanged', load);
  }, []);
  useEffect(() => { if (vcfg?.elevenlabs) setElStatus(vcfg.elevenlabs); }, [vcfg]);
  useEffect(() => {
    if (!elStatus?.configured) { setElVoices([]); return; }
    void api.elevenlabsVoices().then((r) => setElVoices(r.voices)).catch(() => setElVoices([]));
  }, [elStatus?.configured]);
  const locale = speechLocale(lang);
  const ranked = rankDeviceVoices(voices.map(asVoiceLike), locale);
  const naturalOk = !!vcfg?.natural.available;
  const elOk = !!elStatus?.configured;
  const naturalForLang = naturalOk && naturalVoiceSpeaks(lang);
  const v = a.voice;
  const setV = (patch: Partial<AvatarSettings['voice']>) => setA({ ...a, voice: { ...v, ...patch } });
  const tryVoice = async (pref: AvatarSettings['voice'], id: string) => {
    setTrying(id);
    setPreview('speaking');
    try { await previewVoice(pref, lang, fmt(t.voicePreview, { name: a.name })); } finally { setTrying(null); setPreview('happy'); }
  };
  const o = a.outfit;
  const setO = (patch: Partial<AvatarSettings['outfit']>) => setA({ ...a, outfit: { ...o, ...patch } });
  const save = async () => {
    setSaving(true);
    try { await api.saveAvatar(a); await refreshMe(); toast(t.saved); setPreview('happy'); } catch (e) { toast((e as Error).message); } finally { setSaving(false); }
  };
  const usesEleven = v.provider === 'elevenlabs' || (v.provider === 'auto' && elOk);
  const usesNatural = !usesEleven && (v.provider === 'server' || (v.provider === 'auto' && naturalForLang));
  const usesDevice = v.provider === 'device' || (!usesEleven && !usesNatural);
  const selectedEl = v.elevenVoice || DEFAULT_ELEVEN_VOICE;
  const elList: ElevenVoice[] = elVoices.length ? elVoices : ELEVEN_DEFAULT_VOICES.map((d) => ({ id: d.id, name: d.name, category: 'premade', description: '', gender: d.gender }));
  return (
    <main className="page">
      <h1>{fmt(t.customiseName, { name: a.name })}</h1>
      <p className="lead">{fmt(t.customiseLead, { name: a.name })}</p>
      <div style={{ display: 'grid', gridTemplateColumns: 'minmax(0,1fr)', gap: 20 }}>
        <section className="card" style={{ textAlign: 'center' }} aria-label={t.preview}>
          <Avatar settings={a} state={preview} size={200} reducedMotion={s.me!.settings.reducedMotion} />
          <div className="row" style={{ justifyContent: 'center', marginTop: 10 }}>
            {AVATAR_STATES.map((st) => <button key={st} className={`chip ${preview === st ? 'ok' : ''}`} onClick={() => setPreview(st)} aria-pressed={preview === st}>{st}</button>)}
          </div>
        </section>
        <section className="card stack">
          <label className="field">{t.name}<input className="input" value={a.name} maxLength={40} onChange={(e) => setA({ ...a, name: e.target.value })} /></label>
          <div className="field"><span>{t.hat}</span><div className="row">{HATS.map((h) => <button key={h} type="button" className={`chip ${o.hat === h ? 'ok' : ''}`} aria-pressed={o.hat === h} onClick={() => setO({ hat: h })}>{h}</button>)}</div></div>
          {o.hat !== 'none' && <div className="field"><span>{t.hatColour}</span><Swatches label={t.hatColour} value={o.hatColor} onChange={(c) => setO({ hatColor: c })} /></div>}
          <div className="field"><span>{t.glasses}</span><div className="row">{GLASSES.map((g) => <button key={g} type="button" className={`chip ${o.glasses === g ? 'ok' : ''}`} aria-pressed={o.glasses === g} onClick={() => setO({ glasses: g })}>{g}</button>)}</div></div>
          <div className="field"><span>{t.scarf}</span><div className="row">{SCARVES.map((g) => <button key={g} type="button" className={`chip ${o.scarf === g ? 'ok' : ''}`} aria-pressed={o.scarf === g} onClick={() => setO({ scarf: g })}>{g}</button>)}</div></div>
          {o.scarf !== 'none' && <div className="field"><span>{t.scarfColour}</span><Swatches label={t.scarfColour} value={o.scarfColor} onChange={(c) => setO({ scarfColor: c })} /></div>}
          <div className="field"><span>{t.hoodieColour}</span><Swatches label={t.hoodieColour} value={o.hoodieColor} onChange={(c) => setO({ hoodieColor: c })} /></div>
          <div className="field"><span>{t.furTint}</span><Swatches label={t.furTint} allowNone noneLabel={t.natural} value={o.furTint} onChange={(c) => setO({ furTint: c })} /></div>
        </section>
        <section className="card stack" aria-label={t.personality}>
          <h2 style={{ fontSize: '1.05rem', margin: 0 }}>{t.personality}</h2>
          {SLIDERS.map((sl) => (
            <label key={sl.key} className="field">{t[sl.label]}
              <input type="range" min={0} max={100} value={a.personality[sl.key]} onChange={(e) => setA({ ...a, personality: { ...a.personality, [sl.key]: Number(e.target.value) } })} aria-valuetext={`${a.personality[sl.key]} / 100`} />
              <span className="hint row" style={{ justifyContent: 'space-between' }}><span>{t[sl.lo]}</span><span>{t[sl.hi]}</span></span>
            </label>
          ))}
          <label className="field">{t.persona}<span className="hint">{t.personaHint}</span>
            <textarea className="input" rows={3} maxLength={1000} value={a.persona} onChange={(e) => setA({ ...a, persona: e.target.value })} />
          </label>
        </section>
        <section className="card stack" aria-label={t.voice}>
          <h2 style={{ fontSize: '1.05rem', margin: 0 }}>{t.voice}</h2>
          <div className="field"><span>{fmt(t.howSpeaks, { name: a.name })}</span>
            <div className="row" role="radiogroup" aria-label={fmt(t.howSpeaks, { name: a.name })}>
              {([
                ['auto', t.engineAuto, t.engineAutoHint],
                ['elevenlabs', t.engineElevenlabs, t.engineElevenlabsHint],
                ['server', t.engineServer, t.engineServerHint],
                ['device', t.engineDevice, t.engineDeviceHint],
              ] as const).map(([id, label, hint]) => (
                <button key={id} type="button" role="radio" aria-checked={v.provider === id} title={hint} className={`chip ${v.provider === id ? 'ok' : ''}`}
                  onClick={() => setV(id === 'device' ? { provider: id, voiceId: v.voiceId || ranked[0]?.id || '' } : { provider: id })}>{label}</button>
              ))}
            </div>
            <span className="hint">{({ auto: t.engineAutoHint, elevenlabs: t.engineElevenlabsHint, server: t.engineServerHint, device: t.engineDeviceHint } as const)[v.provider]}</span>
          </div>

          {(v.provider === 'elevenlabs' || v.provider === 'auto') && (
            <ElevenLabsSetup t={t} name={a.name} status={elStatus} toast={toast} onChange={(vs) => { void loadVoiceConfig(true).then((c) => setElStatus(c?.elevenlabs ?? null)); if (vs) setElVoices(vs); }} />
          )}
          {usesEleven && elOk && (
            <>
              <div className="field"><span>{t.elVoice}</span>
                <span className="hint">{t.elVoiceHint}</span>
                <div className="voice-grid" role="radiogroup" aria-label={t.elVoice}>
                  {elList.slice(0, 24).map((ev) => (
                    <div key={ev.id} className={`voice-card ${selectedEl === ev.id ? 'on' : ''}`}>
                      <button type="button" role="radio" aria-checked={selectedEl === ev.id} className="voice-pick" onClick={() => setV({ elevenVoice: ev.id })}>
                        <strong>{ev.name}</strong> <span className="muted">{ev.gender === 'female' ? '♀' : ev.gender === 'male' ? '♂' : ''}</span><br />
                        <span className="hint">{[ev.description, ev.accent, ev.category !== 'premade' ? ev.category : ''].filter(Boolean).join(' · ')}</span>
                      </button>
                      <button type="button" className="icon-btn" aria-label={fmt(t.playVoice, { name: ev.name })} disabled={!!trying} onClick={() => void tryVoice({ ...v, provider: 'elevenlabs', elevenVoice: ev.id }, ev.id)}>{trying === ev.id ? '…' : '▶'}</button>
                    </div>
                  ))}
                </div>
              </div>
              <label className="field">{t.elModel}
                <select className="input" value={v.elevenModel} onChange={(e) => setV({ elevenModel: e.target.value })}>
                  {ELEVEN_MODELS.map((m) => <option key={m.id} value={m.id}>{t[m.labelKey]}</option>)}
                </select>
              </label>
            </>
          )}

          {(v.provider === 'server' || (v.provider === 'auto' && !elOk)) && (
            naturalOk ? (
              <div className="field"><span>{t.naturalVoices}</span>
                {!naturalForLang && <span className="hint">{fmt(t.naturalEnglishOnly, { name: a.name })}</span>}
                <div className="voice-grid" role="radiogroup" aria-label={t.naturalVoices}>
                  {vcfg!.natural.voices.map((nv) => (
                    <div key={nv.id} className={`voice-card ${v.naturalVoice === nv.id ? 'on' : ''}`}>
                      <button type="button" role="radio" aria-checked={v.naturalVoice === nv.id} className="voice-pick" onClick={() => setV({ naturalVoice: nv.id })}>
                        <strong>{nv.label}</strong> <span className="muted">{nv.gender === 'female' ? '♀' : '♂'}</span><br /><span className="hint">{nv.description}</span>
                      </button>
                      <button type="button" className="icon-btn" aria-label={fmt(t.playVoice, { name: nv.label })} disabled={!!trying} onClick={() => void tryVoice({ ...v, provider: 'server', naturalVoice: nv.id }, nv.id)}>{trying === nv.id ? '…' : '▶'}</button>
                    </div>
                  ))}
                </div>
                {vcfg!.natural.status === 'loading' && <span className="hint">{t.naturalDownloading}</span>}
              </div>
            ) : (
              <p className="hint" style={{ margin: 0 }}>{fmt(t.naturalOff, { name: a.name })}</p>
            )
          )}
          {usesDevice && (
            <label className="field">{t.deviceVoice}
              <span className="hint">{t.deviceVoiceHint}</span>
              <select className="input" value={v.voiceId || ''} onChange={(e) => setV({ voiceId: e.target.value })}>
                {v.provider !== 'device' && <option value="">{t.bestAvailable}</option>}
                {ranked.map((x) => <option key={x.id} value={x.id}>{isNiceDeviceVoice(x, locale) ? '★ ' : ''}{x.name} ({x.lang})</option>)}
              </select>
              {ranked.length > 0 && !ranked.some((x) => isNiceDeviceVoice(x, locale)) && <span className="hint">{t.basicVoicesOnly}</span>}
            </label>
          )}
          <label className="field">{t.speed}<input type="range" min={0.5} max={2} step={0.05} value={v.rate} onChange={(e) => setV({ rate: Number(e.target.value) })} aria-valuetext={`${v.rate.toFixed(2)}×`} /></label>
          {!usesEleven && <label className="field">{t.pitch}<span className="hint">{t.pitchHint}</span><input type="range" min={0.8} max={1.3} step={0.05} value={v.pitch} onChange={(e) => setV({ pitch: Number(e.target.value) })} aria-valuetext={`${v.pitch.toFixed(2)}`} /></label>}
          <button type="button" className="btn secondary" disabled={!!trying} onClick={() => void tryVoice(v, 'current')}>{trying === 'current' ? t.speaking : t.tryVoice}</button>
        </section>
      </div>
      <div className="row" style={{ position: 'sticky', bottom: 80, marginTop: 20 }}>
        <button className="btn" disabled={saving || !a.name.trim()} onClick={() => void save()}>{t.save}</button>
      </div>
    </main>
  );
}
