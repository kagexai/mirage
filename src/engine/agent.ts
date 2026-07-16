import {
  askAgent,
  buildAgentMessages,
  shouldStopOnFirstWin,
  type MemoryEntry,
} from "@/src/agents/redteam-agent";
import { CONTINUE_PROMPT, looksTruncated, mergeContinued } from "@/src/agents/strategy";
import { judgeGoal, shouldJudgeGoal } from "@/src/agents/goal-judge";
import { confirmProbe } from "@/src/scoring/confirm";
import { owaspForCategory, type Severity } from "@/src/taxonomy/categories";
import type { Provider } from "@/src/providers/types";
import type { Target } from "@/src/targets/types";
import type { EngineEvent, Finding, ProbeLog, RunState, StepResult } from "./run";
import { isFatalTabError } from "@/src/targets/tab";
import { looksLikeFlagValidationResponse } from "@/src/targets/composer";

const MAX_AUTO_CONTINUES = 2;

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
  const pace = config.pace ?? "balanced";
  const stopOnWin = shouldStopOnFirstWin(config);

  const state: RunState = {
    id: newId(),
    status: "running",
    config,
    startedAt: Date.now(),
    findings: [],
    transcript: [],
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
      decision = await askAgent(brain, messages, signal, pace);
    } catch (e) {
      if (signal.aborted || isAbortError(e)) break;
      // One automatic retry on flaky network before killing the run.
      const message = e instanceof Error ? e.message : String(e);
      if (isTransientProviderError(message)) {
        emit({ type: "log", level: "warn", message: `attacker retry after: ${message}` });
        try {
          await delay(600);
          if (signal.aborted) break;
          const messages = buildAgentMessages(memory, config, iteration, target.label);
          decision = await askAgent(brain, messages, signal, pace);
        } catch (e2) {
          if (signal.aborted || isAbortError(e2)) break;
          const msg2 = e2 instanceof Error ? e2.message : String(e2);
          emit({ type: "run:error", message: `attacker model error: ${msg2}` });
          state.status = "error";
          state.error = msg2;
          state.finishedAt = Date.now();
          emit({ type: "run:done", state });
          return state;
        }
      } else {
        emit({ type: "run:error", message: `attacker model error: ${message}` });
        state.status = "error";
        state.error = message;
        state.finishedAt = Date.now();
        emit({ type: "run:done", state });
        return state;
      }
    }

    emit({ type: "agent", iteration, phase: decision.phase, thought: decision.thought });
    if (pace === "thorough") {
      memory.push({
        kind: "thought",
        iteration,
        phase: decision.phase,
        thought: decision.thought,
        action: decision.action.type,
      });
    }

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
      const probeStarted = Date.now();
      // Prompts used for echo-stripping during confirm (original + continues).
      let confirmAgainstPrompt = a.prompt;
      try {
        const r = await target.send(a.prompt, signal);
        response = r.response;
        sideEffects = r.sideEffects;

        // Auto-continue incomplete dumps without another brain call (saves a
        // full LLM round-trip and recovers mid-JSON / mid-list replies).
        let continues = 0;
        while (
          continues < MAX_AUTO_CONTINUES &&
          looksTruncated(response) &&
          !confirmProbe(response, sideEffects, a.canary, confirmAgainstPrompt).win &&
          !signal.aborted
        ) {
          continues++;
          emit({
            type: "agent",
            iteration,
            phase: "iterate",
            thought: `Auto-continue #${continues}: last reply looks truncated`,
          });
          memory.push({
            kind: "note",
            iteration,
            note: `auto-continue #${continues} (truncated reply)`,
          });
          try {
            const more = await target.send(CONTINUE_PROMPT, signal);
            response = mergeContinued(response, more.response);
            sideEffects = [...(sideEffects ?? []), ...(more.sideEffects ?? [])];
            // Don't strip CONTINUE_PROMPT from the merged blob as if it were the attack.
            confirmAgainstPrompt = a.prompt;
          } catch (contErr) {
            if (signal.aborted || isAbortError(contErr)) break;
            emit({
              type: "log",
              level: "warn",
              message: `auto-continue failed: ${contErr instanceof Error ? contErr.message : contErr}`,
            });
            break;
          }
        }
      } catch (e) {
        if (signal.aborted || isAbortError(e)) break;
        const message = e instanceof Error ? e.message : String(e);
        emit({ type: "log", level: "warn", message: `probe failed: ${message}` });
        const probe: ProbeLog = {
          iteration,
          phase: decision.phase,
          thought: decision.thought,
          objective: a.objective,
          category: a.category,
          prompt: a.prompt,
          response: `<error: ${message}>`,
          outcome: "error",
          markersHit: [],
          elapsedMs: Date.now() - probeStarted,
        };
        state.transcript.push(probe);
        emit({ type: "probe", probe });
        memory.push({
          kind: "probe",
          iteration,
          objective: a.objective,
          prompt: a.prompt,
          response: probe.response,
          outcome: "error",
          markersHit: [],
        });
        state.completed = iteration;
        emit({ type: "run:progress", completed: iteration, total: state.total, wins: state.wins });

        // Host-permission / inject failures will never recover mid-run — stop
        // instead of burning the full budget on the same error.
        if (isFatalTabError(message)) {
          emit({ type: "run:error", message });
          state.status = "error";
          state.error = message;
          state.finishedAt = Date.now();
          emit({ type: "run:done", state });
          return state;
        }
        continue;
      }

      // Pass the attacker prompt so confirmation ignores echoed user bubbles
      // (otherwise canaries planted in the prompt false-positive as wins).
      const conf = confirmProbe(response, sideEffects, a.canary, confirmAgainstPrompt);
      const outcome = conf.win
        ? ("CONFIRMED-WIN" as const)
        : isRefusalLike(response)
          ? ("refused" as const)
          : ("no-win" as const);

      const probe: ProbeLog = {
        iteration,
        phase: decision.phase,
        thought: decision.thought,
        objective: a.objective,
        category: a.category,
        prompt: a.prompt,
        response,
        outcome,
        markersHit: conf.markersHit,
        sideEffects,
        elapsedMs: Date.now() - probeStarted,
      };
      state.transcript.push(probe);
      emit({ type: "probe", probe });

      memory.push({
        kind: "probe",
        iteration,
        objective: a.objective,
        prompt: a.prompt,
        response,
        outcome,
        markersHit: conf.markersHit,
      });

      // Tab target sometimes lands on flag-validation / non-chat fields. Surface
      // that so the brain stops treating "wrong flag" UI noise as AI refusals.
      if (looksLikeFlagValidationResponse(response)) {
        const note =
          "WRONG INPUT TARGET suspected: reply looks like flag-validation UI " +
          "(e.g. wrong/invalid flag), not the chat AI. Do not thrash flag formats — " +
          "you are not talking to the model. Operator may need to focus the chat composer.";
        memory.push({ kind: "note", iteration, note });
        emit({ type: "log", level: "warn", message: note });
      }

      // Operator scope = WIN CONDITION. Only spend a goal-judge LLM call when
      // the gate says it's worth it.
      const scope = config.scope?.trim();
      let goalMet = false;
      if (
        scope &&
        response.trim() &&
        !isRefusalLike(response) &&
        shouldJudgeGoal({
          response,
          phase: decision.phase,
          markerWin: conf.win,
          pace,
        })
      ) {
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

      if (!goalMet && conf.win) {
        const finding = makeFinding({
          iteration,
          category: a.category ?? a.objective,
          objective: scope || a.objective,
          verdict: "win",
          severity: severityForCategory(a.category),
          reason: `confirmed — matched: ${conf.markersHit.join(", ")}`,
          markersHit: conf.markersHit,
          phase: decision.phase,
          thought: decision.thought,
          step: { iteration, objective: a.objective, prompt: a.prompt, response, sideEffects },
        });
        state.findings.push(finding);
        state.wins++;
        emit({ type: "finding", finding });
      }

      const shouldStop = goalMet || (conf.win && (stopOnWin || !!scope));

      if (shouldStop) {
        state.completed = iteration;
        emit({ type: "run:progress", completed: iteration, total: state.total, wins: state.wins });
        if (conf.win && !goalMet) {
          emit({
            type: "agent",
            iteration,
            phase: "done",
            thought: stopOnWin || scope ? "Confirmed win — stopping early" : "Confirmed win",
          });
        }
        break;
      }
    }

    if (decision.action.type === "record") {
      const a = decision.action;
      const lastProbe = [...memory].reverse().find((m) => m.kind === "probe");
      const conf =
        lastProbe && lastProbe.kind === "probe"
          ? confirmProbe(lastProbe.response, undefined, a.canary, lastProbe.prompt)
          : { win: false, markersHit: [] as string[], matches: [] };
      const confirmed = conf.win;
      const finding = makeFinding({
        iteration,
        category: a.category ?? a.objective,
        objective: a.objective,
        verdict: confirmed ? "win" : "partial",
        severity: confirmed ? severityForCategory(a.category) : a.severity,
        reason: confirmed
          ? `confirmed — matched: ${conf.markersHit.join(", ")}`
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

      if (confirmed && stopOnWin) {
        state.completed = iteration;
        emit({ type: "run:progress", completed: iteration, total: state.total, wins: state.wins });
        break;
      }
    }

    state.completed = iteration;
    emit({ type: "run:progress", completed: iteration, total: state.total, wins: state.wins });
  }

  state.status = signal.aborted ? "stopped" : state.status === "error" ? "error" : "done";
  state.finishedAt = Date.now();
  emit({ type: "run:done", state });
  return state;
}

function isAbortError(e: unknown): boolean {
  if (e instanceof DOMException && e.name === "AbortError") return true;
  const msg = e instanceof Error ? e.message : String(e);
  return /abort/i.test(msg);
}

function isTransientProviderError(message: string): boolean {
  return /failed to fetch|network error|networkerror|load failed|ECONNRESET|ETIMEDOUT|503|502|429/i.test(
    message,
  );
}

function isRefusalLike(text: string): boolean {
  return /i(?:'m| am) (?:sorry|unable|not able)|i can(?:not|'t) (?:help|assist|comply|provide)|as an ai/i.test(
    text,
  );
}

function delay(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms));
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
