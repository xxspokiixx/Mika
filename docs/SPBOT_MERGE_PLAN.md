# SPbot — Merge Plan: OpenMausBot → Mika

**Status:** Draft v1.0 · 2026-11-01
**Goal:** Merge OpenMausBot (TypeScript agent-team chat platform) into Mika (Android/Kotlin agent app) and rebrand the combined product as **SPbot**.

---

## 1. Executive Summary

OpenMausBot is a local-first "team of AI agents in a chat app": a React/Electron frontend, a Node 24 harness server on `127.0.0.1:8799`, CLI-based agent drivers (Claude/Codex/Grok), approval cards, computer control, skills, MCP, routines, voice, and team sync.

Mika is an Android-first Kotlin agent app with unique on-device capabilities: knowledge indexing (RAG), a sandbox runtime, an accessibility service, and ML Kit OCR.

**Merge strategy (decided):** Hybrid.

- **Reuse OpenMausBot's harness server as the SPbot engine** (TypeScript, rebranded). It is 400+ modules of battle-tested runtime; rewriting it in Kotlin is months of work with high regression risk.
- **Mika's Android app becomes SPbot's official mobile client** (native Compose UI talking HTTP + SSE to the harness), replacing the deleted `openmausbot-core` Kotlin module (source was never in git; abandoned).
- **Mika's Android capabilities become agent tools** — the accessibility service, OCR, and knowledge index are exposed to the harness as a new tool surface, which is the feature neither project has alone: *desktop-grade agents with Android hands*.

Everything else (skills, MCP, routines, TTS, teams) is either reused from the harness or added natively in Kotlin where it must run on-device.

---

## 2. Source Inventory

### 2.1 What OpenMausBot gives us (verified by inspection)

| Area | Location | Notes |
|---|---|---|
| Harness server + API + SSE | `server/index.ts`, `server/routes/table.ts` | ~1119 files, port 8799, webhook 8800 |
| Agent drivers | `server/drivers/` | claude, codex, grok CLIs, ACP, OpenAI-compat; small SPI in `server/contracts.ts` |
| Approval / permission broker | `server/auto-approve.ts`, `shared/approval-mode.ts`, `shared/live-approval.ts` | Cards, allow-lists, safety floor |
| Computer control | `server/computer-*.ts`, `server/local-computer.ts`, `server/vps-computer.ts`, `server/container-computer.ts` | Cloud (Boat), Local VM, host (Cua), browser |
| Skills | `server/skills.ts`, `server/skill-*.ts`, `skills/*/manifest.json` | `manifest.json` + `SKILL.md`, staged writes, review, undo |
| MCP | `server/mcp-*.ts`, `routes/mcp-servers.ts`, `scripts/mcp-server.ts` | Registry, OAuth, custom servers, outbound control-plane server |
| Routines / triggers / webhooks | `server/routines.ts`, `server/webhook-*.ts`, `shared/routine-*.ts` | Cron, webhooks, app events, run cards |
| Voice / TTS / calls | `server/tts/`, `server/live-call*.ts`, `electron/speech.mjs` | ElevenLabs, Fish, xAI, Mac voices, Chatterbox |
| Memory | `server/memory-*.ts`, `server/workspace.ts`, `server/team-memory.ts` | Per-bot memory files, journal, team memory |
| Store / wire types | `server/store.ts`, `shared/wire.ts`, `src/state/store.tsx` | Canonical reducer + action vocabulary |
| Desktop shells | `electron/` (200+ files) | macOS/Windows/Linux, updater, pairing |
| Companion / phone pairing | `companion/src/*`, `shared/pairing-link.ts`, `server/phone-secret.ts` | mDNS, tunnels, QR pairing |
| Data dashboards | `server/data/*` | DuckDB + Vega, published pages |
| Teams / org / cloud | `server/team-*.ts`, `server/cloud-*.ts`, `server/host/*` | Optional; defer |

**License:** Apache-2.0 (keep NOTICE/attribution; exclude `enterprise/` — source-available, separate license). No token/crypto affiliation text must be preserved.

### 2.2 What Mika keeps (existing, must not break)

- `:core` Kotlin/JVM: knowledge indexing, sandbox runtime, OAuth, protobuf models
- `:app` Android/Compose: UI, accessibility service, ML Kit OCR
- Builds clean; installed on device R52RC08JS2E
- `openmausbot-core/` — deleted source; only build artifacts remain (recovered SQLDelight schema: `bots`, `threads`, `messages`, `skills`, `settings`). This module is **dropped**; its schema informs §4.1.

---

## 3. Target Architecture

```
SPbot
├── engine/                     (from OpenMausBot, TypeScript, rebranded "spbot-engine")
│   ├── server/                 harness: drivers, routes, SSE, approvals, routines
│   ├── shared/                 wire types (single source of truth)
│   └── skills/                 bundled skills (manifest.json + SKILL.md)
├── android/                    (from Mika)
│   ├── :core                   Kotlin/JVM: + engine client, tool bridge, SPbot models
│   └── :app                    Compose UI: chat, roster, approvals, settings
├── desktop/                    (from OpenMausBot electron/, rebranded) — phase 6
└── docs/, deploy/, cloudflare/ (as needed; composio broker worker)
```

**Communication contract:** the Android app is a pure client — typed HTTP commands + one SSE event stream, exactly like OpenMausBot's own React app (`src/state/api.ts` + `shared/wire.ts`). Zero client-side transports in Kotlin.

**New integration point (the merge's centerpiece):** an **Android tool bridge** — the engine talks *to* the phone the same way it talks to a computer driver.

---

## 4. Data Model

### 4.1 Engine side (unchanged from OpenMausBot)

File/NDJSON stores under `~/.spbot` (renamed from `~/.openmausbot`): `config.json`, `sessions.json`, thread logs, memory files, skills dir, routines, logins. No migration needed except the rename in `server/config.ts` (`DATA_DIR`) + first-run import of an existing `~/.openmausbot` if present.

### 4.2 Android side (new SQLDelight schema, `:core`)

Derived from the recovered schema, extended for client-side needs:

```sql
CREATE TABLE bots (
  id TEXT NOT NULL PRIMARY KEY,
  name TEXT NOT NULL, avatar TEXT, instructions TEXT,
  model TEXT, color TEXT, section TEXT,
  pinned INTEGER NOT NULL DEFAULT 0, hidden INTEGER NOT NULL DEFAULT 0,
  unread INTEGER NOT NULL DEFAULT 0,
  created_at INTEGER NOT NULL, updated_at INTEGER NOT NULL
);
CREATE TABLE threads (
  id TEXT NOT NULL PRIMARY KEY,
  bot_id TEXT NOT NULL REFERENCES bots(id) ON DELETE CASCADE,
  title TEXT, kind TEXT NOT NULL DEFAULT 'dm',   -- dm | group | task
  created_at INTEGER NOT NULL, updated_at INTEGER NOT NULL
);
CREATE TABLE messages (
  id TEXT NOT NULL PRIMARY KEY,
  thread_id TEXT NOT NULL REFERENCES threads(id) ON DELETE CASCADE,
  role TEXT NOT NULL,                            -- user | bot | system | tool
  kind TEXT NOT NULL DEFAULT 'text',             -- text|options|activity|screen|tool|card…
  content TEXT NOT NULL,
  metadata TEXT,                                 -- JSON: cards, attachments, tool I/O
  send_id TEXT, turn_id TEXT,
  created_at INTEGER NOT NULL
);
CREATE TABLE cards (                             -- pending approvals/questions, durable
  message_id TEXT PRIMARY KEY REFERENCES messages(id),
  thread_id TEXT NOT NULL, state TEXT NOT NULL,  -- pending|answered|dismissed|expired
  payload TEXT NOT NULL
);
CREATE TABLE outbox (                            -- offline sends, retried on reconnect
  id TEXT PRIMARY KEY, thread_id TEXT NOT NULL, text TEXT NOT NULL,
  send_id TEXT NOT NULL UNIQUE, created_at INTEGER NOT NULL
);
CREATE INDEX idx_messages_thread ON messages(thread_id, created_at);
CREATE INDEX idx_threads_bot ON threads(bot_id, updated_at);
```

The server is source of truth; this schema is a **cache + outbox** for offline UX, hydrated by snapshot + SSE.

---

## 5. Feature-by-Feature Implementation Plan

> Format per feature: **What / Engine side / Android side / Contract / Risks / Test plan / Effort**
> Effort: S = days, M = 1–2 weeks, L = multi-week.

### F1. Harness embedding + pairing (Foundation)

- **What:** SPbot engine runs on the user's PC (or a VPS); the phone pairs and becomes a client.
- **Engine side:** Reuse `openmausbot pair` flow (`server/pair-cli.ts`, `shared/pairing-link.ts`, `server/phone-secret.ts`, companion mDNS). Rename data dir/binary to `spbot`. No protocol changes.
- **Android side:** New `:core` `EngineClient` (Ktor): base-URL management, loopback detection, token auth (`request-auth.ts` semantics), WebSocket/SSE reader with reconnect + replay (`server/host/sse-replay.ts` gives us `Last-Event-ID` semantics). Pairing screen: QR scan (`zxing`), manual URL+code entry.
- **Contract:** `GET /api/health`, `POST /api/pair`, `GET /api/stream` (SSE), all frames typed by `shared/wire.ts` → generate Kotlin models with `kotlinx.serialization` (hand-write one `Wire.kt` sealed hierarchy; ~40 frame types, mechanical).
- **Risks:** Android background networking limits → use a foreground service while a turn is active; battery-doze tolerable because turns are user-initiated. TLS only outside LAN.
- **Tests:** unit-test SSE parser against recorded `wire.test.ts` fixtures; integration test against a local engine fixture (`server/verification-fixture.e2e.test.ts` pattern).
- **Effort:** M.

### F2. Bot roster + chat (MVP UI)

- **What:** Telegram-style roster; per-bot chat with streaming replies, tool activity chips, threads/tasks.
- **Engine side:** none (reuse `routes/bots-create.ts`, `bot-messages.ts`, `threads.ts`, `store.ts`).
- **Android side:** Compose screens: `RosterScreen` (pinned/sections, unread dots, avatars), `ChatScreen` (paged history via `pageSize`/`slimMessage` semantics, optimistic sends with `sendId`, branch switching via `parentId`/`activeLeafId`), `BotSettingsSheet`. Repository layer maps frames → SQLDelight cache → StateFlow.
- **Contract:** mirror `src/state/store.tsx` action vocabulary; the reducer lives in Kotlin (`SpbotReducer.kt`) with the same frame-ordering rules (monotonic `updatedAt`, transcript-generation guard for scrollback pages).
- **Risks:** message-tree branching complexity — implement linear-first, ship `activeLeafId` support in phase 2.
- **Tests:** reducer unit tests ported from `store.test.ts` cases that matter client-side; Compose UI tests for composer/send/interrupt.
- **Effort:** L (core of the app).

### F3. Approvals & permission cards

- **What:** Shell commands, file edits, questions surface as inline cards — Allow/Deny/answer; always-allow patterns.
- **Engine side:** none (broker already emits `options` cards with `requestId`, `commandAllowlist`, `approvalScope`).
- **Android side:** `ApprovalCard` composable (Allow / Deny / Edit-answer / Always-allow chip); head-of-line notification with actions; answers POST like `answerResponse` in `src/lib/card-answer.ts`. Cards persist in `cards` table so a kill/restart never loses a pending decision.
- **Contract:** `decideRequest` action semantics incl. `reviewedSha256` for skill writes (F5).
- **Risks:** unattended-approval expiry — surface `expired`/`held` states verbatim from wire.
- **Tests:** fake harness fixture driving card lifecycle; notification-action E2E on device.
- **Effort:** M.

### F4. Android hands — accessibility + OCR + knowledge as agent tools (the merge win)

- **What:** Bots can see and operate the phone: read screens, tap/type via the accessibility service, OCR any screen, and query Mika's knowledge index. Desktop agents (claude/codex CLIs) gain a new tool surface.
- **Engine side:** New driver-agnostic tool mount, modeled on `harness-mcp-proxy.ts`: a `phone-mcp` server the engine starts per paired device, exposing tools:
  - `phone_screenshot` → returns image (Mika captures; ML Kit OCR text layer included as `.tool` output, mirroring `mcp-tool-images.ts` handling)
  - `phone_screen_tree` → accessibility node tree (stable ids, not coordinates — same principle as `create-verification-skill` SKILL.md §Drive)
  - `phone_tap / phone_text / phone_gesture / phone_back / phone_home` → accessibility dispatch (guarded by `command-allowlist`-style consent + F3 approval cards; sensitive fields masked like `redact.ts`)
  - `phone_app_launch(intent)`, `phone_notifications_read` (user-approved)
  - `knowledge_query(query, k)` / `knowledge_ingest(path)` → Mika `:core` index over shared folder
- **Android side:** New `:core` module `toolbridge`: foreground `ToolBridgeService` holding an authenticated reverse connection (phone → engine, like `companion/src/control.ts` + `viewer-relay.ts`), translating MCP-ish JSON calls to AccessibilityService actions and `ImageReader` frames. Consent model: per-tool toggles + every call emits a notification chip (silent-log, not spam) and can be gated to Ask.
- **Contract:** JSON-RPC over the existing SSE/WS device link (`shared/device-*` types); frame rate capped (1–2 fps screenshots) like `screen-frame-gate.ts` dedupe.
- **Risks:** Android 13+ accessibility restrictions; DOZE; user privacy — no screenshot storage server-side beyond turn evidence retention already used for `screen` messages; MASK passwords via `phone-secret.ts` precedent (secrets submitted, never shown to the bot).
- **Tests:** instrumented tests on device R52RC08JS2E; golden node-tree fixtures; fuzz the bridge parser.
- **Effort:** L (highest value, highest care).

### F5. Skills system

- **What:** SKILL.md + manifest skills, install/enable/disable, review + Undo, sharing.
- **Engine side:** reuse `server/skills.ts` (staged writes, `scanSkillText`, undo) and the two bundled skills (`create-verification-skill`, `data-dashboards`, `phone-harness` — the last one is *directly relevant*, inspect and extend it for the Android bridge).
- **Android side:** Skills list UI (enable toggles), skill request cards reuse F3 with `reviewedSha256`; "Learn" flow calling `skill-learn.ts` endpoints.
- **Contract:** unchanged; Android is a viewer/approver.
- **Tests:** port `skill-review.test.ts` cases to API-level integration tests.
- **Effort:** M (mostly UI).

### F6. MCP servers + engine-as-MCP control plane

- **What:** Users add custom MCP tool servers; external clients (Claude Desktop, Cursor) can drive SPbot via its stdio MCP server.
- **Engine side:** reuse `server/mcp-registry.ts`, `mcp-oauth.ts`, `scripts/mcp-server.ts`. Config route already exists (`routes/mcp-servers.ts`).
- **Android side:** settings screen listing servers + health (`mcp-probe.ts` endpoint), OAuth callback via Custom Tabs redirect to loopback.
- **Risks:** OAuth redirect on Android needs an app link; keep server-side callback as primary (browser flow on PC), phone shows status only.
- **Effort:** S–M.

### F7. Connected apps (Composio)

- **What:** OAuth marketplace for Gmail/Slack/GitHub/etc.
- **Engine side:** reuse `server/composio.ts` + optional `cloudflare/composio-broker` worker (deploy or point to self-hosted).
- **Android side:** marketplace list + connect buttons (server returns auth URLs → open browser), connector cards in chat reuse F3.
- **Effort:** M (UI + one worker deploy).

### F8. Routines, schedules, webhooks, app events

- **What:** "every weekday at 9, summarize my inbox" + webhook triggers + run history cards.
- **Engine side:** reuse entirely (`routines.ts`, `webhook-ingress.ts`, `routine-*`).
- **Android side:** Triggers screen (calendar + list, run cards), notifications on run completion. **On-device triggers** (new, Mika-flavored): `phone_event` triggers — device-local events (app installed, battery low, screen unlocked, geofence via existing Mika permissions) delivered to the engine as app-events, reusing `shared/app-triggers.ts` shape so Composio and phone events share one card UI.
- **Tests:** engine e2e already exists; add Android WorkManager scheduling tests.
- **Effort:** M.

### F9. Voice: TTS replies + live calls

- **What:** Bot reads replies aloud; push-to-talk call mode.
- **Engine side:** reuse `server/tts/` (ElevenLabs/Fish/xAI/Chatterbox) and `live-call*`.
- **Android side:** playback via `Media3`; mic capture → engine STT path (or on-device `SpeechRecognizer` sent as text, simpler first). Autoplay toggle per bot (`speakReplies` already on wire).
- **Risks:** background audio → foreground service with notification, like F4.
- **Effort:** M.

### F10. Memory

- **What:** Per-bot memory files, journaling, team memory.
- **Engine side:** reuse (`memory-*`, `workspace.ts`).
- **Android side:** Memory tab in bot settings (view/edit files via existing routes), plus **knowledge bridge**: Mika's indexed corpus appears as an additional memory surface (read-only tool from F4), clearly labeled as index vs. curated memory.
- **Effort:** S.

### F11. Computer control surfaces

- **What:** Cloud desktop, Local VM, host control, browser; live screen preview panel.
- **Engine side:** reuse. Desktop-host control stays PC-side (Cua driver).
- **Android side:** Computer panel = read-only live preview (frames already stream via `computer-frames.ts`), "Open desktop" deep-links to browser noVNC viewer (`routes/desktop-viewer.ts`). Phone-side *control* of the PC is out of scope v1 (input latency + trust surface); F4 gives phone-as-target instead.
- **Effort:** S.

### F12. Teams / cloud sync / org library

- **What:** Multi-person workspaces, cloud homes, lending, backups.
- **Decision:** **Defer to Phase 6+.** Single-user local-first for SPbot v1; the engine's multi-user code ships dormant. Keeps security review tractable on mobile.
- **Effort:** deferred.

### F13. Rebranding checklist (OpenMausBot → SPbot)

- [ ] `package.json` name/description/bin (`om-*` → `sp-*`), repo URLs, desktopName
- [ ] `DATA_DIR` `~/.openmausbot` → `~/.spbot` (with one-time migration copy; flag `--data-dir` override)
- [ ] Default ports: keep 8799/8800 but make configurable `SPBOT_PORT` (accept legacy `OMB_PORT` for one release)
- [ ] `android` app id, app name "SPbot", launcher icons, theme colors, mascots → new SPbot identity (drop SupaMaus mascot bodies or rename)
- [ ] i18n locale files: replace `OpenMausBot` strings; remove crypto disclaimer only if branding no longer references it (keep the no-affiliation line; it's protective)
- [ ] Updater endpoints/electron-builder publish config → new release channel
- [ ] Docs site title/domain; `docs/*` rename references
- [ ] `LICENSE`/`LICENSING.md`: keep Apache-2.0 + OpenMausBot attribution in NOTICE ("based on OpenMausBot © Milind Soni and contributors")
- [ ] Android `strings.xml`, `AndroidManifest.xml` labels; deep-link scheme `spbot://`
- [ ] Delete `openmausbot-core/` build artifacts from Mika repo; remove from `settings.gradle.kts` if still referenced

---

## 6. Phased Roadmap

| Phase | Contents | Exit criteria |
|---|---|---|
| **0** (wk 1) | Repo surgery: import engine as `engine/`, rebrand skeleton (F13), CI builds engine + Android | `pnpm test` green in `engine/`; SPbot APK installs |
| **1** (wk 2–4) | F1 + F2: pairing, SSE client, roster + chat MVP | Chat with a Claude/Codex bot from phone, survives app restart |
| **2** (wk 5–6) | F3 + F5 + F10: approvals, skills, memory UI | Full approve/answer loop; skill install with undo |
| **3** (wk 7–10) | F4: Android tool bridge (accessibility, OCR, knowledge) | Agent completes a real on-device task: "open X, read the screen, save a note into Mika knowledge" |
| **4** (wk 11–12) | F6 + F7 + F8: MCP, Composio, routines/webhooks + phone events | Scheduled job runs and phones a notification |
| **5** (wk 13–14) | F9 + F11: voice, computer preview panel | Spoken replies; live preview of bot's desktop |
| **6** (later) | Desktop shell rebrand, F12 teams/cloud | Desktop installers |

---

## 7. Compatibility & Risk Register

| Risk | Mitigation |
|---|---|
| Two runtimes (Kotlin + TS) to maintain | Engine is vendored, not forked heavily: keep patches in `engine/patches/*` documented; sync upstream via git remote |
| Android background limits break SSE/turns | Foreground services for active turns + tool bridge; reconnect+replay logic (F1) makes gaps invisible |
| Security: phone exposes accessibility control | Consent per tool, approval cards for every mutating call, secret masking, no coordinate-based input (tree ids only), revocable pairing |
| Wire drift between TS and Kotlin | `shared/wire.ts` is canonical; codegen check in CI (ts → JSON schema → validate `Wire.kt` snapshot) |
| Deleted `openmausbot-core` confusion | Drop module; schema absorbed into §4.2; note in README |
| Port/branding collisions on user machines | `SPBOT_PORT` env, migration of old data dir, accept legacy env vars one release |
| Licensing | Apache-2.0 preserved; exclude `enterprise/`; NOTICE attribution |

---

## 8. Immediate Next Steps

1. **Phase 0 repo surgery** — vendor `C:\Users\xxspokiixx\orca\OpenMausBot` into `Mika/engine/` (git subtree or copy excluding `node_modules`, `dist*`, `enterprise/`), run `pnpm install && pnpm test`.
2. Execute rebrand checklist F13.
3. Scaffold `:core` `EngineClient` + `Wire.kt` (F1) and the two Compose screens (F2).
4. Prototype `toolbridge` accessibility spike on device (F4 feasibility: node-tree extraction + synthetic tap) — this de-risks the flagship feature first.
