/** Push notifications via Expo (delivered through FCM on Android and APNs on iOS). */
import Constants from 'expo-constants';
import * as Device from 'expo-device';
import * as Notifications from 'expo-notifications';
import { Platform } from 'react-native';
import { api } from './api';

Notifications.setNotificationHandler({
  handleNotification: async () => ({ shouldShowBanner: true, shouldShowList: true, shouldPlaySound: true, shouldSetBadge: true }),
});

export async function registerForPush(): Promise<'enabled' | 'denied' | 'unsupported'> {
  if (!Device.isDevice) return 'unsupported';
  if (Platform.OS === 'android') {
    await Notifications.setNotificationChannelAsync('default', { name: 'Updates', importance: Notifications.AndroidImportance.HIGH });
  }
  let { status } = await Notifications.getPermissionsAsync();
  if (status !== 'granted') status = (await Notifications.requestPermissionsAsync()).status;
  if (status !== 'granted') return 'denied';
  const projectId = Constants.expoConfig?.extra?.eas?.projectId as string | undefined;
  const token = (await Notifications.getExpoPushTokenAsync(projectId ? { projectId } : undefined)).data;
  await api.registerPush({ kind: 'expo', token });
  return 'enabled';
}

/** Route taps on notifications (e.g. "Approval needed") to the right screen. */
export function onNotificationTap(go: (url: string) => void) {
  const sub = Notifications.addNotificationResponseReceivedListener((r) => {
    const url = (r.notification.request.content.data as { url?: string })?.url ?? '/';
    go(url.split('?')[0] ?? '/');
  });
  return () => sub.remove();
}
