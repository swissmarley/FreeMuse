import type { ReactNode } from 'react';
import { Pressable, ScrollView, StyleSheet, Switch, Text, TextInput, View, type TextInputProps, type ViewStyle } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { BRAND } from '@muse/core/brand';
import { useTheme } from './theme';

export function Screen({ title, lead, children, scroll = true }: { title?: string; lead?: string; children: ReactNode; scroll?: boolean }) {
  const t = useTheme();
  const body = (
    <>
      {title ? <Text accessibilityRole="header" style={[styles.h1, { color: t.text }]}>{title}</Text> : null}
      {lead ? <Text style={[styles.lead, { color: t.textMuted }]}>{lead}</Text> : null}
      {children}
    </>
  );
  return (
    <SafeAreaView style={{ flex: 1, backgroundColor: t.bg }} edges={['top']}>
      {scroll ? <ScrollView contentContainerStyle={{ padding: 16, paddingBottom: 48, gap: 12 }}>{body}</ScrollView> : <View style={{ flex: 1 }}>{body}</View>}
    </SafeAreaView>
  );
}

export function Card({ children, style }: { children: ReactNode; style?: ViewStyle }) {
  const t = useTheme();
  return <View style={[{ backgroundColor: t.surface, borderColor: t.border, borderWidth: 1, borderRadius: t.radius.lg, padding: 16, gap: 8 }, style]}>{children}</View>;
}

export function Button({ label, onPress, kind = 'primary', disabled, accessibilityHint }: { label: string; onPress: () => void; kind?: 'primary' | 'secondary' | 'danger' | 'ghost'; disabled?: boolean; accessibilityHint?: string }) {
  const t = useTheme();
  const bg = kind === 'primary' ? t.accent : kind === 'danger' ? t.danger : kind === 'secondary' ? t.surfaceAlt : 'transparent';
  const fg = kind === 'primary' ? t.accentText : kind === 'danger' ? '#fff' : t.text;
  return (
    <Pressable accessibilityRole="button" accessibilityLabel={label} accessibilityHint={accessibilityHint} accessibilityState={{ disabled }} disabled={disabled} onPress={onPress}
      style={({ pressed }) => [{ backgroundColor: bg, borderRadius: 999, paddingVertical: 12, paddingHorizontal: 20, minHeight: 44, alignItems: 'center', justifyContent: 'center', opacity: disabled ? 0.5 : 1, transform: [{ scale: pressed ? 0.97 : 1 }], borderWidth: kind === 'ghost' || kind === 'secondary' ? 1 : 0, borderColor: t.border }]}>
      <Text style={{ color: fg, fontWeight: '800' }}>{label}</Text>
    </Pressable>
  );
}

export function Field({ label, ...p }: TextInputProps & { label: string }) {
  const t = useTheme();
  return (
    <View style={{ gap: 6 }}>
      <Text style={{ color: t.text, fontWeight: '700' }}>{label}</Text>
      <TextInput accessibilityLabel={label} placeholderTextColor={t.textMuted} {...p} style={[{ borderWidth: 1, borderColor: t.border, borderRadius: t.radius.md, paddingHorizontal: 14, paddingVertical: 10, color: t.text, backgroundColor: t.surface, minHeight: 44 }, p.style]} />
    </View>
  );
}

export function Toggle({ label, hint, value, onChange }: { label: string; hint?: string; value: boolean; onChange: (v: boolean) => void }) {
  const t = useTheme();
  return (
    <View style={{ flexDirection: 'row', alignItems: 'center', gap: 12 }}>
      <View style={{ flex: 1 }}>
        <Text style={{ color: t.text, fontWeight: '700' }}>{label}</Text>
        {hint ? <Text style={{ color: t.textMuted, fontSize: 13 }}>{hint}</Text> : null}
      </View>
      <Switch accessibilityLabel={label} value={value} onValueChange={onChange} trackColor={{ true: t.success, false: t.border }} />
    </View>
  );
}

export function Chip({ label, tone }: { label: string; tone?: 'ok' | 'warn' | 'bad' }) {
  const t = useTheme();
  const color = tone === 'ok' ? t.success : tone === 'warn' ? t.warning : tone === 'bad' ? t.danger : t.text;
  return <View style={{ alignSelf: 'flex-start', paddingHorizontal: 10, paddingVertical: 4, borderRadius: 999, backgroundColor: t.surfaceAlt, borderWidth: 1, borderColor: t.border }}><Text style={{ color, fontSize: 13, fontWeight: '700' }}>{label}</Text></View>;
}

export function Disclosure() {
  const t = useTheme();
  return <Text style={{ color: t.textMuted, fontSize: 12, textAlign: 'center', paddingVertical: 4 }}>{BRAND.aiDisclosure}</Text>;
}

const styles = StyleSheet.create({
  h1: { fontSize: 28, fontWeight: '800' },
  lead: { fontSize: 15, marginBottom: 8 },
});
