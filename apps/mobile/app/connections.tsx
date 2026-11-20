import * as Linking from 'expo-linking';
import { useFocusEffect } from 'expo-router';
import { useCallback, useEffect, useState } from 'react';
import { Alert, Pressable, Share, Text, View } from 'react-native';
import type { Connection, ConnectorInfo } from '@muse/core';
import { fmt, strings } from '@muse/core/i18n';
import { api } from '../src/api';
import { useMuse } from '../src/store';

function useT() { const { s } = useMuse(); return strings(s.me?.settings.language); }
import { useTheme } from '../src/theme';
import { Button, Card, Chip, Field, Screen, Toggle } from '../src/ui';

type GoogleSetup = Awaited<ReturnType<typeof api.googleSetup>>;
const ICONS: Record<string, string> = { gmail: '✉️', gcal: '📅', gdrive: '📁' };

function ConnectorCard({ c, conn, reload }: { c: ConnectorInfo; conn?: Connection; reload: () => void }) {
  const th = useTheme();
  const t = useT();
  const [scopes, setScopes] = useState<string[]>(conn?.scopes ?? c.recommended ?? ['read']);
  const [open, setOpen] = useState(false);
  useEffect(() => { if (conn) setScopes(conn.scopes); }, [conn]);
  const save = async () => {
    try {
      const r = conn ? await api.updateScopes(conn.id, scopes) : await api.connect(c.id, scopes);
      if (r.authorizeUrl) await Linking.openURL(r.authorizeUrl);
      reload();
    } catch (e) { Alert.alert(t.connections, (e as Error).message); }
  };
  return (
    <Card>
      <View style={{ flexDirection: 'row', alignItems: 'center', gap: 10 }}>
        <Text style={{ fontSize: 22 }} accessibilityElementsHidden>{ICONS[c.id] ?? '🔌'}</Text>
        <Text accessibilityRole="header" style={{ fontSize: 17, fontWeight: '800', color: th.text, flex: 1 }}>{c.name}</Text>
        {conn ? <Chip label={`✓ ${t.connected}`} tone="ok" /> : null}
      </View>
      <Text style={{ color: th.textMuted }}>{c.description}{conn?.account ? ` · ${conn.account}` : ''}</Text>
      {!conn && c.available && <Button label={t.connect} disabled={!scopes.length} onPress={() => void save()} />}
      <Pressable accessibilityRole="button" accessibilityState={{ expanded: open }} onPress={() => setOpen(!open)}>
        <Text style={{ color: th.textMuted, fontWeight: '700' }}>{open ? '▾' : '▸'} {conn ? t.permissions : t.customisePermissions}</Text>
      </Pressable>
      {open && (
        <>
          {c.scopes.map((sc) => <Toggle key={sc.id} label={sc.label} hint={sc.description} value={scopes.includes(sc.id)} onChange={(v) => setScopes((x) => (v ? [...x, sc.id] : x.filter((y) => y !== sc.id)))} />)}
          {conn && <Button kind="secondary" label={t.savePermissions} disabled={!scopes.length} onPress={() => void save()} />}
          {conn && <Button kind="ghost" label={t.disconnect} onPress={async () => { await api.disconnect(conn.id); reload(); }} />}
        </>
      )}
    </Card>
  );
}

function GoogleSetupCard({ setup, onSaved }: { setup: GoogleSetup; onSaved: () => void }) {
  const th = useTheme();
  const t = useT();
  const [clientId, setClientId] = useState('');
  const [secret, setSecret] = useState('');
  const [busy, setBusy] = useState(false);
  const steps: [string, string][] = [
    [t.gsStep1, 'https://console.cloud.google.com/projectcreate'],
    [t.gsStep2, 'https://console.cloud.google.com/flows/enableapi?apiid=gmail.googleapis.com,calendar-json.googleapis.com,drive.googleapis.com'],
    [t.gsStep3, 'https://console.cloud.google.com/auth/overview'],
    [t.gsStep4, 'https://console.cloud.google.com/auth/clients/create'],
  ];
  return (
    <Card>
      <Text accessibilityRole="header" style={{ fontSize: 17, fontWeight: '800', color: th.text }}>{t.gsTitle} ({t.gsOnce})</Text>
      <Text style={{ color: th.textMuted }}>{t.gsIntro}</Text>
      {steps.map(([label, url], i) => (
        <Pressable key={url} accessibilityRole="link" onPress={() => void Linking.openURL(url)}>
          <Text style={{ color: th.text }}><Text style={{ fontWeight: '800' }}>{i + 1}. </Text>{label} <Text style={{ color: th.accent, fontWeight: '700' }}>{t.gsOpen}</Text></Text>
        </Pressable>
      ))}
      <View style={{ backgroundColor: th.surfaceAlt, borderRadius: 12, padding: 10, borderWidth: 1, borderColor: th.border, gap: 4 }}>
        <Text selectable style={{ color: th.text, fontFamily: 'monospace', fontSize: 12 }}>{setup.redirectUri}</Text>
        <Pressable accessibilityRole="button" accessibilityLabel={`${t.copy}: ${t.gsRedirect}`} onPress={() => void Share.share({ message: setup.redirectUri })}>
          <Text style={{ color: th.accent, fontWeight: '700' }}>{t.copy}</Text>
        </Pressable>
      </View>
      <Text style={{ color: th.text, fontWeight: '800' }}>5. {t.gsStep5}</Text>
      <Field label="Client ID" value={clientId} onChangeText={(t) => setClientId(t.trim())} autoCapitalize="none" autoCorrect={false} placeholder="…apps.googleusercontent.com" />
      <Field label="Client secret" value={secret} onChangeText={(t) => setSecret(t.trim())} autoCapitalize="none" autoCorrect={false} secureTextEntry placeholder="GOCSPX-…" />
      <Button label={busy ? t.gsChecking : t.gsSave} disabled={busy || !clientId || !secret} onPress={async () => {
        setBusy(true);
        try { await api.saveGoogleSetup(clientId, secret); Alert.alert(t.gsDone); onSaved(); } catch (e) { Alert.alert(t.gsTitle, (e as Error).message); } finally { setBusy(false); }
      }} />
    </Card>
  );
}

export default function Connections() {
  const th = useTheme();
  const t = useT();
  const [cons, setCons] = useState<ConnectorInfo[]>([]);
  const [conns, setConns] = useState<Connection[]>([]);
  const [setup, setSetup] = useState<GoogleSetup | null>(null);
  const [showSetup, setShowSetup] = useState(false);
  const [busy, setBusy] = useState(false);
  const [vault, setVault] = useState<{ id: string; service: string; username: string }[]>([]);
  const [f, setF] = useState({ service: '', username: '', password: '' });
  const load = useCallback(async () => {
    const [a, b, v, g] = await Promise.all([api.connectors(), api.connections(), api.vaultList(), api.googleSetup().catch(() => null)]);
    setCons(a.connectors); setConns(b.connections); setVault(v.items); setSetup(g);
  }, []);
  // Reload when coming back from the Google consent screen in the browser.
  useFocusEffect(useCallback(() => { void load(); }, [load]));
  const has = (id: string) => conns.some((x) => x.connector === id);
  const google = cons.filter((c) => c.group === 'google');
  const missingGoogle = google.filter((g) => !has(g.id));
  const googleAvailable = google.some((g) => g.available);

  const quickGoogle = async () => {
    setBusy(true);
    try {
      const r = await api.quickConnect('google', missingGoogle.map((g) => g.id));
      if (r.authorizeUrl) await Linking.openURL(r.authorizeUrl);
      void load();
    } catch (e) { Alert.alert(t.connections, (e as Error).message); } finally { setBusy(false); }
  };

  return (
    <Screen lead={t.connectionsLead}>
      <Card>
        <Text accessibilityRole="header" style={{ fontSize: 17, fontWeight: '800', color: th.text }}>✉️📅📁 Google</Text>
        <Text style={{ color: th.textMuted }}>{t.googleOneSignIn}</Text>
        {missingGoogle.length === 0 && google.length > 0 ? <Chip label={`✓ ${t.connected}`} tone="ok" />
          : googleAvailable ? <Button label={busy ? t.openingGoogle : t.connectWithGoogle} disabled={busy} onPress={() => void quickGoogle()} />
          : <Button label={showSetup ? t.hideSetupGuide : t.setUpGoogle} kind="secondary" onPress={() => setShowSetup(!showSetup)} />}
      </Card>
      {showSetup && setup && !googleAvailable && <GoogleSetupCard setup={setup} onSaved={() => { setShowSetup(false); void load(); }} />}
      <Text accessibilityRole="header" style={{ fontSize: 18, fontWeight: '800', color: th.text, marginTop: 8 }}>{t.yourApps}</Text>
      {cons.map((c) => <ConnectorCard key={c.id} c={c} conn={conns.find((x) => x.connector === c.id)} reload={() => void load()} />)}
      <Card>
        <Text accessibilityRole="header" style={{ fontSize: 17, fontWeight: '800', color: th.text }}>{t.savedLogins}</Text>
        <Text style={{ color: th.textMuted }}>{t.savedLoginsBody}</Text>
        {vault.map((i) => <Text key={i.id} style={{ color: th.text }}>🔒 {i.service} · {i.username}</Text>)}
        <Field label={t.website} value={f.service} onChangeText={(service) => setF({ ...f, service })} autoCapitalize="none" />
        <Field label={t.usernameOrEmail} value={f.username} onChangeText={(username) => setF({ ...f, username })} autoCapitalize="none" />
        <Field label={t.password} value={f.password} onChangeText={(password) => setF({ ...f, password })} secureTextEntry />
        <Button label={t.saveLogin} disabled={!f.service || !f.username || !f.password} onPress={async () => { await api.vaultPut(f.service, f.username, f.password); setF({ service: '', username: '', password: '' }); void load(); }} />
      </Card>
    </Screen>
  );
}
