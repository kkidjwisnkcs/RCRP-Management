# RCRP Management — Official Intelligence Bot

**RCRP Management** is the elite intelligence and operations bot for River City Role Play (RCRP). It is built on a **Zero-Persistence architecture** — Discord channels serve as the database. No MongoDB, no SQL, no Railway volumes required.

---

## Railway Environment Variables

Set these 6 variables in your Railway project dashboard:

| Variable | Description |
|---|---|
| `DISCORD_TOKEN` | Bot token from Discord Developer Portal |
| `CLIENT_ID` | Bot application ID from Developer Portal |
| `GUILD_ID` | Your RCRP Discord server ID |
| `ERLC_API_KEY` | ERLC Private Server API key (from in-game settings) |
| `BLOXLINK_API_KEY` | Bloxlink Server API key (from blox.link dashboard) |
| `AI_API_KEY` | NVIDIA NIM API key |

---

## Features

### Automated (no commands needed)
- **20-Second Heartbeat** — Fetches all ERLC data every 20s, saves to `#game-database` with sequential IDs (000001+).
- **Ghost-Clock** — Auto-detects staff in-game, starts/ends shifts, toggles `@On Duty Staff` role.
- **Honor System** — Auto-promotes players to `@Played RCRP - 1 Hour`, `@Played RCRP - 2 Hour`.
- **MDT Dispatch AI** — Analyzes 911/mod-calls via NVIDIA AI, posts tactical recommendations in `#mdt`.
- **Knowledge Indexer** — Indexes all rules channels every 60 seconds to provide AI context for server rules.

### Commands
| Command | Access | Description |
|---|---|---|
| `/verify` (button) | Public | Verify Roblox via Bloxlink |
| `/promote` | Management | Promote staff with optional image branding |
| `/sticky set/remove` | Management | Anchor a message to the bottom of a channel |
| `/role-system create/add-role` | Management | Create button-based role panels |
| `/internal-ask` | HR/Staff | AI-powered evidence search across game logs |
| `/announce` | Management | Post professional announcements with image support |
| `/rcrp index` | Owner | Force re-index all rules channels |
| `/rcrp status` | Owner | View bot status and ERLC cache info |
| `@RCRP Management [question]` | Public | Ask anything — AI answers using rules + your game history |

### Staff Applications
- Button-triggered application in `#staff-applications`.
- Gate check: must be verified, no active strikes.
- 5-question Discord modal.
- AI analysis for plagiarism/AI detection.
- HR reviews in `#hr-central` with Approve/Deny/Hold buttons.
- Canvas-generated stamp image posted as result.

---

## Architecture

```
Discord Channels as Database:
  #verify-database   → verify-db.json (master user file)
  #game-database     → 000001-2026-03-30-1402.json (every 20s)
  #discord-database  → app transcripts, staff logs
```

---

## AI Model

**NVIDIA NIM** — `nvidia/llama-3.1-nemotron-ultra-253b-v1`

Used for: welcome messages, application analysis, @RCRP Management Q&A, MDT dispatch, internal investigations.
