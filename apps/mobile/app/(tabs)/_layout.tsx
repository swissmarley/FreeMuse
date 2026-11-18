import { Tabs } from 'expo-router';
import { Text, type ColorValue } from 'react-native';
import { strings } from '@muse/core/i18n';
import { useMuse } from '../../src/store';
import { useTheme } from '../../src/theme';

const icon = (glyph: string) => ({ color }: { color: ColorValue }) => <Text style={{ color, fontSize: 18 }} accessibilityElementsHidden>{glyph}</Text>;

export default function TabsLayout() {
  const { s } = useMuse();
  const th = useTheme();
  const t = strings(s.me?.settings.language ?? 'en');
  return (
    <Tabs screenOptions={{ headerShown: false, tabBarActiveTintColor: th.accent, tabBarStyle: { backgroundColor: th.surface, borderTopColor: th.border } }}>
      <Tabs.Screen name="index" options={{ title: t.chat, tabBarIcon: icon('💬') }} />
      <Tabs.Screen name="tasks" options={{ title: t.tasks, tabBarIcon: icon('📋'), tabBarBadge: s.tasksRunning || undefined }} />
      <Tabs.Screen name="approvals" options={{ title: t.approvals, tabBarIcon: icon('✅'), tabBarBadge: s.pendingApprovals || undefined }} />
      <Tabs.Screen name="activity" options={{ title: t.activity, tabBarIcon: icon('🕒') }} />
      <Tabs.Screen name="more" options={{ title: 'More', tabBarIcon: icon('⋯') }} />
    </Tabs>
  );
}
