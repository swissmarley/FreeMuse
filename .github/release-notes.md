## Free Muse v0.1.2

A follow-up fix for voice calls.

### Fixed

- **The assistant no longer interrupts itself.** On the web and desktop apps, its own voice coming out of your speakers was picked up by the mic and taken for you talking over it, so it kept stopping to listen. The call now learns how loud that echo is and only lets you interrupt when you speak clearly louder than it (for at least 0.4 s).
- An interruption that turns out to have no words (noise, echo) now just goes back to listening, instead of answering "I didn't catch that".

### Downloads

| Platform | File | Notes |
|---|---|---|
| macOS (Intel + Apple Silicon) | `FreeMuse-0.1.2-mac-universal.dmg` | Not notarised: the first time, right-click the app → **Open**, or run `xattr -cr "/Applications/Free Muse.app"`. |
| Windows 10/11 | `FreeMuse-0.1.2-win-x64.exe` (installer), `-arm64.exe`, `FreeMuse-0.1.2-win-portable.exe` | Not code-signed: SmartScreen may warn, choose **More info → Run anyway**. |
| Linux | `.AppImage` (x64, arm64), `.deb` (x64, arm64), `.tar.gz` | AppImage: `chmod +x` and run. |
| Android 8+ | `FreeMuse-0.1.2-android.apk` | Allow "install unknown apps" for your browser or file manager. |
| iOS / iPadOS | `FreeMuse-0.1.2-ios-unsigned.ipa` | Unsigned: install with AltStore or Sideloadly (they sign it with your Apple ID), or re-sign it with your developer account. |

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
