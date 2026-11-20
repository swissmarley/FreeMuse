## Free Muse v0.1.5

The avatar Save button stays put while you scroll, and the practice mailbox is gone.

### Fixed

- **The Save button stays at the bottom of the page.** On the avatar page it used to travel with the form and sit across the card border. It now stays fixed at the bottom of the column, including above the mobile tab bar.

### Removed

- **Demo Mail and Demo Calendar.** Onboarding and Connections no longer offer “Try with demo data”. Connect Gmail, Calendar and Drive instead. The agent uses those accounts only.

### Downloads

| Platform | File | Notes |
|---|---|---|
| macOS (Intel + Apple Silicon) | `FreeMuse-0.1.5-mac-universal.dmg` | Not notarised: the first time, right-click the app → **Open**, or run `xattr -cr "/Applications/Free Muse.app"`. |
| Windows 10/11 | `FreeMuse-0.1.5-win-x64.exe` (installer), `-arm64.exe`, `FreeMuse-0.1.5-win-portable.exe` | Not code-signed: SmartScreen may warn, choose **More info → Run anyway**. |
| Linux | `.AppImage` (x64, arm64), `.deb` (x64, arm64), `.tar.gz` | AppImage: `chmod +x` and run. |
| Android 8+ | `FreeMuse-0.1.5-android.apk` | Allow "install unknown apps" for your browser or file manager. |
| iOS / iPadOS | `FreeMuse-0.1.5-ios-unsigned.ipa` | Unsigned: install with AltStore or Sideloadly (they sign it with your Apple ID), or re-sign it with your developer account. |

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
