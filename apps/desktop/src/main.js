/**
 * Free Muse desktop (macOS, Windows, Linux): a native window for your self-hosted Free Muse.
 * The backend (API, agent, Sentinel, database) runs on your server or with `docker compose up`; this app connects to
 * its web address, remembers it, and gives you microphone access for voice calls, notifications and a dock icon.
 */
const { app, BrowserWindow, Menu, ipcMain, session, shell, net } = require('electron');
const fs = require('node:fs');
const path = require('node:path');

const DEFAULT_SERVER = process.env.FREEMUSE_URL || 'http://localhost:3000';
const configFile = () => path.join(app.getPath('userData'), 'config.json');

function readConfig() {
  try { return JSON.parse(fs.readFileSync(configFile(), 'utf8')); } catch { return {}; }
}
function writeConfig(c) {
  fs.mkdirSync(path.dirname(configFile()), { recursive: true });
  fs.writeFileSync(configFile(), JSON.stringify(c, null, 2));
}

/** "192.168.1.20:3000" → "http://192.168.1.20:3000" */
function normalise(input) {
  let u = String(input || '').trim().replace(/\/+$/, '');
  if (u && !/^https?:\/\//i.test(u)) u = `http://${u}`;
  const parsed = new URL(u);
  if (!/^https?:$/.test(parsed.protocol)) throw new Error('Only http(s) addresses are supported');
  return parsed.origin;
}

let win = null;
let serverOrigin = null;

function openSetup(error) {
  if (!win) return;
  const q = new URLSearchParams({ server: readConfig().server || DEFAULT_SERVER, error: error || '' });
  void win.loadFile(path.join(__dirname, 'setup.html'), { search: q.toString() });
}

function openServer(origin) {
  serverOrigin = origin;
  void win.loadURL(`${origin}/`);
}

function createWindow() {
  win = new BrowserWindow({
    width: 1180,
    height: 820,
    minWidth: 380,
    minHeight: 560,
    title: 'Free Muse',
    backgroundColor: '#FBF3E6',
    icon: path.join(__dirname, '..', 'build', 'icon.png'),
    autoHideMenuBar: process.platform !== 'darwin',
    webPreferences: { preload: path.join(__dirname, 'preload.js'), contextIsolation: true, sandbox: true, nodeIntegration: false, spellcheck: true },
  });

  // Links to other sites open in the normal browser; the app window stays on your Free Muse.
  win.webContents.setWindowOpenHandler(({ url }) => {
    if (/^https?:/i.test(url)) void shell.openExternal(url);
    return { action: 'deny' };
  });
  win.webContents.on('did-fail-load', (_e, code, desc, url, isMainFrame) => {
    if (isMainFrame && serverOrigin && url.startsWith(serverOrigin) && code !== -3) openSetup(`Could not reach ${serverOrigin} (${desc}). Is Free Muse running?`);
  });

  const cfg = readConfig();
  if (cfg.server) openServer(cfg.server);
  else openSetup();
}

/** Microphone (voice calls) and notifications only for your Free Muse server. */
function setupPermissions() {
  const allowed = new Set(['media', 'notifications', 'clipboard-sanitized-write', 'audioCapture']);
  const fromServer = (url) => { try { return !!serverOrigin && new URL(url).origin === serverOrigin; } catch { return false; } };
  session.defaultSession.setPermissionRequestHandler((wc, permission, cb, details) => {
    cb(allowed.has(permission) && fromServer(details.requestingUrl || wc.getURL()) && (permission !== 'media' || (details.mediaTypes || []).every((m) => m === 'audio')));
  });
  session.defaultSession.setPermissionCheckHandler((wc, permission, origin) => allowed.has(permission) && fromServer(origin));
}

ipcMain.handle('freemuse:connect', async (_e, input) => {
  let origin;
  try { origin = normalise(input); } catch { return { ok: false, error: 'Please enter a valid address, e.g. http://localhost:3000' }; }
  try {
    const res = await net.fetch(`${origin}/onboarding`, { method: 'GET' });
    if (!res.ok) return { ok: false, error: `${origin} answered with ${res.status}` };
  } catch (e) {
    return { ok: false, error: `Could not reach ${origin}: ${e.message}` };
  }
  writeConfig({ ...readConfig(), server: origin });
  openServer(origin);
  return { ok: true };
});

function buildMenu() {
  const isMac = process.platform === 'darwin';
  const template = [
    ...(isMac ? [{ role: 'appMenu' }] : []),
    {
      label: 'Free Muse',
      submenu: [
        { label: 'Change server…', accelerator: 'CmdOrCtrl+,', click: () => openSetup() },
        { label: 'Open in browser', click: () => serverOrigin && shell.openExternal(serverOrigin) },
        { type: 'separator' },
        isMac ? { role: 'close' } : { role: 'quit' },
      ],
    },
    { role: 'editMenu' },
    {
      label: 'View',
      submenu: [{ role: 'reload' }, { role: 'forceReload' }, { role: 'toggleDevTools' }, { type: 'separator' }, { role: 'resetZoom' }, { role: 'zoomIn' }, { role: 'zoomOut' }, { type: 'separator' }, { role: 'togglefullscreen' }],
    },
    { role: 'windowMenu' },
  ];
  Menu.setApplicationMenu(Menu.buildFromTemplate(template));
}

if (!app.requestSingleInstanceLock()) {
  app.quit();
} else {
  app.on('second-instance', () => {
    if (!win) return;
    if (win.isMinimized()) win.restore();
    win.focus();
  });
  app.setAppUserModelId('local.personal.freemuse');
  app.whenReady().then(() => {
    serverOrigin = readConfig().server || null;
    setupPermissions();
    buildMenu();
    createWindow();
    app.on('activate', () => { if (BrowserWindow.getAllWindows().length === 0) createWindow(); });
  });
  app.on('window-all-closed', () => { if (process.platform !== 'darwin') app.quit(); });
}
