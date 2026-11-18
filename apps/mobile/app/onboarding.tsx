import { useEffect, useState } from 'react';
import { Text, View } from 'react-native';
import { ageOn, MIN_AGE } from '@muse/core/schemas';
import { DEFAULT_AVATAR } from '@muse/core/avatar';
import { fmt, isLang, type Lang, LANGUAGES, strings } from '@muse/core/i18n';
import { api, getSavedLang, saveLang, setServerUrl } from '../src/api';
import { Avatar } from '../src/Avatar';
import { useMuse } from '../src/store';
import { useTheme } from '../src/theme';
import { Button, Card, Disclosure, Field, Screen } from '../src/ui';

export default function Onboarding() {
  const { s, signIn, refreshMe } = useMuse();
  const th = useTheme();
  // English by default; the choice is remembered on this device and saved with the account.
  const [lang, setLangState] = useState<Lang>('en');
  const t = strings(lang);
  const [step, setStep] = useState<'hello' | 'age' | 'account' | 'name' | 'blocked'>(s.me && !s.me.onboarded ? 'name' : 'hello');
  const [server, setServer] = useState(api.baseUrl);
  const [dob, setDob] = useState('');
  const [mode, setMode] = useState<'signup' | 'login'>('signup');
  const [email, setEmail] = useState('');
  const [pw, setPw] = useState('');
  const [name, setName] = useState(s.me?.avatar.name ?? DEFAULT_AVATAR.name);
  const [err, setErr] = useState('');
  const [busy, setBusy] = useState(false);
  useEffect(() => { void getSavedLang().then((l) => { if (isLang(l)) setLangState(l); }); }, []);
  useEffect(() => { if (s.me && isLang(s.me.settings.language)) setLangState(s.me.settings.language); }, [s.me]);
  const setLang = (l: Lang) => { setLangState(l); void saveLang(l); };

  const start = async (login: boolean) => {
    setBusy(true);
    setErr('');
    try {
      if (server.trim() && server.trim() !== api.baseUrl) setServer(await setServerUrl(server));
      if (login) setMode('login');
      setStep('age');
    } catch (e) { setErr((e as Error).message); } finally { setBusy(false); }
  };
  const account = async () => {
    setBusy(true);
    setErr('');
    try {
      const r = mode === 'signup' ? await api.signup({ email, password: pw, birthDate: dob, acceptTerms: true, language: lang }) : await api.login(email, pw);
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
          <Text style={{ fontSize: 22, fontWeight: '800', color: th.text }}>{fmt(t.welcomeTitle, { name: avatar.name })} 👋</Text>
          <Text style={{ color: th.text }}>{t.welcomeBody}</Text>
          <Disclosure />
          <Text style={{ color: th.text, fontWeight: '700' }}>{t.language}</Text>
          <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 8 }} accessibilityRole="radiogroup">
            {(Object.entries(LANGUAGES) as [Lang, string][]).map(([k, v]) => <Button key={k} kind={lang === k ? 'primary' : 'ghost'} label={v} onPress={() => setLang(k)} />)}
          </View>
          <Field label={t.serverAddress} value={server} onChangeText={setServer} autoCapitalize="none" autoCorrect={false} keyboardType="url" placeholder="http://192.168.1.20:4000" />
          <Text style={{ color: th.textMuted, fontSize: 12 }}>{t.serverAddressHint}</Text>
          {err ? <Text accessibilityRole="alert" style={{ color: th.danger }}>{err}</Text> : null}
          <Button label={t.letsStart} disabled={busy} onPress={() => void start(false)} />
          <Button kind="ghost" label={t.haveAccount} disabled={busy} onPress={() => void start(true)} />
        </Card>
      )}
      {step === 'age' && (
        <Card>
          <Text accessibilityRole="header" style={{ fontSize: 20, fontWeight: '800', color: th.text }}>{t.ageGateTitle}</Text>
          <Text style={{ color: th.textMuted }}>{t.ageGateBody}</Text>
          <Field label={t.dateOfBirthFormat} value={dob} onChangeText={setDob} placeholder="1990-05-20" keyboardType="numbers-and-punctuation" />
          {err ? <Text accessibilityRole="alert" style={{ color: th.danger }}>{err}</Text> : null}
          <Button label={t.continue} onPress={() => {
            if (!/^\d{4}-\d{2}-\d{2}$/.test(dob)) return setErr(t.dobFormat);
            if (ageOn(dob) < MIN_AGE) return setStep('blocked');
            setErr('');
            setStep('account');
          }} />
        </Card>
      )}
      {step === 'blocked' && <Card><Text accessibilityRole="alert" style={{ color: th.text }}>{t.tooYoung}</Text></Card>}
      {step === 'account' && (
        <Card>
          <Text accessibilityRole="header" style={{ fontSize: 20, fontWeight: '800', color: th.text }}>{mode === 'signup' ? t.createAccount : t.welcomeBack}</Text>
          <Field label={t.email} value={email} onChangeText={setEmail} autoCapitalize="none" keyboardType="email-address" autoComplete="email" />
          <Field label={t.passwordMin} value={pw} onChangeText={setPw} secureTextEntry autoComplete={mode === 'signup' ? 'new-password' : 'current-password'} />
          {mode === 'signup' && <Text style={{ color: th.textMuted, fontSize: 13 }}>{t.termsConsent}</Text>}
          {err ? <Text accessibilityRole="alert" style={{ color: th.danger }}>{err}</Text> : null}
          <Button label={mode === 'signup' ? t.createAccountBtn : t.signIn} disabled={busy} onPress={() => void account()} />
          <Button kind="ghost" label={mode === 'signup' ? t.alreadyHaveAccount : t.createNewAccount} onPress={() => setMode(mode === 'signup' ? 'login' : 'signup')} />
        </Card>
      )}
      {step === 'name' && (
        <Card>
          <Text accessibilityRole="header" style={{ fontSize: 20, fontWeight: '800', color: th.text }}>{t.whatToCallMe}</Text>
          <Field label={t.name} value={name} onChangeText={setName} maxLength={40} />
          {err ? <Text accessibilityRole="alert" style={{ color: th.danger }}>{err}</Text> : null}
          <Button label={t.startChatting} disabled={busy || !name.trim()} onPress={() => void finish()} />
        </Card>
      )}
    </Screen>
  );
}
