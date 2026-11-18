import * as Haptics from 'expo-haptics';
import { useCallback, useEffect, useState } from 'react';
import { Alert, Text, TextInput, View } from 'react-native';
import type { Approval } from '@muse/core';
import { fmt, strings, type Strings } from '@muse/core/i18n';
import { api } from '../../src/api';
import { useMuse } from '../../src/store';
import { useTheme } from '../../src/theme';
import { Button, Card, Chip, Screen } from '../../src/ui';

const CLASS_LABEL: Record<string, keyof Strings> = { send: 'classSend', spend: 'classSpend', write: 'classWrite', login: 'classLogin', draft: 'classDraft', read: 'classRead', navigate: 'classNavigate' };
const RISK: Record<string, keyof Strings> = { low: 'riskLow', medium: 'riskMedium', high: 'riskHigh' };
const EDITABLE = ['to', 'subject', 'body', 'title', 'start', 'end', 'location'];
const show = (v: unknown) => (Array.isArray(v) ? v.join(', ') : typeof v === 'object' ? JSON.stringify(v) : String(v));

function Item({ a, reload }: { a: Approval; reload: () => void }) {
  const th = useTheme();
  const { s, refreshCounts } = useMuse();
  const t = strings(s.me!.settings.language);
  const [edit, setEdit] = useState(false);
  const [draft, setDraft] = useState<Record<string, string>>({});
  const [busy, setBusy] = useState(false);
  const decide = async (d: 'approve' | 'reject') => {
    setBusy(true);
    try {
      let edited: Record<string, unknown> | undefined;
      if (edit && d === 'approve') { edited = {}; for (const [k, v] of Object.entries(draft)) edited[k] = Array.isArray(a.payload[k]) ? v.split(/[,;]\s*/) : v; }
      const r = await api.resolveApproval(a.id, d, edited);
      if (d === 'approve') await Haptics.notificationAsync(r.approval.status === 'executed' ? Haptics.NotificationFeedbackType.Success : Haptics.NotificationFeedbackType.Error);
      await refreshCounts();
      reload();
    } catch (e) { Alert.alert(t.couldNotComplete, (e as Error).message); } finally { setBusy(false); }
  };
  const riskTone = a.risk.level === 'high' ? 'bad' : a.risk.level === 'medium' ? 'warn' : 'ok';
  return (
    <Card style={{ borderLeftWidth: 6, borderLeftColor: a.risk.level === 'high' ? th.danger : a.risk.level === 'medium' ? th.warning : th.success }}>
      <View style={{ flexDirection: 'row', gap: 8, flexWrap: 'wrap' }}><Chip label={`${CLASS_LABEL[a.actionClass] ? t[CLASS_LABEL[a.actionClass]!] : a.actionClass} · ${a.connector.replace('_', ' ')}`} /><Chip label={fmt(t.risk, { level: RISK[a.risk.level] ? t[RISK[a.risk.level]!] : a.risk.level })} tone={riskTone} /></View>
      <Text accessibilityRole="header" style={{ fontSize: 17, fontWeight: '800', color: th.text }}>{a.title}</Text>
      {edit ? Object.keys(a.payload).filter((k) => EDITABLE.includes(k)).map((k) => (
        <View key={k}><Text style={{ color: th.textMuted, fontWeight: '700' }}>{k}</Text>
          <TextInput accessibilityLabel={k} multiline={k === 'body'} defaultValue={show(a.payload[k])} onChangeText={(v) => setDraft((d) => ({ ...d, [k]: v }))} style={{ borderWidth: 1, borderColor: th.border, borderRadius: 14, padding: 10, color: th.text, minHeight: k === 'body' ? 120 : 44 }} />
        </View>
      )) : Object.entries(a.preview).map(([k, v]) => <Text key={k} style={{ color: th.text }}><Text style={{ fontWeight: '800', color: th.textMuted }}>{k}: </Text>{show(v)}</Text>)}
      {a.risk.reasons.map((r) => <Text key={r} style={{ color: th.textMuted, fontSize: 13 }}>• {r}</Text>)}
      {a.status === 'pending' ? (
        <View style={{ gap: 8, marginTop: 6 }}>
          <Button label={edit ? t.approveEdited : t.approve} disabled={busy} onPress={() => void decide('approve')} />
          <Button kind="secondary" label={edit ? t.cancelEdit : t.edit} onPress={() => setEdit((x) => !x)} />
          <Button kind="ghost" label={t.reject} disabled={busy} onPress={() => void decide('reject')} />
        </View>
      ) : <Chip label={a.status} />}
    </Card>
  );
}

export default function Approvals() {
  const { s } = useMuse();
  const t = strings(s.me!.settings.language);
  const [items, setItems] = useState<Approval[]>([]);
  const load = useCallback(async () => setItems((await api.approvals('pending')).approvals), []);
  useEffect(() => { void load(); }, [load, s.version]);
  return (
    <Screen title={t.approvals} lead={t.approvalsLead}>
      {items.length === 0 ? <Text style={{ textAlign: 'center', opacity: 0.6, padding: 24 }}>{t.nothingPending}</Text> : items.map((a) => <Item key={a.id} a={a} reload={() => void load()} />)}
    </Screen>
  );
}
