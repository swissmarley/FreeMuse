import { useRouter } from 'expo-router';
import { Alert, Share, Text, View } from 'react-native';
import type { UserSettings } from '@muse/core';
import { BRAND } from '@muse/core/brand';
import { fmt, LANGUAGES, speechLocale, strings } from '@muse/core/i18n';
import { api } from '../src/api';
import { useMuse } from '../src/store';
import { useTheme } from '../src/theme';
import { Button, Card, Screen, Toggle } from '../src/ui';
import { ElevenLabsCard } from '../src/ElevenLabsCard';

export default function Settings() {
  const { s, refreshMe, signOut } = useMuse();
  const th = useTheme();
  const router = useRouter();
  const me = s.me!;
  const st = me.settings;
  const t = strings(st.language);
  const allowed = me.features?.contributorMode !== false;
  const save = async (p: Partial<UserSettings> & { contributorConsent?: true }) => {
    try { await api.saveSettings(p as Partial<UserSettings>); await refreshMe(); } catch (e) { Alert.alert(t.settings, (e as Error).message); }
  };
  const askContributor = () => Alert.alert(t.contributorConsentTitle, `${t.contributorConsentBody}\n\n${t.contributorConsentCheck}`, [
    { text: t.cancel, style: 'cancel' },
    { text: t.contributorAgree, onPress: () => void save({ contributorMode: true, contributorConsent: true }) },
  ]);
  return (
    <Screen>
      <Card>
        <Text accessibilityRole="header" style={{ fontSize: 17, fontWeight: '800', color: th.text }}>{t.app}</Text>
        <Text style={{ color: th.text, fontWeight: '700' }}>{t.language}</Text>
        <Text style={{ color: th.textMuted, fontSize: 13 }}>{fmt(t.languageHint, { name: me.avatar.name })}</Text>
        <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 8 }}>
          {Object.entries(LANGUAGES).map(([k, v]) => <Button key={k} kind={st.language === k ? 'primary' : 'ghost'} label={v} onPress={() => void save({ language: k })} />)}
        </View>
        <Text style={{ color: th.text, fontWeight: '700' }}>{t.theme}</Text>
        <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 8 }}>
          {([['system', t.themeSystem], ['light', t.themeLight], ['dark', t.themeDark]] as const).map(([k, label]) => <Button key={k} kind={st.theme === k ? 'primary' : 'ghost'} label={label} onPress={() => void save({ theme: k })} />)}
        </View>
        <Toggle label={t.reduceMotion} hint={t.reduceMotionHint} value={st.reducedMotion} onChange={(v) => void save({ reducedMotion: v })} />
      </Card>
      <ElevenLabsCard name={me.avatar.name} />
      <Button kind="secondary" label={`${fmt(t.customiseName, { name: me.avatar.name })} → ${t.voice}`} onPress={() => router.push('/avatar')} />
      <Card>
        <Text accessibilityRole="header" style={{ fontSize: 17, fontWeight: '800', color: th.text }}>{t.privacyAndData}</Text>
        <Toggle label={t.contributorMode} hint={allowed ? t.contributorModeHint : t.contributorUnavailable} value={st.contributorMode}
          onChange={(v) => { if (!v) void save({ contributorMode: false }); else if (allowed) askContributor(); }} />
        {st.contributorMode && st.contributorConsentAt ? <Text style={{ color: th.warning, fontSize: 13 }}>{fmt(t.contributorOn, { date: new Date(st.contributorConsentAt).toLocaleDateString(speechLocale(st.language)) })}</Text> : null}
        <Toggle label={t.proactiveSuggestions} hint={t.proactiveSuggestionsHint} value={st.proactiveSuggestions} onChange={(v) => void save({ proactiveSuggestions: v })} />
        <Toggle label={t.autoSaveDrafts} hint={t.autoSaveDraftsHint} value={st.autoApproveDrafts} onChange={(v) => void save({ autoApproveDrafts: v })} />
        <Button kind="secondary" label={t.exportData} onPress={async () => { const d = await api.exportData(); await Share.share({ message: JSON.stringify(d) }); }} />
        <Button kind="danger" label={t.deleteAll} onPress={() => Alert.alert(t.deleteAll, t.deleteConfirm, [
          { text: t.cancel, style: 'cancel' },
          { text: t.delete, style: 'destructive', onPress: async () => { await api.deleteAccount(); await signOut(); } },
        ])} />
        <Text style={{ color: th.textMuted, fontSize: 13 }}>{t.dataStored}</Text>
      </Card>
      <Text style={{ color: th.textMuted, textAlign: 'center' }}>{BRAND.appName} · {fmt(t.signedInAs, { email: me.email })}</Text>
      <Text style={{ color: th.textMuted, textAlign: 'center', fontSize: 12 }}>{t.server}: {api.baseUrl}</Text>
      <Button kind="ghost" label={t.signOut} onPress={() => void signOut()} />
    </Screen>
  );
}
