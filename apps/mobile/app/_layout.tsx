import { Stack, useRouter, useSegments } from 'expo-router';
import { StatusBar } from 'expo-status-bar';
import { useEffect } from 'react';
import { SafeAreaProvider } from 'react-native-safe-area-context';
import { onNotificationTap, registerForPush } from '../src/push';
import { strings } from '@muse/core/i18n';
import { MuseProvider, useMuse } from '../src/store';

function Gate() {
  const { s } = useMuse();
  const segments = useSegments();
  const router = useRouter();
  useEffect(() => {
    if (s.me === undefined) return;
    const inOnboarding = segments[0] === 'onboarding';
    if ((!s.me || !s.me.onboarded) && !inOnboarding) router.replace('/onboarding');
    if (s.me?.onboarded && inOnboarding) router.replace('/');
  }, [s.me, segments, router]);
  useEffect(() => {
    if (!s.me?.onboarded) return;
    void registerForPush().catch(() => {});
    return onNotificationTap((url) => router.push(url as never));
  }, [s.me?.onboarded, router]);
  const t = strings(s.me?.settings.language);
  return (
    <Stack screenOptions={{ headerShown: false }}>
      <Stack.Screen name="(tabs)" />
      <Stack.Screen name="onboarding" />
      <Stack.Screen name="memory" options={{ headerShown: true, title: t.memory }} />
      <Stack.Screen name="connections" options={{ headerShown: true, title: t.connections }} />
      <Stack.Screen name="avatar" options={{ headerShown: true, title: s.me ? strings(s.me.settings.language).customiseName.replace('{name}', s.me.avatar.name) : t.avatar }} />
      <Stack.Screen name="settings" options={{ headerShown: true, title: t.settings }} />
    </Stack>
  );
}

export default function RootLayout() {
  return (
    <SafeAreaProvider>
      <MuseProvider>
        <StatusBar style="auto" />
        <Gate />
      </MuseProvider>
    </SafeAreaProvider>
  );
}
