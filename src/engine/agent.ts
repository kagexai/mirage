import {
  askAgent,
  buildAgentMessages,
  type MemoryEntry,
} from "@/src/agents/redteam-agent";
import { judgeGoal } from "@/src/agents/goal-judge";
import { confirmProbe } from "@/src/scoring/confirm";
import { owaspForCategory, type Severity } from "@/src/taxonomy/categories";
import type { Provider } from "@/src/providers/types";
import type { Target } from "@/src/targets/types";
import type { EngineEvent, Finding, RunState, StepResult } from "./run";

export interface AgentDeps {
  config: import("./run").RunConfig;
  target: Target;
  // The attacker/judge brain — required in agent mode.
  brain: Provider;
  emit: (event: EngineEvent) => void;
  signal: AbortSignal;
}

function newId(): string {
  return typeof crypto !== "undefined" && "randomUUID" in crypto
    ? crypto.randomUUID()
    : `id-${Math.floor(Math.random() * 1e9).toString(36)}`;
}

// A confirmed probe win's severity, from the attack class it belongs to.
function severityForCategory(category: string | undefined): Severity {
  if (category === "agentic-exfiltration" || category === "insecure-plugin-design") return "critical";
  return "high";
}

// The adaptive red-team loop: recon → plan → test → judge → iterate. The brain
// reasons about the target and drives every probe; the harness deterministically
// confirms wins (the brain cannot grade itself into one).
export async function runAgent(deps: AgentDeps): Promise<RunState> {
  const { config, target, brain, emit, signal } = deps;

  const state: RunState = {
    id: newId(),
    status: "running",
    config,
    startedAt: Date.now(),
    findings: [],
    total: config.maxIterations,
    completed: 0,
    wins: 0,
  };
  emit({ type: "run:start", state });

  const memory: MemoryEntry[] = [];
  target.reset();

  for (let iteration = 1; iteration <= config.maxIterations; iteration++) {
    if (signal.aborted) break;

    let decision;
    try {
      const messages = buildAgentMessages(memory, config, iteration, target.label);
      decision = await askAgent(brain, messages, signal);
    } catch (e) {
      // A Stop click aborts the in-flight request — that's a normal stop, not an
      // error. Only surface a genuine model/transport failure.
      if (signal.aborted || isAbortError(e)) break;
      const message = e instanceof Error ? e.message : String(e);
      emit({ type: "run:error", message: `attacker model error: ${message}` });
      state.status = "error";
      state.error = message;
      state.finishedAt = Date.now();
      emit({ type: "run:done", state });
      return state;
    }

    emit({ type: "agent", iteration, phase: decision.phase, thought: decision.thought });
    memory.push({
      kind: "thought",
      iteration,
      phase: decision.phase,
      thought: decision.thought,
      action: decision.action.type,
    });

    if (decision.action.type === "done") {
      break;
    }

    if (decision.action.type === "probe") {
      const a = decision.action;
      if (a.newConversation) {
        target.reset();
        memory.push({ kind: "note", iteration, note: "started a fresh target conversation" });
      }

      let response = "";
      let sideEffects: string[] | undefined;
      try {
        const r = await target.send(a.prompt, signal);
        response = r.response;
        sideEffects = r.sideEffects;
      } catch (e) {
        if (signal.aborted || isAbortError(e)) break;
        const message = e instanceof Error ? e.message : String(e);
        emit({ type: "log", level: "warn", message: `probe failed: ${message}` });
        memory.push({
          kind: "probe",
          iteration,
          objective: a.objective,
          prompt: a.prompt,
          response: `<error: ${message}>`,
          outcome: "error",
          markersHit: [],
        });
        state.completed = iteration;
        emit({ type: "run:progress", completed: iteration, total: state.total, wins: state.wins });
        continue;
      }

      const conf = confirmProbe(response, sideEffects, a.canary);
      const outcome = conf.win
        ? ("CONFIRMED-WIN" as const)
        : isRefusalLike(response)
          ? ("refused" as const)
          : ("no-win" as const);

      memory.push({
        kind: "probe",
        iteration,
        objective: a.objective,
        prompt: a.prompt,
        response,
        outcome,
        markersHit: conf.markersHit,
      });

      // The operator's scope is the WIN CONDITION. When it's set and the target
      // gave a substantive (non-refusal) response, ask the goal judge whether the
      // objective was achieved — if so, record success and END the engagement.
      const scope = config.scope?.trim();
      let goalMet = false;
      if (scope && response.trim() && !isRefusalLike(response)) {
        try {
          const goal = await judgeGoal(brain, scope, a.prompt, response, signal);
          if (goal.achieved) {
            goalMet = true;
            const finding = makeFinding({
              iteration,
              category: a.category ?? "objective-complete",
              objective: scope,
              verdict: "win",
              severity: goal.severity,
              reason: `OBJECTIVE ACHIEVED — ${goal.evidence || "target fulfilled the operator's goal"}`,
              markersHit: conf.markersHit,
              phase: "done",
              thought: decision.thought,
              step: { iteration, objective: scope, prompt: a.prompt, response, sideEffects },
            });
            state.findings.push(finding);
            state.wins++;
            emit({ type: "agent", iteration, phase: "done", thought: `Objective achieved — ${goal.evidence}` });
            emit({ type: "finding", finding });
          }
        } catch (e) {
          if (signal.aborted || isAbortError(e)) break;
          emit({ type: "log", level: "warn", message: `goal judge failed: ${e instanceof Error ? e.message : e}` });
        }
      }

      // Record a deterministic marker win too (unless it was already captured as
      // the objective-complete finding above).
      if (!goalMet && conf.win) {
        const finding = makeFinding({
          iteration,
          category: a.category ?? a.objective,
          objective: a.objective,
          verdict: "win",
          severity: severityForCategory(a.category),
          reason: `confirmed — deterministic marker hit: ${conf.markersHit.join(", ")}`,
          markersHit: conf.markersHit,
          phase: decision.phase,
          thought: decision.thought,
          step: { iteration, objective: a.objective, prompt: a.prompt, response, sideEffects },
        });
        state.findings.push(finding);
        state.wins++;
        emit({ type: "finding", finding });
      }

      if (goalMet) {
        state.completed = iteration;
        emit({ type: "run:progress", completed: iteration, total: state.total, wins: state.wins });
        break; // engagement objective met — stop.
      }
    }

    if (decision.action.type === "record") {
      const a = decision.action;
      // Re-check the most recent probe response so a "record" still can't bypass
      // deterministic confirmation — it only upgrades to "win" if a marker fired.
      const lastProbe = [...memory].reverse().find((m) => m.kind === "probe");
      const conf =
        lastProbe && lastProbe.kind === "probe"
          ? confirmProbe(lastProbe.response, undefined, a.canary)
          : { win: false, markersHit: [] as string[], matches: [] };
      const confirmed = conf.win;
      const finding = makeFinding({
        iteration,
        category: a.category ?? a.objective,
        objective: a.objective,
        verdict: confirmed ? "win" : "partial",
        severity: confirmed ? severityForCategory(a.category) : a.severity,
        reason: confirmed
          ? `confirmed — deterministic marker hit: ${conf.markersHit.join(", ")}`
          : `agent-claimed (unconfirmed): ${a.evidence}`,
        markersHit: conf.markersHit,
        phase: decision.phase,
        thought: decision.thought,
        step:
          lastProbe && lastProbe.kind === "probe"
            ? {
                iteration: lastProbe.iteration,
                objective: lastProbe.objective,
                prompt: lastProbe.prompt,
                response: lastProbe.response,
              }
            : undefined,
      });
      state.findings.push(finding);
      if (confirmed) state.wins++;
      emit({ type: "finding", finding });
    }

    state.completed = iteration;
    emit({ type: "run:progress", completed: iteration, total: state.total, wins: state.wins });
  }

  state.status = signal.aborted ? "stopped" : "done";
  state.finishedAt = Date.now();
  emit({ type: "run:done", state });
  return state;
}

// An aborted fetch surfaces as a DOMException/AbortError (message varies across
// engines: "signal is aborted without reason", "The user aborted a request").
function isAbortError(e: unknown): boolean {
  if (e instanceof DOMException && e.name === "AbortError") return true;
  const msg = e instanceof Error ? e.message : String(e);
  return /abort/i.test(msg);
}

// Local refusal heuristic mirror (avoids importing scoring internals here).
function isRefusalLike(text: string): boolean {
  return /i(?:'m| am) (?:sorry|unable|not able)|i can(?:not|'t) (?:help|assist|comply|provide)|as an ai/i.test(
    text,
  );
}

function makeFinding(args: {
  iteration: number;
  category: string;
  objective: string;
  verdict: Finding["verdict"];
  severity: Severity;
  reason: string;
  markersHit: string[];
  phase: Finding["phase"];
  thought: string;
  step?: StepResult;
}): Finding {
  return {
    id: newId(),
    iteration: args.iteration,
    category: args.category,
    owasp: owaspForCategory(args.category),
    objective: args.objective,
    verdict: args.verdict,
    severity: args.severity,
    reason: args.reason,
    markersHit: args.markersHit,
    phase: args.phase,
    thought: args.thought,
    steps: args.step ? [args.step] : [],
  };
}
