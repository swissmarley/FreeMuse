import { useState } from 'react';
import { Pressable, Text, View } from 'react-native';
import * as Speech from 'expo-speech';
import { type AvatarSettings, type AvatarState, AVATAR_STATES, GLASSES, HATS, SCARVES } from '@muse/core/avatar';
import { api } from '../src/api';
import { Avatar } from '../src/Avatar';
import { useMuse } from '../src/store';
import { useTheme } from '../src/theme';
import { Button, Card, Field, Screen } from '../src/ui';

const COLORS = ['#F3E7D3', '#F7D9C4', '#E8D5F2', '#CFE3F5', '#D7EBD3', '#F6E3A6', '#C9465A', '#6B4E31', '#8DB7D9'];
const SLIDERS: (keyof AvatarSettings['personality'])[] = ['warmth', 'playfulness', 'verbosity', 'proactivity', 'formality'];

function Options<T extends string>({ label, values, value, onChange }: { label: string; values: readonly T[]; value: T; onChange: (v: T) => void }) {
  const th = useTheme();
  return (
    <View style={{ gap: 6 }}>
      <Text style={{ color: th.text, fontWeight: '700' }}>{label}</Text>
      <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 6 }} accessibilityRole="radiogroup">
        {values.map((v) => (
          <Pressable key={v} accessibilityRole="radio" accessibilityState={{ selected: v === value }} onPress={() => onChange(v)}
            style={{ paddingHorizontal: 12, paddingVertical: 8, borderRadius: 999, borderWidth: 1, borderColor: v === value ? th.accent : th.border, backgroundColor: v === value ? th.surfaceAlt : th.surface }}>
            <Text style={{ color: th.text, fontWeight: v === value ? '800' : '500' }}>{v}</Text>
          </Pressable>
        ))}
      </View>
    </View>
  );
}

function Colors({ label, value, onChange }: { label: string; value: string; onChange: (v: string) => void }) {
  const th = useTheme();
  return (
    <View style={{ gap: 6 }}>
      <Text style={{ color: th.text, fontWeight: '700' }}>{label}</Text>
      <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 8 }}>
        {COLORS.map((c) => <Pressable key={c} accessibilityRole="button" accessibilityLabel={`${label} ${c}`} accessibilityState={{ selected: c === value }} onPress={() => onChange(c)} style={{ width: 34, height: 34, borderRadius: 17, backgroundColor: c, borderWidth: 3, borderColor: c === value ? th.accent : 'transparent' }} />)}
      </View>
    </View>
  );
}

/** Stepper instead of a slider (no extra native dependency, fully accessible). */
function Stepper({ label, value, onChange }: { label: string; value: number; onChange: (v: number) => void }) {
  const th = useTheme();
  return (
    <View style={{ flexDirection: 'row', alignItems: 'center', gap: 10 }} accessible accessibilityRole="adjustable" accessibilityLabel={label} accessibilityValue={{ min: 0, max: 100, now: value }}
      accessibilityActions={[{ name: 'increment' }, { name: 'decrement' }]} onAccessibilityAction={(e) => onChange(Math.max(0, Math.min(100, value + (e.nativeEvent.actionName === 'increment' ? 10 : -10))))}>
      <Text style={{ color: th.text, flex: 1, fontWeight: '700', textTransform: 'capitalize' }}>{label}</Text>
      <Button kind="secondary" label="−" onPress={() => onChange(Math.max(0, value - 10))} />
      <Text style={{ color: th.text, width: 36, textAlign: 'center' }}>{value}</Text>
      <Button kind="secondary" label="+" onPress={() => onChange(Math.min(100, value + 10))} />
    </View>
  );
}

export default function AvatarScreen() {
  const { s, refreshMe } = useMuse();
  const [a, setA] = useState<AvatarSettings>(s.me!.avatar);
  const [preview, setPreview] = useState<AvatarState>('wave');
  const o = a.outfit;
  const setO = (p: Partial<AvatarSettings['outfit']>) => setA({ ...a, outfit: { ...o, ...p } });
  return (
    <Screen>
      <Card style={{ alignItems: 'center' }}>
        <Avatar settings={a} state={preview} size={180} />
        <Options label="Preview" values={AVATAR_STATES} value={preview} onChange={setPreview} />
      </Card>
      <Card>
        <Field label="Name" value={a.name} onChangeText={(name) => setA({ ...a, name })} maxLength={40} />
        <Options label="Hat" values={HATS} value={o.hat} onChange={(hat) => setO({ hat })} />
        {o.hat !== 'none' && <Colors label="Hat colour" value={o.hatColor} onChange={(hatColor) => setO({ hatColor })} />}
        <Options label="Glasses" values={GLASSES} value={o.glasses} onChange={(glasses) => setO({ glasses })} />
        <Options label="Scarf" values={SCARVES} value={o.scarf} onChange={(scarf) => setO({ scarf })} />
        {o.scarf !== 'none' && <Colors label="Scarf colour" value={o.scarfColor} onChange={(scarfColor) => setO({ scarfColor })} />}
        <Colors label="Hoodie colour" value={o.hoodieColor} onChange={(hoodieColor) => setO({ hoodieColor })} />
        <Colors label="Fur tint" value={o.furTint} onChange={(furTint) => setO({ furTint })} />
      </Card>
      <Card>
        {SLIDERS.map((k) => <Stepper key={k} label={k} value={a.personality[k]} onChange={(v) => setA({ ...a, personality: { ...a.personality, [k]: v } })} />)}
        <Field label="Persona (style only)" value={a.persona} onChangeText={(persona) => setA({ ...a, persona })} multiline maxLength={1000} />
        <Button kind="secondary" label="Try voice" onPress={() => { setPreview('speaking'); Speech.speak(`Hi, I'm ${a.name}!`, { rate: a.voice.rate, pitch: a.voice.pitch, onDone: () => setPreview('idle') }); }} />
      </Card>
      <Button label="Save" disabled={!a.name.trim()} onPress={async () => { await api.saveAvatar(a); await refreshMe(); setPreview('happy'); }} />
    </Screen>
  );
}
