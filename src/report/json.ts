import type { RunState } from "@/src/engine/run";

export interface ReportSummary {
  total: number;
  wins: number;
  partials: number;
  errors: number;
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
  return { total: state.findings.length, wins, partials, errors, bySeverity, byCategory };
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
        iterations: state.completed,
      },
      summary: summarise(state),
      findings: state.findings,
    },
    null,
    2,
  );
}
