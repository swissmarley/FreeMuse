import { useEffect, useState } from 'react';
import { Pressable, Text, View } from 'react-native';
import { type AvatarSettings, type AvatarState, AVATAR_STATES, GLASSES, HATS, SCARVES } from '@muse/core/avatar';
import { api } from '../src/api';
import { Avatar } from '../src/Avatar';
import { useMuse } from '../src/store';
import { useTheme } from '../src/theme';
import { Button, Card, Field, Screen } from '../src/ui';
import { fmt, speechLocale, strings, type Strings } from '@muse/core/i18n';
import { DEFAULT_ELEVEN_VOICE, ELEVEN_DEFAULT_VOICES, ELEVEN_MODELS, type DeviceVoiceLike, type ElevenVoice, isNiceDeviceVoice, naturalVoiceSpeaks } from '@muse/core/voice';
import { ElevenLabsCard } from '../src/ElevenLabsCard';
import { loadVoiceConfig, previewVoice, rankedDeviceVoices, useVoiceConfig } from '../src/voice';

const COLORS = ['#F3E7D3', '#F7D9C4', '#E8D5F2', '#CFE3F5', '#D7EBD3', '#F6E3A6', '#C9465A', '#6B4E31', '#8DB7D9'];
const SLIDERS: (keyof AvatarSettings['personality'] & keyof Strings)[] = ['warmth', 'playfulness', 'verbosity', 'proactivity', 'formality'];

function Options<T extends string>({ label, values, value, onChange, labels }: { label: string; values: readonly T[]; value: T; onChange: (v: T) => void; labels?: Partial<Record<T, string>> }) {
  const th = useTheme();
  return (
    <View style={{ gap: 6 }}>
      <Text style={{ color: th.text, fontWeight: '700' }}>{label}</Text>
      <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 6 }} accessibilityRole="radiogroup">
        {values.map((v) => (
          <Pressable key={v} accessibilityRole="radio" accessibilityState={{ selected: v === value }} onPress={() => onChange(v)}
            style={{ paddingHorizontal: 12, paddingVertical: 8, borderRadius: 999, borderWidth: 1, borderColor: v === value ? th.accent : th.border, backgroundColor: v === value ? th.surfaceAlt : th.surface }}>
            <Text style={{ color: th.text, fontWeight: v === value ? '800' : '500' }}>{labels?.[v] ?? v}</Text>
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

function SpeedPitch({ label, value, min, max, onChange }: { label: string; value: number; min: number; max: number; onChange: (v: number) => void }) {
  const th = useTheme();
  const step = (d: number) => onChange(Math.round(Math.max(min, Math.min(max, value + d)) * 100) / 100);
  return (
    <View style={{ flexDirection: 'row', alignItems: 'center', gap: 10 }} accessible accessibilityRole="adjustable" accessibilityLabel={label} accessibilityValue={{ text: value.toFixed(2) }}
      accessibilityActions={[{ name: 'increment' }, { name: 'decrement' }]} onAccessibilityAction={(e) => step(e.nativeEvent.actionName === 'increment' ? 0.05 : -0.05)}>
      <Text style={{ color: th.text, flex: 1, fontWeight: '700' }}>{label}</Text>
      <Button kind="secondary" label="−" onPress={() => step(-0.05)} />
      <Text style={{ color: th.text, width: 44, textAlign: 'center' }}>{value.toFixed(2)}</Text>
      <Button kind="secondary" label="+" onPress={() => step(0.05)} />
    </View>
  );
}

export default function AvatarScreen() {
  const { s, refreshMe } = useMuse();
  const [a, setA] = useState<AvatarSettings>(s.me!.avatar);
  const [preview, setPreview] = useState<AvatarState>('wave');
  const o = a.outfit;
  const setO = (p: Partial<AvatarSettings['outfit']>) => setA({ ...a, outfit: { ...o, ...p } });
  const th = useTheme();
  const lang = s.me!.settings.language;
  const t = strings(lang);
  const vcfg = useVoiceConfig();
  const [elOk, setElOk] = useState(false);
  const [elVoices, setElVoices] = useState<ElevenVoice[]>([]);
  useEffect(() => { setElOk(!!vcfg?.elevenlabs?.configured); }, [vcfg]);
  useEffect(() => {
    if (!elOk) return;
    void api.elevenlabsVoices().then((r) => setElVoices(r.voices)).catch(() => setElVoices(ELEVEN_DEFAULT_VOICES.map((d) => ({ id: d.id, name: d.name, category: 'premade', description: '', gender: d.gender }))));
  }, [elOk]);
  const [devVoices, setDevVoices] = useState<DeviceVoiceLike[]>([]);
  const [trying, setTrying] = useState(false);
  useEffect(() => { void rankedDeviceVoices(lang).then(setDevVoices); }, [lang]);
  const v = a.voice;
  const setV = (p: Partial<AvatarSettings['voice']>) => setA({ ...a, voice: { ...v, ...p } });
  const naturalOk = !!vcfg?.natural.available;
  const tryVoice = async (pref = v) => {
    setTrying(true);
    setPreview('speaking');
    try { await previewVoice(pref, lang, fmt(t.voicePreview, { name: a.name })); } finally { setTrying(false); setPreview('happy'); }
  };
  const ENGINES = ['auto', 'elevenlabs', 'server', 'device'] as const;
  const ENGINE_LABEL = { auto: t.engineAuto, elevenlabs: t.engineElevenlabs, server: t.engineServer, device: t.engineDevice };
  const usesEleven = elOk && (v.provider === 'elevenlabs' || v.provider === 'auto');
  const locale = speechLocale(lang);
  return (
    <Screen>
      <Card style={{ alignItems: 'center' }}>
        <Avatar settings={a} state={preview} size={180} />
        <Options label={t.preview} values={AVATAR_STATES} value={preview} onChange={setPreview} />
      </Card>
      <Card>
        <Field label={t.name} value={a.name} onChangeText={(name) => setA({ ...a, name })} maxLength={40} />
        <Options label={t.hat} values={HATS} value={o.hat} onChange={(hat) => setO({ hat })} />
        {o.hat !== 'none' && <Colors label={t.hatColour} value={o.hatColor} onChange={(hatColor) => setO({ hatColor })} />}
        <Options label={t.glasses} values={GLASSES} value={o.glasses} onChange={(glasses) => setO({ glasses })} />
        <Options label={t.scarf} values={SCARVES} value={o.scarf} onChange={(scarf) => setO({ scarf })} />
        {o.scarf !== 'none' && <Colors label={t.scarfColour} value={o.scarfColor} onChange={(scarfColor) => setO({ scarfColor })} />}
        <Colors label={t.hoodieColour} value={o.hoodieColor} onChange={(hoodieColor) => setO({ hoodieColor })} />
        <Colors label={t.furTint} value={o.furTint} onChange={(furTint) => setO({ furTint })} />
      </Card>
      <Card>
        {SLIDERS.map((k) => <Stepper key={k} label={t[k]} value={a.personality[k]} onChange={(v) => setA({ ...a, personality: { ...a.personality, [k]: v } })} />)}
        <Field label={t.persona} value={a.persona} onChangeText={(persona) => setA({ ...a, persona })} multiline maxLength={1000} />
      </Card>
      <Card>
        <Text accessibilityRole="header" style={{ color: th.text, fontWeight: '800', fontSize: 17 }}>{t.voice}</Text>
        <Options label={fmt(t.howSpeaks, { name: a.name })} values={ENGINES} value={v.provider} labels={ENGINE_LABEL}
          onChange={(p) => setV(p === 'device' ? { provider: p, voiceId: v.voiceId || devVoices[0]?.id || '' } : { provider: p })} />
        <Text style={{ color: th.textMuted, fontSize: 13 }}>{({ auto: t.engineAutoHint, elevenlabs: t.engineElevenlabsHint, server: t.engineServerHint, device: t.engineDeviceHint } as const)[v.provider]}</Text>
        {usesEleven && elVoices.length > 0 && (
          <>
            <Options label={t.elVoice} values={elVoices.slice(0, 16).map((e) => e.id)} value={v.elevenVoice || DEFAULT_ELEVEN_VOICE}
              labels={Object.fromEntries(elVoices.map((e) => [e.id, e.name]))} onChange={(id) => setV({ elevenVoice: id })} />
            <Text style={{ color: th.textMuted, fontSize: 13 }}>{t.elVoiceHint}</Text>
            <Options label={t.elModel} values={ELEVEN_MODELS.map((m) => m.id)} value={v.elevenModel} labels={Object.fromEntries(ELEVEN_MODELS.map((m) => [m.id, t[m.labelKey]]))} onChange={(elevenModel) => setV({ elevenModel })} />
          </>
        )}
        {v.provider === 'elevenlabs' && !elOk && <Text style={{ color: th.warning, fontSize: 13 }}>{t.elNotSetUp}</Text>}
        {(v.provider === 'server' || (v.provider === 'auto' && !elOk)) && naturalOk && (
          <>
            <Options label={t.naturalVoices} values={vcfg!.natural.voices.map((n) => n.label)} value={vcfg!.natural.voices.find((n) => n.id === v.naturalVoice)?.label ?? 'Heart'}
              onChange={(label) => setV({ naturalVoice: vcfg!.natural.voices.find((n) => n.label === label)!.id })} />
            <Text style={{ color: th.textMuted, fontSize: 13 }}>{vcfg!.natural.voices.find((n) => n.id === v.naturalVoice)?.description}{!naturalVoiceSpeaks(lang) ? ` · ${fmt(t.naturalEnglishOnly, { name: a.name })}` : ''}</Text>
          </>
        )}
        {v.provider === 'server' && !naturalOk && <Text style={{ color: th.textMuted, fontSize: 13 }}>{fmt(t.naturalOff, { name: a.name })}</Text>}
        {!usesEleven && (v.provider === 'device' || !naturalOk || !naturalVoiceSpeaks(lang)) && devVoices.length > 0 && (
          <Options label={`${t.deviceVoice} (${t.deviceVoiceHint})`} values={devVoices.slice(0, 10).map((d) => `${isNiceDeviceVoice(d, locale) ? '★ ' : ''}${d.name}`)}
            value={(() => { const d = devVoices.find((x) => x.id === v.voiceId) ?? devVoices[0]!; return `${isNiceDeviceVoice(d, locale) ? '★ ' : ''}${d.name}`; })()}
            onChange={(label) => { const d = devVoices.find((x) => label.endsWith(x.name)); if (d) setV({ voiceId: d.id }); }} />
        )}
        <SpeedPitch label={t.speed} value={v.rate} min={0.5} max={2} onChange={(rate) => setV({ rate })} />
        {!usesEleven && <SpeedPitch label={`${t.pitch} (${t.pitchHint})`} value={v.pitch} min={0.8} max={1.3} onChange={(pitch) => setV({ pitch })} />}
        <Button kind="secondary" label={trying ? t.speaking : t.tryVoice} disabled={trying} onPress={() => void tryVoice()} />
      </Card>
      {(v.provider === 'auto' || v.provider === 'elevenlabs') && <ElevenLabsCard name={a.name} onChange={() => void loadVoiceConfig(true).then((c) => setElOk(!!c?.elevenlabs?.configured))} />}
      <Button label={t.save} disabled={!a.name.trim()} onPress={async () => { await api.saveAvatar(a); await refreshMe(); setPreview('happy'); }} />
    </Screen>
  );
}
