# Privacy notice (short)

This app is self-hosted for personal use. **You** run it and you are the data controller. This page describes what the
software stores and how to control it, with the GDPR and EU AI Act in mind.

## AI transparency (EU AI Act, Art. 50)
You are interacting with an AI agent. This is disclosed during onboarding, on every chat screen, in voice mode, and through an
`x-ai-disclosure` header on the API. The agent never claims to be human.

## Age
The app is for adults only (18+). At sign-up we check your date of birth, but we **store only your birth year** and the time
the check happened.

## What is stored, and where
Everything is stored in your own Postgres and Redis (Docker volumes on your machine or server; `DATA_REGION=eu` by default):
- your account (email, password hash, settings, avatar settings)
- chat messages and the model's encrypted reasoning items (needed to continue conversations)
- tasks, approvals, and the append-only audit trail of actions
- memories the agent learned (only from your own messages; sensitive categories are skipped unless you ask)
- connections and their scopes; OAuth tokens, saved logins and your own Google OAuth client (if you set one up in the app)
  are stored **encrypted** in the vault (envelope encryption). The agent and the model never see the plaintext.
- push subscriptions, notifications, uploaded files, demo mailbox and calendar data, test-mode purchase records
- Sentinel decisions and the hosts your sandbox browser visited

## Who receives data
- **Your model provider** (default: Meta Model API, `api.meta.ai`) receives the prompts needed to answer you and to act:
  chat context, relevant memories, and tool results. Standard-mode model IDs are used, where the provider states your
  content is not used for training. The **training opt-out is on by default**. Contributor-mode (training) models are only
  used if the operator sets `ALLOW_CONTRIBUTOR_MODE=true` **and** you switch the opt-out off. Check the provider's own terms
  and regional availability.
- **Services you connect** (e.g. Google) receive only the requests needed for actions you allow, limited to the scopes you choose.
- **Push services** (Web Push endpoints, Expo/FCM/APNs) receive notification titles and short texts.
- **Spoken replies** are synthesised on your own server by default (`TTS_PROVIDER=local`); the text is not sent anywhere.
  The voice model itself is downloaded once from Hugging Face. If the operator sets `TTS_PROVIDER=openai-compatible`, the
  text of spoken replies goes to that endpoint. Device voices may use your OS vendor's speech service.
- Nothing is sold or used for advertising. There is no analytics or telemetry.

## Your rights and controls
- **Access / portability:** Settings → *Export my data* (JSON with everything above; secrets are never exported).
- **Erasure:** Settings → *Delete everything*. This revokes OAuth tokens, removes your sandbox, and deletes every row,
  including the audit trail.
- **Rectification / forgetting:** edit or delete memories in **Memory**, or say "forget …" in chat.
- **Restriction:** disconnect any app, reduce its scopes, block websites, and switch off proactive suggestions.
- **Objection to training:** keep the training opt-out on (default).

## Data minimisation and security
Only the data needed for features is kept. Passwords use scrypt. Sessions are revocable. Logs redact secrets. Every external
side effect needs a signed Sentinel decision, plus your approval for sending, spending, calendar writes and logins. Sandbox
browsers can reach the internet only through the Sentinel proxy.

## Retention
Data is kept until you delete it (or delete your account). The operator can configure backups. If you keep backups,
remember that they also hold your data.
