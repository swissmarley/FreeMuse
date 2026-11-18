/** Connect ElevenLabs with the user's own API key (free plan works). The key stays encrypted on the server. */
import { useEffect, useState } from 'react';
import { Alert, Linking, Text } from 'react-native';
import { fmt, strings } from '@muse/core/i18n';
import { api } from './api';
import { useMuse } from './store';
import { useTheme } from './theme';
import { Button, Card, Field } from './ui';
import { loadVoiceConfig } from './voice';

export function ElevenLabsCard({ name, onChange }: { name: string; onChange?: () => void }) {
  const { s } = useMuse();
  const th = useTheme();
  const t = strings(s.me?.settings.language);
  const [st, setSt] = useState<{ configured: boolean; keyHint: string | null } | null>(null);
  const [key, setKey] = useState('');
  const [busy, setBusy] = useState(false);
  const load = () => void api.elevenlabsStatus().then(setSt).catch(() => setSt(null));
  useEffect(load, []);
  return (
    <Card>
      <Text accessibilityRole="header" style={{ fontSize: 17, fontWeight: '800', color: th.text }}>🎙️ {t.elTitle}</Text>
      {st?.configured ? (
        <>
          <Text style={{ color: th.success, fontWeight: '700' }}>{fmt(t.elConnectedAs, { hint: st.keyHint ?? '' })}</Text>
          <Button kind="ghost" label={t.elRemoveKey} onPress={async () => { await api.removeElevenlabsKey(); await loadVoiceConfig(true); load(); onChange?.(); }} />
        </>
      ) : (
        <>
          <Text style={{ color: th.textMuted }}>{fmt(t.elIntro, { name })}</Text>
          <Text style={{ color: th.textMuted, fontSize: 13 }}>{t.elKeySteps}</Text>
          <Text accessibilityRole="link" style={{ color: th.accent, fontWeight: '700' }} onPress={() => void Linking.openURL('https://elevenlabs.io/app/settings/api-keys')}>{t.elGetKey}</Text>
          <Field label={t.elApiKey} value={key} onChangeText={setKey} autoCapitalize="none" autoCorrect={false} secureTextEntry placeholder="sk_…" />
          <Button label={busy ? t.elChecking : t.elSaveKey} disabled={busy || key.trim().length < 20} onPress={async () => {
            setBusy(true);
            try { await api.saveElevenlabsKey(key.trim()); setKey(''); await loadVoiceConfig(true); load(); onChange?.(); Alert.alert(t.elKeySaved); } catch (e) { Alert.alert(t.elTitle, (e as Error).message); } finally { setBusy(false); }
          }} />
        </>
      )}
      <Text style={{ color: th.textMuted, fontSize: 12 }}>{t.elStoredNote}</Text>
    </Card>
  );
}
