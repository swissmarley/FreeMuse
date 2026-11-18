## Free Muse v0.1.0

Your self-hosted personal AI agent, now with apps for every platform.

### What's new

- **5 languages**: English (default), Italiano, Deutsch, Français, Español. The whole app, the agent's replies and voice calls follow the language you pick (onboarding or **Settings → Language**).
- **Voice calls**: tap **📞 Call** and talk to your character like on a phone call. It rings, picks up, greets you and then it's hands-free: just talk, and it answers when you pause. Talk over it to interrupt (on phones, tap it). Mute, captions (web), speaker/earpiece (mobile) and a red hang-up button, with a call timer.
- **ElevenLabs voices**: professional, natural voices in every language. Paste your own ElevenLabs API key in **Settings → Voice** (the free plan works). The key is stored encrypted on your server and never reaches the apps.
- **Contributor mode** (opt-in, off by default): use Meta's lower-cost Contributor-mode models to save tokens, after you explicitly agree that Meta may use your content to train its AI. Turn it off any time.
- **Desktop apps** for macOS, Windows and Linux, and **mobile apps** for Android and iOS, which connect to your own Free Muse server.

### Downloads

| Platform | File | Notes |
|---|---|---|
| macOS (Intel + Apple Silicon) | `FreeMuse-0.1.0-mac-universal.dmg` | Not notarised: the first time, right-click the app → **Open**, or run `xattr -cr "/Applications/Free Muse.app"`. |
| Windows 10/11 | `FreeMuse-0.1.0-win-x64.exe` (installer), `-arm64.exe`, `FreeMuse-0.1.0-win-portable.exe` | Not code-signed: SmartScreen may warn, choose **More info → Run anyway**. |
| Linux | `.AppImage` (x64, arm64), `.deb` (x64, arm64), `.tar.gz` | AppImage: `chmod +x` and run. |
| Android 8+ | `FreeMuse-0.1.0-android.apk` | Allow "install unknown apps" for your browser or file manager. |
| iOS / iPadOS | `FreeMuse-0.1.0-ios-unsigned.ipa` | Unsigned: install with AltStore or Sideloadly (they sign it with your Apple ID), or re-sign it with your developer account. |

`SHA256SUMS.txt` lists checksums for every file.

### You need a Free Muse server

The apps are clients: your data, the agent and the security layers (Sentinel, approvals, audit log) run on **your** server.

```bash
git clone https://github.com/swissmarley/FreeMuse && cd FreeMuse
cp .env.example .env            # put your key in MODEL_API_KEY=...
docker compose up --build       # web: http://<server>:3000  ·  api: http://<server>:4000
```

- **Desktop**: enter the web address (e.g. `http://localhost:3000`). Change it later with Ctrl/⌘ + ,
- **Mobile**: enter the API address on the first screen (e.g. `http://192.168.1.20:4000`). For phones on your network, set `WEB_ORIGIN`/`API_PUBLIC_URL` to your server's LAN address or use HTTPS.
