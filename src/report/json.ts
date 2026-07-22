import type { RunState } from "@/src/engine/run";

export interface ReportSummary {
  total: number;
  wins: number;
  partials: number;
  errors: number;
  probes: number;
  bySeverity: Record<string, number>;
  byCategory: Record<string, number>;
}

export function summarise(state: RunState): ReportSummary {
  const bySeverity: Record<string, number> = {};
  const byCategory: Record<string, number> = {};
  let wins = 0;
  let partials = 0;
  let errors = 0;
  for (const f of state.findings) {
    if (f.verdict === "win") {
      wins++;
      bySeverity[f.severity] = (bySeverity[f.severity] ?? 0) + 1;
      byCategory[f.category] = (byCategory[f.category] ?? 0) + 1;
    } else if (f.verdict === "partial") partials++;
    else if (f.verdict === "error") errors++;
  }
  return {
    total: state.findings.length,
    wins,
    partials,
    errors,
    probes: state.transcript?.length ?? 0,
    bySeverity,
    byCategory,
  };
}

export function toJsonReport(state: RunState): string {
  return JSON.stringify(
    {
      tool: "Mirage",
      mode: "adaptive-agent",
      generatedAt: new Date().toISOString(),
      run: {
        id: state.id,
        status: state.status,
        config: state.config,
        startedAt: state.startedAt,
        finishedAt: state.finishedAt,
        attacks: state.completed,
        error: state.error,
      },
      summary: summarise(state),
      screenshotCount: state.screenshots?.length ?? 0,
      // Recon / navigation steps (read_page, scroll, click) — not attacks.
      activity: state.activity ?? [],
      // Full attack/response log — every probe, not only confirmed wins.
      transcript: (state.transcript ?? []).map((p) => ({
        iteration: p.iteration,
        phase: p.phase,
        thought: p.thought,
        objective: p.objective,
        category: p.category,
        outcome: p.outcome,
        markersHit: p.markersHit,
        elapsedMs: p.elapsedMs,
        input: p.prompt,
        output: p.response,
        sideEffects: p.sideEffects,
      })),
      // Drop the base64 screenshot from JSON (keeps the file small) — flag it
      // instead; the visual evidence lives in the HTML report.
      findings: state.findings.map(({ screenshot, ...f }) => ({
        ...f,
        hasScreenshot: !!screenshot,
        steps: f.steps.map((s) => ({
          iteration: s.iteration,
          objective: s.objective,
          input: s.prompt,
          output: s.response,
          sideEffects: s.sideEffects,
        })),
      })),
    },
    null,
    2,
  );
}
