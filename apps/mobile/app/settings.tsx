import { Alert, Share, Text } from 'react-native';
import type { UserSettings } from '@muse/core';
import { BRAND } from '@muse/core/brand';
import { LANGUAGES } from '@muse/core/i18n';
import { api } from '../src/api';
import { useMuse } from '../src/store';
import { useTheme } from '../src/theme';
import { Button, Card, Screen, Toggle } from '../src/ui';

export default function Settings() {
  const { s, refreshMe, signOut } = useMuse();
  const th = useTheme();
  const st = s.me!.settings;
  const save = async (p: Partial<UserSettings>) => { await api.saveSettings(p); await refreshMe(); };
  return (
    <Screen>
      <Card>
        <Text accessibilityRole="header" style={{ fontSize: 17, fontWeight: '800', color: th.text }}>Privacy & data</Text>
        <Toggle label="Do not use my data to train AI models" hint="On by default." value={st.trainingOptOut} onChange={(v) => void save({ trainingOptOut: v })} />
        <Toggle label="Proactive suggestions" value={st.proactiveSuggestions} onChange={(v) => void save({ proactiveSuggestions: v })} />
        <Toggle label="Auto-save drafts" hint="Sending always asks first." value={st.autoApproveDrafts} onChange={(v) => void save({ autoApproveDrafts: v })} />
        <Button kind="secondary" label="Export my data" onPress={async () => { const d = await api.exportData(); await Share.share({ message: JSON.stringify(d) }); }} />
        <Button kind="danger" label="Delete everything" onPress={() => Alert.alert('Delete everything?', 'This erases your account, chats, memories, tasks and audit trail. It cannot be undone.', [
          { text: 'Cancel', style: 'cancel' },
          { text: 'Delete', style: 'destructive', onPress: async () => { await api.deleteAccount(); await signOut(); } },
        ])} />
      </Card>
      <Card>
        <Text accessibilityRole="header" style={{ fontSize: 17, fontWeight: '800', color: th.text }}>App</Text>
        <Text style={{ color: th.text, fontWeight: '700' }}>Language</Text>
        {Object.entries(LANGUAGES).map(([k, v]) => <Button key={k} kind={st.language === k ? 'primary' : 'ghost'} label={v} onPress={() => void save({ language: k })} />)}
        <Text style={{ color: th.text, fontWeight: '700' }}>Theme</Text>
        {(['system', 'light', 'dark'] as const).map((k) => <Button key={k} kind={st.theme === k ? 'primary' : 'ghost'} label={k} onPress={() => void save({ theme: k })} />)}
        <Toggle label="Reduce motion" value={st.reducedMotion} onChange={(v) => void save({ reducedMotion: v })} />
      </Card>
      <Text style={{ color: th.textMuted, textAlign: 'center' }}>{BRAND.appName} · {s.me!.email}</Text>
      <Button kind="ghost" label="Sign out" onPress={() => void signOut()} />
    </Screen>
  );
}
