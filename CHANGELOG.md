# Changelog

All notable changes to Mirage are documented in this file.

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
