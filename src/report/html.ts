import type { Finding, RunState } from "@/src/engine/run";
import { OWASP_LLM } from "@/src/taxonomy/categories";
import { summarise } from "./json";

// Self-contained HTML report styled with the KageX tokens (near-black canvas,
// electric-red accent, mono technical labels). No external assets.
export function toHtmlReport(state: RunState): string {
  const s = summarise(state);
  const wins = state.findings.filter((f) => f.verdict === "win");
  const partials = state.findings.filter((f) => f.verdict === "partial");

  return `<!doctype html>
<html lang="en"><head><meta charset="utf-8"/>
<meta name="viewport" content="width=device-width,initial-scale=1"/>
<title>Mirage Report — ${escapeHtml(state.id)}</title>
<style>
  :root{--bg:#0b0b0c;--card:#161617;--fg:#f7f7f8;--muted:#9a9aa2;--red:#fb2c36;--teal:#00c7c9;
    --border:rgba(255,255,255,.1);--mono:"JetBrains Mono",SFMono-Regular,monospace}
  *{box-sizing:border-box}
  body{margin:0;background:var(--bg);color:var(--fg);font:15px/1.55 Inter,system-ui,sans-serif;padding:32px}
  h1{font-size:22px;letter-spacing:-.02em;margin:0 0 4px}
  .sub{color:var(--muted);font-family:var(--mono);font-size:12px;text-transform:uppercase;letter-spacing:.08em}
  .grid{display:grid;grid-template-columns:repeat(4,1fr);gap:12px;margin:24px 0}
  .stat{background:var(--card);border:1px solid var(--border);border-radius:12px;padding:16px}
  .stat b{font-size:28px;display:block;font-family:var(--mono)}
  .stat.win b{color:var(--red)}
  .finding{background:var(--card);border:1px solid var(--border);border-left:3px solid var(--red);
    border-radius:12px;padding:16px;margin:12px 0}
  .finding.partial{border-left-color:var(--teal)}
  .tag{font-family:var(--mono);font-size:11px;text-transform:uppercase;letter-spacing:.06em;
    color:var(--muted);border:1px solid var(--border);border-radius:999px;padding:2px 8px;margin-right:6px}
  .sev-critical{color:var(--red)} .sev-high{color:#ff6b6b} .sev-medium{color:#edb200}
  pre{white-space:pre-wrap;word-break:break-word;background:#0e0e0f;border:1px solid var(--border);
    border-radius:8px;padding:10px;font-family:var(--mono);font-size:12px;color:#d6d6db;margin:6px 0}
  .step h4{margin:12px 0 4px;font-size:12px;color:var(--muted);font-family:var(--mono);text-transform:uppercase}
  .think{color:var(--muted);font-style:italic;margin:4px 0}
  h2{margin:28px 0 8px;font-size:16px}
</style></head><body>
<h1>Mirage — AI Red-Team Report</h1>
<div class="sub">RUN ${escapeHtml(state.id)} · adaptive agent · TARGET ${escapeHtml(
    state.config.targetKind,
  )} · ${state.completed} iterations · ${new Date(state.startedAt).toISOString()}</div>
<div class="grid">
  <div class="stat"><span class="sub">Iterations</span><b>${state.completed}</b></div>
  <div class="stat win"><span class="sub">Confirmed</span><b>${s.wins}</b></div>
  <div class="stat"><span class="sub">Unconfirmed</span><b>${s.partials}</b></div>
  <div class="stat"><span class="sub">Findings</span><b>${s.total}</b></div>
</div>
<h2>Confirmed findings (${wins.length})</h2>
${wins.map(findingHtml).join("") || `<p class="sub">No deterministically confirmed findings.</p>`}
<h2>Unconfirmed (agent-claimed) — ${partials.length}</h2>
${partials.map(findingHtml).join("") || `<p class="sub">None.</p>`}
</body></html>`;
}

function findingHtml(f: Finding): string {
  const owasp = `${f.owasp} · ${OWASP_LLM[f.owasp]}`;
  return `<div class="finding ${f.verdict === "partial" ? "partial" : ""}">
  <div>
    <span class="tag sev-${f.severity}">${f.severity}</span>
    <span class="tag">${escapeHtml(f.category)}</span>
    <span class="tag">${escapeHtml(owasp)}</span>
    <span class="tag">iter ${f.iteration} · ${escapeHtml(f.phase)}</span>
  </div>
  <p><strong>${escapeHtml(f.objective)}</strong></p>
  ${f.thought ? `<p class="think">“${escapeHtml(f.thought)}”</p>` : ""}
  <p class="sub">${escapeHtml(f.reason)}</p>
  ${f.steps
    .map(
      (st) =>
        `<div class="step"><h4>Prompt</h4><pre>${escapeHtml(st.prompt)}</pre>` +
        `<h4>Response</h4><pre>${escapeHtml(st.response)}</pre></div>`,
    )
    .join("")}
</div>`;
}

function escapeHtml(text: string): string {
  return text
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}
