## Free Muse v0.1.4

A fix for voice input in the macOS desktop app.

### Fixed

- **macOS: the microphone permission is now kept.** The Mac app wasn't code-signed, so macOS never stored your "Allow": it kept asking and voice input stayed blocked. The app is now ad-hoc signed with the microphone entitlement.
- **macOS: clearer help when the microphone is off.** If microphone access is turned off for Free Muse, the app offers to open System Settings → Privacy & Security → Microphone instead of failing silently.

### Upgrading on macOS

Clear the old permission entry once, then allow the microphone when asked:

```bash
tccutil reset Microphone local.personal.freemuse
```

The app is ad-hoc signed (not with an Apple Developer ID), so macOS asks again once after each update.

### Downloads

| Platform | File | Notes |
|---|---|---|
| macOS (Intel + Apple Silicon) | `FreeMuse-0.1.4-mac-universal.dmg` | Not notarised: the first time, right-click the app → **Open**, or run `xattr -cr "/Applications/Free Muse.app"`. |
| Windows 10/11 | `FreeMuse-0.1.4-win-x64.exe` (installer), `-arm64.exe`, `FreeMuse-0.1.4-win-portable.exe` | Not code-signed: SmartScreen may warn, choose **More info → Run anyway**. |
| Linux | `.AppImage` (x64, arm64), `.deb` (x64, arm64), `.tar.gz` | AppImage: `chmod +x` and run. |
| Android 8+ | `FreeMuse-0.1.4-android.apk` | Allow "install unknown apps" for your browser or file manager. |
| iOS / iPadOS | `FreeMuse-0.1.4-ios-unsigned.ipa` | Unsigned: install with AltStore or Sideloadly (they sign it with your Apple ID), or re-sign it with your developer account. |

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
