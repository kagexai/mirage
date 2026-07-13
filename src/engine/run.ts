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
  error?: string;
}

export type RunStatus = "idle" | "running" | "done" | "stopped" | "error";

export interface RunConfig {
  targetKind: "tab" | "api";
  // Iteration budget for the agent loop.
  maxIterations: number;
  // Optional operator scope/objective hint the agent focuses on.
  scope?: string;
}

export interface RunState {
  id: string;
  status: RunStatus;
  config: RunConfig;
  startedAt: number;
  finishedAt?: number;
  findings: Finding[];
  // Progress counters for the UI (total = maxIterations).
  total: number;
  completed: number;
  wins: number;
  error?: string;
}

// Events streamed from the service-worker engine to the side panel.
export type EngineEvent =
  | { type: "run:start"; state: RunState }
  | { type: "run:progress"; completed: number; total: number; wins: number }
  | { type: "agent"; iteration: number; phase: AgentPhase; thought: string }
  | { type: "finding"; finding: Finding }
  | { type: "log"; level: "info" | "warn" | "error"; message: string }
  | { type: "run:done"; state: RunState }
  | { type: "run:error"; message: string };
