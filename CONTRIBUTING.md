# Extending the Mirage agent

Mirage's attacks come from an **autonomous agent's reasoning**, not from static
pack files. There are three places to shape its behavior — all in
`src/agents/redteam-agent.ts` and `src/scoring/`.

## 1. The agent's playbook — `REDTEAM_SYSTEM`

`src/agents/redteam-agent.ts` holds `REDTEAM_SYSTEM`, the system prompt that
defines the methodology (recon → plan → test → judge → iterate), the canary
technique, and the decision format. To change *how* the agent attacks — add a
technique, change its priorities, tighten its recon — edit this prompt. Keep the
JSON decision contract intact (the loop parses it) and keep the canary rule (it's
what makes wins verifiable).

## 2. Attack-class knowledge — `src/taxonomy/categories.ts`

The agent is seeded with the `CATEGORIES` list (grouped by `CATEGORY_TIER`) and
maps each to OWASP via `CATEGORY_OWASP`. To teach it a new attack class:

1. Add the id to `CATEGORIES`.
2. Add its tier to `CATEGORY_TIER` and its OWASP id to `CATEGORY_OWASP`.

The agent may also invent free-form categories at runtime — unknown ones fall
back to `LLM01` via `owaspForCategory`. The list is guidance, not a cage.

## 3. Deterministic confirmation — `src/scoring/`

This is the load-bearing safety rail: **the agent can never grade itself into a
win.** `src/scoring/confirm.ts` (`confirmProbe`) is the only thing that produces a
confirmed `win`, and it reuses the pure detectors in `src/scoring/detectors.ts`
(decode passes + refusal gate + universal markers). If you add a new success
signal (a new exploit banner, a new exfil URL shape), add it to `UNIVERSAL_MARKERS`
or `SIDE_EFFECT_MARKERS` in `confirm.ts` — never by trusting the model's verdict.

Preserve these invariants:

- **Deterministic first.** A `record` (agent-claimed) decision only becomes a
  `win` if `confirmProbe` re-confirms it against the target's output; otherwise
  it's a `partial`.
- **Decode before matching.** Any signal that could be smuggled as base64 / rot13
  / reversed / zero-width text must go through the decode passes (that's the exact
  gap an `llm-judge-bypass` attack exploits).
- **Refusals don't count.** A marker inside a refusal is not a win.

## Decision schema

The agent returns one JSON `AgentDecision` per turn, validated by a Zod
discriminated union (`agentDecisionSchema`). Actions: `probe` (send a crafted
prompt, optional `canary`, optional `newConversation`), `record` (claim a
behavioral finding), `done`. If you extend it, update the Zod schema, the
`REDTEAM_SYSTEM` examples, and the loop's handler in `src/engine/agent.ts`
together.

## Validate locally

```bash
npm run test      # detectors + confirm + decision parsing + full-loop integration
npm run compile
```

`tests/agent-loop.test.ts` drives the whole loop with a scripted brain and a stub
target — copy it to prove a new behavior end-to-end without a live model.
