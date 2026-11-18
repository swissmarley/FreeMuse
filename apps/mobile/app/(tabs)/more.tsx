import { useRouter } from 'expo-router';
import { Avatar } from '../../src/Avatar';
import { useMuse } from '../../src/store';
import { Button, Card, Disclosure, Screen } from '../../src/ui';

export default function More() {
  const { s } = useMuse();
  const router = useRouter();
  return (
    <Screen title="More">
      <Card style={{ alignItems: 'center' }}><Avatar settings={s.me!.avatar} state="happy" size={110} /></Card>
      <Button kind="secondary" label="Memory" onPress={() => router.push('/memory')} />
      <Button kind="secondary" label="Connections & permissions" onPress={() => router.push('/connections')} />
      <Button kind="secondary" label={`Customise ${s.me!.avatar.name}`} onPress={() => router.push('/avatar')} />
      <Button kind="secondary" label="Settings & privacy" onPress={() => router.push('/settings')} />
      <Disclosure />
    </Screen>
  );
}
