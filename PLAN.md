# PLAN: personal agent app (working title in `packages/core/src/brand.ts`)

This is a personal-use app that behaves like a personal AI agent. It is **not** Meta software and does not use Meta
infrastructure. The only Meta service it uses is the public, documented Model API (`https://api.meta.ai/v1`).

## 0. API verification (done 2026-11-18)

- Docs read: overview, quickstart, muse-spark, authentication, models, reasoning, tool-calling, search-grounding,
  speech-to-text, voice API reference, protocols/responses, pricing-rate-limits, computer-use, error-handling.
- Test call: `POST /v1/responses` with `muse-spark-1.3`, `include: ["reasoning.encrypted_content"]` → `completed`,
  output `[reasoning(encrypted), message("pong")]`. `GET /v1/models` lists `muse-spark-1.3`, `muse-spark-1.1`,
  `muse-voice-transcribe-1.0`, `muse-wonder-1.0`, `muse-ember-1.0`, and others.
- Facts confirmed by the docs and used in the code:
  - Responses API: stateless replay with `store:false` + `include:["reasoning.encrypted_content"]`. Replayed reasoning
    items need `summary: []`. You can't combine this with `previous_response_id`. Assistant text before a
    `function_call` must be replayed with `phase:"commentary"`.
  - `tool_choice` supports only `"auto"`. Parallel tool calls are on by default. Arguments stream as
    `response.function_call_arguments.delta/done`.
  - Built-in `web_search` tool, with `url_citation` annotations.
  - `truncation:"auto"` is rejected, so context compaction is our job (we drop old reasoning items, keep whole turns).
  - Rate limits for muse-spark-1.3: 3,000 RPM / 4M TPM per team. The code retries 429/5xx with exponential backoff
    and jitter, and respects `Retry-After`.
  - STT: `muse-voice-transcribe-1.0`, as file (`POST /v1/asr/transcribe`, WAV 16/24 kHz) or realtime
    (`wss://api.meta.ai/v1/asr/realtime`, PCM16 24 kHz, auth in the handshake frame).
  - **No TTS endpoint and no embeddings endpoint** exist in the Model API (see §4).
  - Availability "can vary by country" (Geographic Use Policy). The call worked from this environment. If it is
    blocked where you run it, switch providers with env vars only (`LLM_BASE_URL`, `LLM_PROVIDER`, `LLM_MODEL`).

## 1. Architecture

```
apps/web        Next.js (App Router) + PWA (manifest, service worker, Web Push). Desktop/web client.
apps/mobile     Expo (expo-router). iOS + Android. Same screens, same @muse/core client.
packages/core   brand.ts, avatar config + state machine + vector geometry, zod schemas/types, API client, i18n
packages/tokens design tokens (cream palette, dark mode, radii 20–28, spacing, motion)
packages/llm    LLMProvider interface + providers: `responses` (Meta default), `chat` (any OpenAI-compatible),
                `scripted` (deterministic tests/e2e). EmbeddingProvider. Retry/backoff.
packages/db     Postgres pool, SQL migrations (pgvector), repositories, append-only audit
services/api    Fastify: auth, age gate, chat + SSE, approvals, audit, memory, connections (OAuth), vault,
                settings, GDPR export/delete, push registration, voice proxy, internal action executor
services/agent  BullMQ workers: orchestrator turn loop, subagents, durable tasks, memory jobs, proactive job,
                sandbox manager
services/sentinel  Separate process, separate credentials (own signing key, own model key var, own DB role):
                policy engine + LLM review → allow/deny/ask, Ed25519-signed decisions; egress HTTP(S) proxy
                that is the ONLY network route out of the sandboxes
services/sandbox   Docker image: Playwright Chromium + small control server (per-user container)
```

Data flow for one turn: client → `POST /v1/chat` → API stores the message and enqueues `turn` → agent worker loads
context (history, memories, persona, connections) → `LLMProvider.respond` (streamed). Text deltas go out over Redis
pub/sub → API SSE → client. Tool calls run in parallel. Every tool call, plan step and decision is appended to
`audit_events`.

### Sensitive actions (cannot be bypassed)
1. A tool that has external effects (send/draft email, create event, purchase, form submit, login) builds an
   `ActionRequest {class, connector, payload, provenance, taint}`.
2. The agent sends it to the Sentinel (`POST /authorize`). The Sentinel runs the deterministic policy (scopes,
   allowlists, class rules, taint/exfiltration checks), then an LLM review that compares the action with the user's
   trusted request. It returns `allow | deny | ask` plus an Ed25519 signature over `hash(action)`.
3. The agent never holds connector tokens, vault keys or payment credentials. It can only ask the **API executor**
   to run an action. The executor checks the Sentinel signature. For `ask`, it also requires an `approvals` row that
   the user approved through an authenticated session, with the same payload hash. If the user edited the payload,
   it goes back through the Sentinel.
4. `spend` and `send` always require the user, even when the policy would allow them.
5. Sandbox browsers run on an `internal` Docker network. Their only route out is the Sentinel egress proxy, which
   blocks private IP ranges and denylisted domains and logs every host.

### Prompt-injection defence
- All web, email, document and search content is wrapped as `<untrusted source=… id=…>` data, with delimiters
  escaped. The system prompt says it is data, never instructions.
- Taint tracking: once untrusted content enters a run, every action that run proposes is marked `tainted` with
  provenance. Tainted sensitive actions are never auto-allowed. Recipients or domains that first appeared only in
  untrusted content trigger an exfiltration flag (deny, or ask with a red warning).
- Tests: malicious page fixtures and malicious emails, with a scripted model that "falls for" them. The tests assert
  that nothing leaves and that the approval or denial is in the audit log. There is also an optional live-model test.

## 2. Milestones (vertical slices, each committed with tests)
a. Chat + streaming + avatar · b. tool loop + audit log · c. Sentinel + approvals · d. sandbox browser agent ·
e. connectors + vault + payments stub · f. background jobs + push · g. memory + proactive · h. voice ·
i. customization polish + mobile.

## 3. Risks
- Model API region policy may block EU use. Mitigation: the provider is switchable by env only.
- Real Google OAuth needs your own Google Cloud OAuth client (consent screen, test users). Mitigation: a full
  implementation, plus a clearly labelled local **Demo Mail/Calendar** connector so every flow is testable offline.
- Push to iOS/Android needs Expo/FCM/APNs credentials. Mitigation: Web Push (VAPID, self-hosted) plus an in-app
  notification center. Expo push is wired in and only needs the project credentials.
- Mobile can't be run in this build container (no simulator). Mitigation: type-checked, unit-tested and
  bundle-exported. Maestro flows are included for you to run locally.
- Prompt injection is not "solved" (Meta says the same). Defence in depth only.

## 4. Not replicable, and the honest alternative used instead
| Original | Here |
|---|---|
| Muse Secure VM (per-user cloud VM) | Per-user Docker container (Playwright Chromium, no host mounts, cap-drop ALL, read-only rootfs, mem/cpu/pids limits, internal network). A container is weaker isolation than a VM: use gVisor (`runsc`) as the Docker runtime if available (`SANDBOX_RUNTIME=runsc`). |
| Sentinel on the same VM, separated at the system level | Separate process/container with its own keys and DB role. The egress proxy enforces network policy. |
| Link by Stripe agent wallet + purchase protection | `PaymentProvider` interface. The default `virtual-card-stub` issues fake single-use test cards. A `stripe-test` provider uses Stripe **test mode** only. No real money is possible in dev. |
| 1Password integration | Built-in vault (libsodium secretbox, envelope encryption, master key from env/KMS). The model never sees secrets. |
| Muse Confidential VM (user-held key) | Not implemented. The vault's KEK is server-side. Documented. |
| WhatsApp channel, AI glasses, "Spaces" | Out of scope. |
| Server-side TTS | Model API has none. Default is local neural TTS (Kokoro-82M via kokoro-js, inside the API), falling back to the best ranked on-device voice. Optional `TTS_PROVIDER=openai-compatible` or `device`. |
| Embeddings | Model API has none. `EMBEDDINGS_PROVIDER=hash` (local feature-hashing vectors in pgvector, plus Postgres full-text search hybrid) by default. Any OpenAI-compatible embeddings endpoint is configurable. |
| Mascot "Jolly" artwork | An **original** stylised plush character (vector, drawn here, not traced from Meta art). If you drop your own artwork into `assets/avatar/`, it is used instead (`AVATAR_ASSET` in `packages/core/src/avatar/config.ts`). |
| Computer-use (pixel) browsing | DOM/accessibility-snapshot browsing (more robust, cheaper, and works with muse-spark-1.3). |

## 5. EU / privacy
Age gate (18+; only birth year and a verification timestamp are stored), AI disclosure on every screen, training/data
opt-out (switches to Standard-mode model IDs; Contributor-mode IDs are never used), data export (JSON), delete
everything, EU-region config (`DATA_REGION=eu`, compose runs everything locally), data minimisation, and
PRIVACY.md.

## 6. Status (all slices built)
| Slice | State | Verified by |
|---|---|---|
| a. chat + streaming + avatar | done | web e2e, live run against muse-spark-1.3 |
| b. tool loop + audit log | done | full-stack tests (parallel tool calls + parallel subagents), hash-chain tests |
| c. Sentinel + approvals | done | policy/integration tests, executor signature tests, live run (approve → sent) |
| d. sandbox browser agent | done | Chromium tests (grants, password fields, SSRF via egress proxy) |
| e. connectors + vault + payments | done | API tests (scopes, revoke, encrypted vault, test-mode payments) |
| f. background jobs + push | done | durable delayed jobs survive client close (e2e waits 70 s with no client), Web Push + Expo push wiring |
| g. memory + proactive | done | extraction / forget tests; reflection + proactive jobs (scheduled) |
| h. voice | done | realtime STT proxy + file STT (Meta), natural local TTS (Kokoro) with lip-sync, interactive voice mode |
| i. customisation + mobile | done | avatar customiser (web + mobile), Expo app type-checks and bundles for Android |

Deviations and what could not be verified here:
- Avatar is rendered as an original SVG vector character (shared model for web and react-native-svg), not Rive/Lottie:
  `.riv`/Lottie files need authoring tools. A user-supplied image can be swapped in via `AVATAR_ASSET`.
- Mobile ran only as a type-check, unit tests and an Android bundle export. Maestro flows are included but not run (no emulator here).
- `docker compose build` could not complete in this build environment (its Docker builds have no DNS for Debian
  mirrors). Services were verified by running them directly against Dockerised Postgres + Redis.
- Real Google OAuth needs your own OAuth client. It is implemented, but here it was tested only through unit paths and the Demo connectors.
