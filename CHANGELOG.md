# Changelog

All notable changes to Mirage are documented in this file.

## [0.3.0.0] - 2026-07-20

### Added
- **Proper ReAct agentic loop**: the attacker's own decisions and the harness's `OBSERVATION` turns accumulate as a real Thought → Action → Observation conversation instead of a flat memory blob re-rendered each turn
- **Browser tools** (`read_page` / `scroll` / `click` / `screenshot`) so the agent can drive live chat UIs, plus auto-screenshot evidence captured on confirmed wins
- **Auto-recon**: on a tab target Mirage reads the page once with no LLM call and seeds it into the agent, so the run opens by attacking instead of looking around
- Speaker-aware reply extraction (`src/targets/reply.ts`) that parses `SPEAKER:`-prefixed, multi-agent chat pages
- Reworked HTML report: verdict headline, attacks/confirmed/duration stats, severity chips, findings-first layout, and a separate recon/navigation timeline

### Changed
- **Budget counts attacks, not navigation** — `read_page`/`scroll`/`click`/`screenshot` are free recon (capped by a streak + hard step limit), so a run spends its budget on real probes
- Progress and reports read in **attacks** (not "iterations"); recon steps show as un-numbered activity
- Conversation is windowed to a stable, prompt-cacheable prefix sized from the pace profile
- JSON report renames `iterations` → `attacks` and adds a recon `activity` array

### Fixed
- Reply capture returned a bare speaker label (e.g. `USER@ECORP:`) instead of the agent's actual response on multi-agent CTF pages — now rejected and parsed correctly
- Attack counter lagged the transcript when a run was stopped mid-probe (during the goal-judge)

## [0.2.1.0] - 2026-07-17

### Fixed
- **Wrong chat composer** on multi-field pages (e.g. promptairlines.com `#flagInput` vs `#chatInput`): score chat textareas over flag, search, and auth fields
- **Page chrome scraped as the model reply** ("Chat / Under The Hood / SHARE THIS GAME…"): scope reads to the chat panel and reject site chrome
- **Tab probes that never reached the model**: fill and submit run in the page MAIN world so jQuery / `submitMessage()` see the value (isolated content scripts share DOM, not page JS)
- Clearer errors when submit is accepted but no assistant bubble appears, or when the page never accepts the send
- Agent memory note + tactic when replies look like flag-validation UI noise

### Added
- Composer scoring module (`src/targets/composer.ts`) with unit tests for chat-vs-flag ranking and chrome detection
- `mirage:prepare` / `mirage:await` content-script handshake for MAIN-world submit + isolated wait

## [0.2.0.0] - 2026-07-13

### Added
- **Pace modes** (fast / balanced / thorough) with stop-on-first-win control
- Full **attack transcript** (every probe input/output) in JSON and HTML reports
- **Strategy hints**: pivot after thrashing one attack class; enumerate before name-guessing
- **Auto-continue** when target replies look truncated (mid-JSON, open braces, cut mid-flag)
- Shared HTTP helpers with retry and clearer provider network errors
- Tests for strategy, confirmation echo-stripping, and agent early-stop

### Changed
- Agent loop runs in the **side panel** (not the service worker) for reliable LLM API access
- Default attacker models prefer speed (haiku / gpt-4o-mini / grok-4-fast)
- Host permissions allow any `http(s)` page under test (required for tab injection)
- Content script waits for real assistant replies and strips user-bubble echoes
- Goal-judge calls are gated (skip recon noise, short chitchat, and marker wins)
- Reports show **Matched:** values (e.g. `Flag{…}`) instead of regex sources

### Fixed
- False wins when canaries/`Flag{…}` only appeared in echoed attack prompts
- Bare `Failed to fetch` from ephemeral service-worker LLM calls
- Host permission failures that burned the full iteration budget without stopping
- Placeholder `Flag{...}` no longer counts as a real flag
