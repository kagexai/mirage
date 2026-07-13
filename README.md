# Mirage

An AI red-team agent that runs in your browser. Point it at any AI — a chat widget, an
agent, or an API endpoint — and it attacks like a real adversary would: recon, plan, test,
judge, iterate. Every finding is confirmed deterministically, so the model can never grade
itself into a win.

Built by KageX.

## What it does

- **Autonomous loop.** recon → plan → test → judge → iterate. The attacker model fingerprints
  the target, forms a hypothesis, attacks, reads the result, and adapts — no fixed payload list.
- **Goal-driven.** Set an objective (extract the system prompt, find the flag, get disallowed
  content, abuse a tool) and Mirage stops the moment the target's response achieves it.
- **Two target surfaces.** Drive a live chat UI in the active tab, or hit a configured API
  endpoint directly. Same attacks against either.
- **Multi-provider.** Claude, OpenAI, Grok, and local Ollama — as the attacker/judge brain and
  as the target.
- **Deterministic scoring.** A win requires a real marker / canary / side-effect, decoded
  through base64, rot13, reversed, and zero-width text. The LLM judge is additive, never the
  sole gate.
- **OWASP-LLM mapped**, with exportable HTML/JSON reports and an AI-written executive summary.

## Develop

```bash
npm install
npm run dev      # opens a dev Chrome with the extension loaded (HMR)
npm run build    # production build → .output/chrome-mv3
npm run compile  # tsc --noEmit
npm test         # vitest
```

Load unpacked: `chrome://extensions` → Developer mode → **Load unpacked** → `.output/chrome-mv3`.

## Use

1. Open the side panel and accept the authorized-use notice.
2. Set your attacker/judge model and API key in **Settings**. A fast model (grok-4-fast,
   gpt-4o-mini, claude-haiku) makes runs noticeably quicker.
3. Pick a target (active tab or API endpoint) and an objective.
4. **Launch.** Watch the agent reason in real time; export a report.

API keys are stored in `chrome.storage.local` and never written into reports.

## Stack

MV3 extension built with WXT, TypeScript, and React. Core modules: `src/engine/agent.ts` (the
loop), `src/agents/` (red-team agent, goal judge), `src/scoring/` (deterministic confirmation),
`src/providers/`, `src/targets/`, `src/report/`.

## Safety

Mirage sends adversarial prompts to whatever you point it at. Only run it against systems you
own or are explicitly authorized to test.

## License

MIT — see [LICENSE](./LICENSE).
