## Free Muse v0.1.3

A fix for the hold-to-talk microphone button on the web, desktop and mobile apps.

### Fixed

- **First words no longer cut off.** Recording used to start only after the live-transcription connection opened (up to 4 s). Audio is now captured from the moment the mic opens.
- **Better accuracy in every language.** The whole recording is transcribed with your language setting; the live stream only provides the preview text while you speak.
- **The microphone no longer stays on** if you release the button while it is still opening (for example during the permission prompt).
- **No more stuck or cut-short recordings** when your finger or pointer slides off the button, a scroll gesture starts, or you long-press. The mic level meter also works again.
- **Failures are no longer silent.** If a recording can't be transcribed you now see a message, on web and mobile. Accidental taps under 250 ms are ignored.
- **Server:** a malformed message from the speech service can no longer crash the API, and audio or transcription failures return a clear error.

### Downloads

| Platform | File | Notes |
|---|---|---|
| macOS (Intel + Apple Silicon) | `FreeMuse-0.1.3-mac-universal.dmg` | Not notarised: the first time, right-click the app → **Open**, or run `xattr -cr "/Applications/Free Muse.app"`. |
| Windows 10/11 | `FreeMuse-0.1.3-win-x64.exe` (installer), `-arm64.exe`, `FreeMuse-0.1.3-win-portable.exe` | Not code-signed: SmartScreen may warn, choose **More info → Run anyway**. |
| Linux | `.AppImage` (x64, arm64), `.deb` (x64, arm64), `.tar.gz` | AppImage: `chmod +x` and run. |
| Android 8+ | `FreeMuse-0.1.3-android.apk` | Allow "install unknown apps" for your browser or file manager. |
| iOS / iPadOS | `FreeMuse-0.1.3-ios-unsigned.ipa` | Unsigned: install with AltStore or Sideloadly (they sign it with your Apple ID), or re-sign it with your developer account. |

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
