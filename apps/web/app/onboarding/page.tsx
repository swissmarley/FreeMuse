'use client';
import { useRouter } from 'next/navigation';
import { useEffect, useRef, useState } from 'react';
import { ageOn, MIN_AGE } from '@muse/core/schemas';
import { BRAND } from '@muse/core/brand';
import { DEFAULT_AVATAR, type AvatarSettings } from '@muse/core/avatar';
import { strings } from '@muse/core/i18n';
import { Avatar } from '../../components/Avatar';
import { api } from '../../lib/api';
import { fmt, useMuse } from '../../lib/store';
import { previewVoice } from '../../lib/voice';

type Step = 'hello' | 'age' | 'account' | 'name' | 'connect' | 'blocked';

export default function Onboarding() {
  const { s, refreshMe } = useMuse();
  const router = useRouter();
  const t = strings('en');
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
    try { await previewVoice(avatar.voice, 'en', `Hi! I'm ${avatar.name}. I can't wait to help you!`, (v) => { mouth.current = v; }); } finally { setSpeaking(false); mouth.current = 0; }
  };

  useEffect(() => {
    if (s.me?.onboarded) router.replace('/');
    else if (s.me && !s.me.onboarded) { setAvatar(s.me.avatar); setStep('name'); }
  }, [s.me, router]);

  const checkAge = () => {
    if (!/^\d{4}-\d{2}-\d{2}$/.test(dob)) return setError('Please enter your date of birth.');
    const age = ageOn(dob);
    if (age < MIN_AGE) { setStep('blocked'); return; }
    if (age > 120) return setError('Please check the date.');
    setError('');
    setStep('account');
  };

  const submitAccount = async (e: React.FormEvent) => {
    e.preventDefault();
    setBusy(true);
    setError('');
    try {
      if (mode === 'signup') await api.signup({ email, password, birthDate: dob, acceptTerms: true });
      else await api.login(email, password);
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
            <div className="row" style={{ justifyContent: 'center' }}>
              <button className="btn" onClick={() => setStep('age')}>Let&apos;s start</button>
              <button className="btn ghost" onClick={() => { setMode('login'); setStep('age'); }}>I have an account</button>
            </div>
          </div>
        )}
        {step === 'age' && (
          <form className="card stack pop" onSubmit={(e) => { e.preventDefault(); checkAge(); }}>
            <h1 style={{ fontSize: '1.3rem', margin: 0 }}>{t.ageGateTitle}</h1>
            <p className="muted" style={{ margin: 0 }}>{t.ageGateBody}</p>
            <label className="field">Date of birth<input className="input" type="date" required value={dob} max={new Date().toISOString().slice(0, 10)} onChange={(e) => setDob(e.target.value)} /></label>
            {error && <p role="alert" style={{ color: 'var(--c-danger)', margin: 0 }}>{error}</p>}
            <button className="btn" type="submit">Continue</button>
          </form>
        )}
        {step === 'blocked' && (
          <div className="card pop" role="alert"><p style={{ margin: 0 }}>{t.tooYoung}</p></div>
        )}
        {step === 'account' && (
          <form className="card stack pop" onSubmit={submitAccount}>
            <h1 style={{ fontSize: '1.3rem', margin: 0 }}>{mode === 'signup' ? 'Create your account' : 'Welcome back'}</h1>
            <label className="field">Email<input className="input" type="email" autoComplete="email" required value={email} onChange={(e) => setEmail(e.target.value)} /></label>
            <label className="field">Password<span className="hint">At least 10 characters.</span><input className="input" type="password" autoComplete={mode === 'signup' ? 'new-password' : 'current-password'} required minLength={mode === 'signup' ? 10 : 1} value={password} onChange={(e) => setPassword(e.target.value)} /></label>
            {mode === 'signup' && (
              <label className="row" style={{ alignItems: 'flex-start', fontSize: '.9rem' }}>
                <input type="checkbox" checked={terms} onChange={(e) => setTerms(e.target.checked)} style={{ marginTop: 4 }} required />
                <span>I understand this is an AI agent, I agree to the processing described in the privacy notice (PRIVACY.md), and I can export or delete my data at any time.</span>
              </label>
            )}
            {error && <p role="alert" style={{ color: 'var(--c-danger)', margin: 0 }}>{error}</p>}
            <button className="btn" type="submit" disabled={busy || (mode === 'signup' && !terms)}>{mode === 'signup' ? 'Create account' : 'Sign in'}</button>
            <button type="button" className="btn ghost" onClick={() => setMode(mode === 'signup' ? 'login' : 'signup')}>{mode === 'signup' ? 'I already have an account' : 'Create a new account'}</button>
          </form>
        )}
        {step === 'name' && (
          <div className="card stack pop">
            <h1 style={{ fontSize: '1.3rem', margin: 0 }}>What should you call me?</h1>
            <label className="field">Name<input className="input" value={avatar.name} maxLength={40} onChange={(e) => setAvatar({ ...avatar, name: e.target.value })} /></label>
            <label className="field">Speaking speed<input type="range" min={0.6} max={1.6} step={0.05} value={avatar.voice.rate} onChange={(e) => setAvatar({ ...avatar, voice: { ...avatar.voice, rate: Number(e.target.value) } })} /></label>
            <label className="field">Voice pitch<input type="range" min={0.6} max={1.6} step={0.05} value={avatar.voice.pitch} onChange={(e) => setAvatar({ ...avatar, voice: { ...avatar.voice, pitch: Number(e.target.value) } })} /></label>
            <button type="button" className="btn secondary" disabled={speaking} onClick={() => void hearVoice()}>{speaking ? 'Speaking…' : 'Hear my voice'}</button>
            {error && <p role="alert" style={{ color: 'var(--c-danger)', margin: 0 }}>{error}</p>}
            <button className="btn" disabled={busy || !avatar.name.trim()} onClick={() => void toConnect()}>Continue</button>
            <p className="muted" style={{ fontSize: '.85rem', margin: 0 }}>You can change my look, personality and voice any time.</p>
          </div>
        )}
        {step === 'connect' && (
          <div className="card stack pop">
            <h1 style={{ fontSize: '1.3rem', margin: 0 }}>Shall I help with your email and calendar?</h1>
            <p className="muted" style={{ margin: 0 }}>One tap. I always ask before sending, booking or paying anything.</p>
            {googleReady && <button className="btn" disabled={busy} onClick={() => void finish('google')}>✉️📅 Connect Google</button>}
            <button className="btn secondary" disabled={busy} onClick={() => void finish('demo')}>🧪 Try with demo data</button>
            {!googleReady && <p className="hint" style={{ margin: 0 }}>Want Gmail and Google Calendar? You can set them up any time under <strong>Connections</strong>, with a short guide.</p>}
            {error && <p role="alert" style={{ color: 'var(--c-danger)', margin: 0 }}>{error}</p>}
            <button className="btn ghost" disabled={busy} onClick={() => void finish()}>Skip for now, start chatting</button>
          </div>
        )}
      </div>
    </main>
  );
}
