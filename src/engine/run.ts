import type { OwaspId, Severity } from "@/src/taxonomy/categories";

// The phases of the adaptive red-team loop, streamed to the UI so the operator
// can watch the agent reason.
export type AgentPhase = "recon" | "plan" | "test" | "judge" | "iterate" | "done";

// One message sent to the target and what came back.
export interface StepResult {
  iteration: number;
  objective: string;
  prompt: string;
  response: string;
  // Populated by targets that can observe out-of-band side effects.
  sideEffects?: string[];
}

// Full probe log entry — every attack/response pair, not just wins.
// Reports and the live feed use this so operators always see I/O.
export interface ProbeLog {
  iteration: number;
  phase: AgentPhase;
  thought: string;
  objective: string;
  category?: string;
  prompt: string;
  response: string;
  outcome: "CONFIRMED-WIN" | "no-win" | "refused" | "error";
  markersHit: string[];
  sideEffects?: string[];
  elapsedMs?: number;
}

export type Verdict = "win" | "partial" | "no-win" | "error";

// A finding the agent surfaced. "win" = deterministically confirmed (a real
// marker/canary/side-effect hit). "partial" = agent-claimed but unconfirmed.
export interface Finding {
  id: string;
  iteration: number;
  category: string; // agent-named attack class (may be free-form)
  owasp: OwaspId;
  objective: string;
  verdict: Verdict;
  severity: Severity;
  reason: string;
  // Deterministic detectors that fired (empty on an agent-claimed partial).
  markersHit: string[];
  // The agent's reasoning that led here.
  phase: AgentPhase;
  thought: string;
  steps: StepResult[];
  // Visual evidence: a screenshot of the target page captured when the win was
  // confirmed (tab target only). Data URL.
  screenshot?: string;
  error?: string;
}

// A captured screenshot of the target page (tab target). Evidence + report.
export interface Capture {
  iteration: number;
  caption: string;
  dataUrl: string;
}

// A recon / navigation step (read_page, scroll, click, screenshot). These do NOT
// consume the attack budget — they are shown separately from numbered attacks.
export interface ActivityEntry {
  tool: string;
  detail: string;
}

export type RunStatus = "idle" | "running" | "done" | "stopped" | "error";

// How aggressively to trade LLM cost/latency for coverage.
//   fast     — compact context, skip most goal-judge calls, stop on first win
//   balanced — default: smart judge gating + stop on first confirmed win
//   thorough — full memory, judge every non-refusal probe, keep hunting after wins
export type RunPace = "fast" | "balanced" | "thorough";

export interface RunConfig {
  targetKind: "tab" | "api";
  // Iteration budget for the agent loop.
  maxIterations: number;
  // Optional operator scope/objective hint the agent focuses on.
  scope?: string;
  // Latency/cost profile (default: balanced).
  pace?: RunPace;
  // Stop the run after the first confirmed (marker) win. Defaults from pace when unset.
  stopOnFirstWin?: boolean;
}

export interface RunState {
  id: string;
  status: RunStatus;
  config: RunConfig;
  startedAt: number;
  finishedAt?: number;
  findings: Finding[];
  // Every probe prompt/response (wins and misses). Source of truth for reports.
  transcript: ProbeLog[];
  // Screenshots captured during the run (win evidence + agent-initiated).
  screenshots: Capture[];
  // Recon / navigation steps (do not count as attacks).
  activity: ActivityEntry[];
  // Progress counters for the UI. total = attack budget (maxIterations);
  // completed = attacks actually fired (probes), not navigation steps.
  total: number;
  completed: number;
  wins: number;
  error?: string;
}

// Events streamed from the engine to the side panel (or local emitter).
export type EngineEvent =
  | { type: "run:start"; state: RunState }
  | { type: "run:progress"; completed: number; total: number; wins: number }
  | { type: "agent"; iteration: number; phase: AgentPhase; thought: string }
  | { type: "probe"; probe: ProbeLog }
  | { type: "browser"; iteration: number; tool: string; detail: string }
  | { type: "screenshot"; iteration: number; caption: string; dataUrl: string }
  | { type: "finding"; finding: Finding }
  | { type: "log"; level: "info" | "warn" | "error"; message: string }
  | { type: "run:done"; state: RunState }
  | { type: "run:error"; message: string };
