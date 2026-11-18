import * as Linking from 'expo-linking';
import { useFocusEffect } from 'expo-router';
import { useCallback, useEffect, useState } from 'react';
import { Alert, Pressable, Share, Text, View } from 'react-native';
import type { Connection, ConnectorInfo } from '@muse/core';
import { api } from '../src/api';
import { useTheme } from '../src/theme';
import { Button, Card, Chip, Field, Screen, Toggle } from '../src/ui';

type GoogleSetup = Awaited<ReturnType<typeof api.googleSetup>>;
const ICONS: Record<string, string> = { gmail: '✉️', gcal: '📅', gdrive: '📁', demo_mail: '📨', demo_calendar: '🗓️' };

function ConnectorCard({ c, conn, reload }: { c: ConnectorInfo; conn?: Connection; reload: () => void }) {
  const th = useTheme();
  const [scopes, setScopes] = useState<string[]>(conn?.scopes ?? c.recommended ?? ['read']);
  const [open, setOpen] = useState(false);
  useEffect(() => { if (conn) setScopes(conn.scopes); }, [conn]);
  const save = async () => {
    try {
      const r = conn ? await api.updateScopes(conn.id, scopes) : await api.connect(c.id, scopes);
      if (r.authorizeUrl) await Linking.openURL(r.authorizeUrl);
      reload();
    } catch (e) { Alert.alert('Connection failed', (e as Error).message); }
  };
  return (
    <Card>
      <View style={{ flexDirection: 'row', alignItems: 'center', gap: 10 }}>
        <Text style={{ fontSize: 22 }} accessibilityElementsHidden>{ICONS[c.id] ?? '🔌'}</Text>
        <Text accessibilityRole="header" style={{ fontSize: 17, fontWeight: '800', color: th.text, flex: 1 }}>{c.name}</Text>
        {conn ? <Chip label="✓ Connected" tone="ok" /> : c.kind === 'demo' ? <Chip label="Demo data" /> : null}
      </View>
      <Text style={{ color: th.textMuted }}>{c.description}{conn?.account ? ` · ${conn.account}` : ''}</Text>
      {!conn && c.available && <Button label="Connect" disabled={!scopes.length} onPress={() => void save()} />}
      <Pressable accessibilityRole="button" accessibilityState={{ expanded: open }} onPress={() => setOpen(!open)}>
        <Text style={{ color: th.textMuted, fontWeight: '700' }}>{open ? '▾' : '▸'} {conn ? 'Permissions' : 'Customise permissions'}</Text>
      </Pressable>
      {open && (
        <>
          {c.scopes.map((sc) => <Toggle key={sc.id} label={sc.label} hint={sc.description} value={scopes.includes(sc.id)} onChange={(v) => setScopes((x) => (v ? [...x, sc.id] : x.filter((y) => y !== sc.id)))} />)}
          {conn && <Button kind="secondary" label="Save permissions" disabled={!scopes.length} onPress={() => void save()} />}
          {conn && <Button kind="ghost" label="Disconnect" onPress={async () => { await api.disconnect(conn.id); reload(); }} />}
        </>
      )}
    </Card>
  );
}

function GoogleSetupCard({ setup, onSaved }: { setup: GoogleSetup; onSaved: () => void }) {
  const th = useTheme();
  const [clientId, setClientId] = useState('');
  const [secret, setSecret] = useState('');
  const [busy, setBusy] = useState(false);
  const steps: [string, string][] = [
    ['Create a project in Google Cloud', 'https://console.cloud.google.com/projectcreate'],
    ['Turn on the Gmail, Calendar and Drive APIs', 'https://console.cloud.google.com/flows/enableapi?apiid=gmail.googleapis.com,calendar-json.googleapis.com,drive.googleapis.com'],
    ['Consent screen: External, then add yourself as a test user', 'https://console.cloud.google.com/auth/overview'],
    ['Create an OAuth client (Web application) with the redirect URI below', 'https://console.cloud.google.com/auth/clients/create'],
  ];
  return (
    <Card>
      <Text accessibilityRole="header" style={{ fontSize: 17, fontWeight: '800', color: th.text }}>Set up Google (about 2 minutes, once)</Text>
      <Text style={{ color: th.textMuted }}>Free Muse runs on your own server, so you register your own private Google app. Easiest on a computer; you can also do it here.</Text>
      {steps.map(([label, url], i) => (
        <Pressable key={url} accessibilityRole="link" onPress={() => void Linking.openURL(url)}>
          <Text style={{ color: th.text }}><Text style={{ fontWeight: '800' }}>{i + 1}. </Text>{label} <Text style={{ color: th.accent, fontWeight: '700' }}>Open ↗</Text></Text>
        </Pressable>
      ))}
      <View style={{ backgroundColor: th.surfaceAlt, borderRadius: 12, padding: 10, borderWidth: 1, borderColor: th.border, gap: 4 }}>
        <Text selectable style={{ color: th.text, fontFamily: 'monospace', fontSize: 12 }}>{setup.redirectUri}</Text>
        <Pressable accessibilityRole="button" accessibilityLabel="Share or copy the redirect URI" onPress={() => void Share.share({ message: setup.redirectUri })}>
          <Text style={{ color: th.accent, fontWeight: '700' }}>Copy / share</Text>
        </Pressable>
      </View>
      <Text style={{ color: th.text, fontWeight: '800' }}>5. Paste what Google shows you:</Text>
      <Field label="Client ID" value={clientId} onChangeText={(t) => setClientId(t.trim())} autoCapitalize="none" autoCorrect={false} placeholder="…apps.googleusercontent.com" />
      <Field label="Client secret" value={secret} onChangeText={(t) => setSecret(t.trim())} autoCapitalize="none" autoCorrect={false} secureTextEntry placeholder="GOCSPX-…" />
      <Button label={busy ? 'Checking with Google…' : 'Save & check'} disabled={busy || !clientId || !secret} onPress={async () => {
        setBusy(true);
        try { await api.saveGoogleSetup(clientId, secret); Alert.alert('Google is set up ✓', 'Now tap "Connect with Google".'); onSaved(); } catch (e) { Alert.alert('Not quite', (e as Error).message); } finally { setBusy(false); }
      }} />
    </Card>
  );
}

export default function Connections() {
  const th = useTheme();
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

  const quick = async (preset: 'demo' | 'google') => {
    setBusy(true);
    try {
      const r = await api.quickConnect(preset, preset === 'google' ? missingGoogle.map((g) => g.id) : undefined);
      if (r.authorizeUrl) await Linking.openURL(r.authorizeUrl);
      void load();
    } catch (e) { Alert.alert('Connection failed', (e as Error).message); } finally { setBusy(false); }
  };

  return (
    <Screen lead="Connect your apps in one tap. Sending, booking and paying always ask you first. Revoke any time.">
      <Card>
        <Text accessibilityRole="header" style={{ fontSize: 17, fontWeight: '800', color: th.text }}>✉️📅📁 Google</Text>
        <Text style={{ color: th.textMuted }}>Gmail, Calendar and Drive with one sign-in.</Text>
        {missingGoogle.length === 0 && google.length > 0 ? <Chip label="✓ Connected" tone="ok" />
          : googleAvailable ? <Button label={busy ? 'Opening Google…' : 'Connect with Google'} disabled={busy} onPress={() => void quick('google')} />
          : <Button label={showSetup ? 'Hide setup guide' : 'Set up Google'} kind="secondary" onPress={() => setShowSetup(!showSetup)} />}
      </Card>
      {showSetup && setup && !googleAvailable && <GoogleSetupCard setup={setup} onSaved={() => { setShowSetup(false); void load(); }} />}
      <Card>
        <Text accessibilityRole="header" style={{ fontSize: 17, fontWeight: '800', color: th.text }}>🧪 Try with demo data</Text>
        <Text style={{ color: th.textMuted }}>A sample inbox and calendar on your own server. Nothing leaves it.</Text>
        {has('demo_mail') && has('demo_calendar') ? <Chip label="✓ Connected" tone="ok" /> : <Button kind="secondary" label="Connect demo in one tap" disabled={busy} onPress={() => void quick('demo')} />}
      </Card>
      <Text accessibilityRole="header" style={{ fontSize: 18, fontWeight: '800', color: th.text, marginTop: 8 }}>Your apps</Text>
      {cons.map((c) => <ConnectorCard key={c.id} c={c} conn={conns.find((x) => x.connector === c.id)} reload={() => void load()} />)}
      <Card>
        <Text accessibilityRole="header" style={{ fontSize: 17, fontWeight: '800', color: th.text }}>🔒 Saved website logins</Text>
        <Text style={{ color: th.textMuted }}>Encrypted. The agent can use them on the matching site with your approval, but never sees the password.</Text>
        {vault.map((i) => <Text key={i.id} style={{ color: th.text }}>🔒 {i.service} · {i.username}</Text>)}
        <Field label="Website" value={f.service} onChangeText={(service) => setF({ ...f, service })} autoCapitalize="none" />
        <Field label="Username or email" value={f.username} onChangeText={(username) => setF({ ...f, username })} autoCapitalize="none" />
        <Field label="Password" value={f.password} onChangeText={(password) => setF({ ...f, password })} secureTextEntry />
        <Button label="Save login" disabled={!f.service || !f.username || !f.password} onPress={async () => { await api.vaultPut(f.service, f.username, f.password); setF({ service: '', username: '', password: '' }); void load(); }} />
      </Card>
    </Screen>
  );
}
