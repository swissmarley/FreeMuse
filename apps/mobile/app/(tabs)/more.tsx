import { useRouter } from 'expo-router';
import { Avatar } from '../../src/Avatar';
import { fmt, strings } from '@muse/core/i18n';
import { useMuse } from '../../src/store';
import { Button, Card, Disclosure, Screen } from '../../src/ui';

export default function More() {
  const { s } = useMuse();
  const router = useRouter();
  const t = strings(s.me!.settings.language);
  return (
    <Screen title={t.more}>
      <Card style={{ alignItems: 'center' }}><Avatar settings={s.me!.avatar} state="happy" size={110} /></Card>
      <Button kind="secondary" label={t.memory} onPress={() => router.push('/memory')} />
      <Button kind="secondary" label={t.connectionsAndPermissions} onPress={() => router.push('/connections')} />
      <Button kind="secondary" label={fmt(t.customiseName, { name: s.me!.avatar.name })} onPress={() => router.push('/avatar')} />
      <Button kind="secondary" label={t.settingsAndPrivacy} onPress={() => router.push('/settings')} />
      <Disclosure />
    </Screen>
  );
}
