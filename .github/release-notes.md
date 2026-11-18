## Free Muse v0.1.1

A bug-fix release for voice calls.

### Fixed

- **Voice calls now answer when you pause.** In a room with some background noise (or with the mic's automatic gain turned up), the call could stay on *Listening* and keep recording everything you said. The voice detector now keeps learning the background noise all the time, measures loudness more steadily, and always ends your turn after a short pause (and after 30 s at most).
- Talking over the assistant to interrupt it no longer starts a second, duplicate recording.

### Downloads

| Platform | File | Notes |
|---|---|---|
| macOS (Intel + Apple Silicon) | `FreeMuse-0.1.1-mac-universal.dmg` | Not notarised: the first time, right-click the app → **Open**, or run `xattr -cr "/Applications/Free Muse.app"`. |
| Windows 10/11 | `FreeMuse-0.1.1-win-x64.exe` (installer), `-arm64.exe`, `FreeMuse-0.1.1-win-portable.exe` | Not code-signed: SmartScreen may warn, choose **More info → Run anyway**. |
| Linux | `.AppImage` (x64, arm64), `.deb` (x64, arm64), `.tar.gz` | AppImage: `chmod +x` and run. |
| Android 8+ | `FreeMuse-0.1.1-android.apk` | Allow "install unknown apps" for your browser or file manager. |
| iOS / iPadOS | `FreeMuse-0.1.1-ios-unsigned.ipa` | Unsigned: install with AltStore or Sideloadly (they sign it with your Apple ID), or re-sign it with your developer account. |

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
