import { useState } from 'react';
import { Text, View } from 'react-native';
import { ageOn, MIN_AGE } from '@muse/core/schemas';
import { DEFAULT_AVATAR } from '@muse/core/avatar';
import { strings } from '@muse/core/i18n';
import { api } from '../src/api';
import { Avatar } from '../src/Avatar';
import { useMuse } from '../src/store';
import { useTheme } from '../src/theme';
import { Button, Card, Disclosure, Field, Screen } from '../src/ui';

export default function Onboarding() {
  const { s, signIn, refreshMe } = useMuse();
  const th = useTheme();
  const t = strings('en');
  const [step, setStep] = useState<'hello' | 'age' | 'account' | 'name' | 'blocked'>(s.me && !s.me.onboarded ? 'name' : 'hello');
  const [dob, setDob] = useState('');
  const [mode, setMode] = useState<'signup' | 'login'>('signup');
  const [email, setEmail] = useState('');
  const [pw, setPw] = useState('');
  const [name, setName] = useState(s.me?.avatar.name ?? DEFAULT_AVATAR.name);
  const [err, setErr] = useState('');
  const [busy, setBusy] = useState(false);

  const account = async () => {
    setBusy(true);
    setErr('');
    try {
      const r = mode === 'signup' ? await api.signup({ email, password: pw, birthDate: dob, acceptTerms: true }) : await api.login(email, pw);
      await signIn(r.token);
      setStep('name');
    } catch (e) { setErr((e as Error).message); } finally { setBusy(false); }
  };
  const finish = async () => {
    setBusy(true);
    try {
      const me = await api.me();
      await api.saveAvatar({ ...me.avatar, name: name.trim() || DEFAULT_AVATAR.name });
      await api.completeOnboarding();
      await refreshMe();
    } catch (e) { setErr((e as Error).message); setBusy(false); }
  };
  const avatar = { ...DEFAULT_AVATAR, name };
  return (
    <Screen>
      <View style={{ alignItems: 'center', marginTop: 24 }}><Avatar settings={avatar} state={step === 'hello' ? 'wave' : step === 'blocked' ? 'sleeping' : 'idle'} size={170} /></View>
      {step === 'hello' && (
        <Card>
          <Text style={{ fontSize: 22, fontWeight: '800', color: th.text }}>{t.welcomeTitle.replace('{name}', avatar.name)} 👋</Text>
          <Text style={{ color: th.text }}>{t.welcomeBody}</Text>
          <Disclosure />
          <Button label="Let's start" onPress={() => setStep('age')} />
          <Button kind="ghost" label="I have an account" onPress={() => { setMode('login'); setStep('age'); }} />
        </Card>
      )}
      {step === 'age' && (
        <Card>
          <Text accessibilityRole="header" style={{ fontSize: 20, fontWeight: '800', color: th.text }}>{t.ageGateTitle}</Text>
          <Text style={{ color: th.textMuted }}>{t.ageGateBody}</Text>
          <Field label="Date of birth (YYYY-MM-DD)" value={dob} onChangeText={setDob} placeholder="1990-05-20" keyboardType="numbers-and-punctuation" />
          {err ? <Text accessibilityRole="alert" style={{ color: th.danger }}>{err}</Text> : null}
          <Button label="Continue" onPress={() => {
            if (!/^\d{4}-\d{2}-\d{2}$/.test(dob)) return setErr('Please use the format YYYY-MM-DD');
            if (ageOn(dob) < MIN_AGE) return setStep('blocked');
            setErr('');
            setStep('account');
          }} />
        </Card>
      )}
      {step === 'blocked' && <Card><Text accessibilityRole="alert" style={{ color: th.text }}>{t.tooYoung}</Text></Card>}
      {step === 'account' && (
        <Card>
          <Text accessibilityRole="header" style={{ fontSize: 20, fontWeight: '800', color: th.text }}>{mode === 'signup' ? 'Create your account' : 'Welcome back'}</Text>
          <Field label="Email" value={email} onChangeText={setEmail} autoCapitalize="none" keyboardType="email-address" autoComplete="email" />
          <Field label="Password (10+ characters)" value={pw} onChangeText={setPw} secureTextEntry autoComplete={mode === 'signup' ? 'new-password' : 'current-password'} />
          {mode === 'signup' && <Text style={{ color: th.textMuted, fontSize: 13 }}>By continuing you confirm you understand this is an AI agent and agree to the privacy notice. You can export or delete your data any time.</Text>}
          {err ? <Text accessibilityRole="alert" style={{ color: th.danger }}>{err}</Text> : null}
          <Button label={mode === 'signup' ? 'Create account' : 'Sign in'} disabled={busy} onPress={() => void account()} />
          <Button kind="ghost" label={mode === 'signup' ? 'I already have an account' : 'Create a new account'} onPress={() => setMode(mode === 'signup' ? 'login' : 'signup')} />
        </Card>
      )}
      {step === 'name' && (
        <Card>
          <Text accessibilityRole="header" style={{ fontSize: 20, fontWeight: '800', color: th.text }}>What should you call me?</Text>
          <Field label="Name" value={name} onChangeText={setName} maxLength={40} />
          {err ? <Text accessibilityRole="alert" style={{ color: th.danger }}>{err}</Text> : null}
          <Button label="Start chatting" disabled={busy || !name.trim()} onPress={() => void finish()} />
        </Card>
      )}
    </Screen>
  );
}
