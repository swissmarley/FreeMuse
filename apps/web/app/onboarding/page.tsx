'use client';
import { useRouter } from 'next/navigation';
import { useEffect, useRef, useState } from 'react';
import { ageOn, MIN_AGE } from '@muse/core/schemas';
import { BRAND } from '@muse/core/brand';
import { DEFAULT_AVATAR, type AvatarSettings } from '@muse/core/avatar';
import { isLang, type Lang, LANGUAGES, strings } from '@muse/core/i18n';
import { Avatar } from '../../components/Avatar';
import { api } from '../../lib/api';
import { fmt, useMuse } from '../../lib/store';
import { previewVoice } from '../../lib/voice';

type Step = 'hello' | 'age' | 'account' | 'name' | 'connect' | 'blocked';

export default function Onboarding() {
  const { s, refreshMe } = useMuse();
  const router = useRouter();
  // English by default; the choice is remembered on this device and saved with the account.
  const [lang, setLangState] = useState<Lang>('en');
  useEffect(() => { try { const l = localStorage.getItem('freemuse.lang'); if (isLang(l)) setLangState(l); } catch { /* private mode */ } }, []);
  const setLang = (l: Lang) => { setLangState(l); try { localStorage.setItem('freemuse.lang', l); } catch { /* private mode */ } document.documentElement.lang = l; };
  const t = strings(lang);
  const [step, setStep] = useState<Step>('hello');
  const [dob, setDob] = useState('');
  const [mode, setMode] = useState<'signup' | 'login'>('signup');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [terms, setTerms] = useState(false);
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const [avatar, setAvatar] = useState<AvatarSettings>(DEFAULT_AVATAR);
  const [speaking, setSpeaking] = useState(false);
  const [googleReady, setGoogleReady] = useState(false);
  const mouth = useRef(0);

  const hearVoice = async () => {
    setSpeaking(true);
    try { await previewVoice(avatar.voice, lang, fmt(t.hearMyVoiceLine, { name: avatar.name }), (v) => { mouth.current = v; }); } finally { setSpeaking(false); mouth.current = 0; }
  };

  useEffect(() => {
    if (s.me?.onboarded) router.replace('/');
    else if (s.me && !s.me.onboarded) { setAvatar(s.me.avatar); setStep('name'); if (isLang(s.me.settings.language)) setLangState(s.me.settings.language); }
  }, [s.me, router]);

  const checkAge = () => {
    if (!/^\d{4}-\d{2}-\d{2}$/.test(dob)) return setError(t.enterDob);
    const age = ageOn(dob);
    if (age < MIN_AGE) { setStep('blocked'); return; }
    if (age > 120) return setError(t.checkDate);
    setError('');
    setStep('account');
  };

  const submitAccount = async (e: React.FormEvent) => {
    e.preventDefault();
    setBusy(true);
    setError('');
    try {
      if (mode === 'signup') await api.signup({ email, password, birthDate: dob, acceptTerms: true, language: lang });
      else {
        const r = await api.login(email, password);
        if (r.me.settings.language) setLang(isLang(r.me.settings.language) ? r.me.settings.language : 'en');
      }
      await refreshMe();
    } catch (er) {
      setError((er as Error).message);
    } finally {
      setBusy(false);
    }
  };

  const toConnect = async () => {
    setBusy(true);
    setError('');
    try {
      await api.saveAvatar(avatar);
      const { connectors } = await api.connectors().catch(() => ({ connectors: [] as { group?: string; available: boolean }[] }));
      setGoogleReady(connectors.some((c) => c.group === 'google' && c.available));
      setStep('connect');
    } catch (er) { setError((er as Error).message); } finally { setBusy(false); }
  };

  /** Finish onboarding, optionally connecting apps in one tap on the way. */
  const finish = async (connect?: 'demo' | 'google') => {
    setBusy(true);
    setError('');
    try {
      await api.completeOnboarding();
      if (connect === 'google') {
        const r = await api.quickConnect('google');
        if (r.authorizeUrl) { window.location.href = r.authorizeUrl; return; }
      }
      if (connect === 'demo') await api.quickConnect('demo');
      await refreshMe();
      router.replace('/');
    } catch (er) { setError((er as Error).message); setBusy(false); }
  };

  const avatarState = speaking ? 'speaking' : step === 'hello' ? 'wave' : step === 'blocked' ? 'sleeping' : step === 'name' || step === 'connect' ? 'happy' : 'idle';
  return (
    <main className="center">
      <div className="onboard">
        <Avatar settings={avatar} state={avatarState} size={170} mouthRef={speaking ? mouth : undefined} />
        {step === 'hello' && (
          <div className="pop">
            <div className="speech" aria-live="polite">{fmt(t.welcomeTitle, { name: avatar.name })} 👋</div>
            <p>{t.welcomeBody}</p>
            <p className="disclosure">{BRAND.aiDisclosure}</p>
            <div className="row lang-pick" role="radiogroup" aria-label={t.language} style={{ justifyContent: 'center', marginBottom: 12 }}>
              {(Object.entries(LANGUAGES) as [Lang, string][]).map(([k, v]) => (
                <button key={k} type="button" role="radio" aria-checked={lang === k} className={`chip ${lang === k ? 'ok' : ''}`} onClick={() => setLang(k)} lang={k}>{v}</button>
              ))}
            </div>
            <div className="row" style={{ justifyContent: 'center' }}>
              <button className="btn" onClick={() => setStep('age')}>{t.letsStart}</button>
              <button className="btn ghost" onClick={() => { setMode('login'); setStep('age'); }}>{t.haveAccount}</button>
            </div>
          </div>
        )}
        {step === 'age' && (
          <form className="card stack pop" onSubmit={(e) => { e.preventDefault(); checkAge(); }}>
            <h1 style={{ fontSize: '1.3rem', margin: 0 }}>{t.ageGateTitle}</h1>
            <p className="muted" style={{ margin: 0 }}>{t.ageGateBody}</p>
            <label className="field">{t.dateOfBirth}<input className="input" type="date" required value={dob} max={new Date().toISOString().slice(0, 10)} onChange={(e) => setDob(e.target.value)} /></label>
            {error && <p role="alert" style={{ color: 'var(--c-danger)', margin: 0 }}>{error}</p>}
            <button className="btn" type="submit">{t.continue}</button>
          </form>
        )}
        {step === 'blocked' && (
          <div className="card pop" role="alert"><p style={{ margin: 0 }}>{t.tooYoung}</p></div>
        )}
        {step === 'account' && (
          <form className="card stack pop" onSubmit={submitAccount}>
            <h1 style={{ fontSize: '1.3rem', margin: 0 }}>{mode === 'signup' ? t.createAccount : t.welcomeBack}</h1>
            <label className="field">{t.email}<input className="input" type="email" autoComplete="email" required value={email} onChange={(e) => setEmail(e.target.value)} /></label>
            <label className="field">{t.password}<span className="hint">{t.passwordHint}</span><input className="input" type="password" autoComplete={mode === 'signup' ? 'new-password' : 'current-password'} required minLength={mode === 'signup' ? 10 : 1} value={password} onChange={(e) => setPassword(e.target.value)} /></label>
            {mode === 'signup' && (
              <label className="row" style={{ alignItems: 'flex-start', fontSize: '.9rem' }}>
                <input type="checkbox" checked={terms} onChange={(e) => setTerms(e.target.checked)} style={{ marginTop: 4 }} required />
                <span>{t.termsConsent}</span>
              </label>
            )}
            {error && <p role="alert" style={{ color: 'var(--c-danger)', margin: 0 }}>{error}</p>}
            <button className="btn" type="submit" disabled={busy || (mode === 'signup' && !terms)}>{mode === 'signup' ? t.createAccountBtn : t.signIn}</button>
            <button type="button" className="btn ghost" onClick={() => setMode(mode === 'signup' ? 'login' : 'signup')}>{mode === 'signup' ? t.alreadyHaveAccount : t.createNewAccount}</button>
          </form>
        )}
        {step === 'name' && (
          <div className="card stack pop">
            <h1 style={{ fontSize: '1.3rem', margin: 0 }}>{t.whatToCallMe}</h1>
            <label className="field">{t.name}<input className="input" value={avatar.name} maxLength={40} onChange={(e) => setAvatar({ ...avatar, name: e.target.value })} /></label>
            <label className="field">{t.speakingSpeed}<input type="range" min={0.6} max={1.6} step={0.05} value={avatar.voice.rate} onChange={(e) => setAvatar({ ...avatar, voice: { ...avatar.voice, rate: Number(e.target.value) } })} /></label>
            <label className="field">{t.voicePitch}<input type="range" min={0.6} max={1.6} step={0.05} value={avatar.voice.pitch} onChange={(e) => setAvatar({ ...avatar, voice: { ...avatar.voice, pitch: Number(e.target.value) } })} /></label>
            <button type="button" className="btn secondary" disabled={speaking} onClick={() => void hearVoice()}>{speaking ? t.speaking : t.hearMyVoice}</button>
            {error && <p role="alert" style={{ color: 'var(--c-danger)', margin: 0 }}>{error}</p>}
            <button className="btn" disabled={busy || !avatar.name.trim()} onClick={() => void toConnect()}>{t.continue}</button>
            <p className="muted" style={{ fontSize: '.85rem', margin: 0 }}>{t.changeAnyTime}</p>
          </div>
        )}
        {step === 'connect' && (
          <div className="card stack pop">
            <h1 style={{ fontSize: '1.3rem', margin: 0 }}>{t.helpEmailCalendar}</h1>
            <p className="muted" style={{ margin: 0 }}>{t.oneTapNote}</p>
            {googleReady && <button className="btn" disabled={busy} onClick={() => void finish('google')}>{t.connectGoogle}</button>}
            <button className="btn secondary" disabled={busy} onClick={() => void finish('demo')}>{t.tryDemoBtn}</button>
            {!googleReady && <p className="hint" style={{ margin: 0 }}>{t.googleLater}</p>}
            {error && <p role="alert" style={{ color: 'var(--c-danger)', margin: 0 }}>{error}</p>}
            <button className="btn ghost" disabled={busy} onClick={() => void finish()}>{t.skipForNow}</button>
          </div>
        )}
      </div>
    </main>
  );
}
