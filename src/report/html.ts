import type { ActivityEntry, Finding, ProbeLog, RunState } from "@/src/engine/run";
import { OWASP_LLM } from "@/src/taxonomy/categories";
import { summarise } from "./json";

// Self-contained HTML report styled with the KageX tokens (near-black canvas,
// electric-red accent, mono technical labels). No external assets.
export function toHtmlReport(state: RunState): string {
  const s = summarise(state);
  const wins = state.findings.filter((f) => f.verdict === "win");
  const partials = state.findings.filter((f) => f.verdict === "partial");
  const transcript = state.transcript ?? [];
  const activity = state.activity ?? [];
  const attacks = state.completed;
  const duration = state.finishedAt ? state.finishedAt - state.startedAt : 0;
  const sevOrder = ["critical", "high", "medium", "low"] as const;
  const topSev = sevOrder.find((sv) => (s.bySeverity[sv] ?? 0) > 0);
  const verdict = wins.length
    ? `${wins.length} confirmed ${wins.length === 1 ? "vulnerability" : "vulnerabilities"}`
    : partials.length
      ? "No confirmed wins — unconfirmed leads only"
      : "Target held — no vulnerabilities confirmed";

  return `<!doctype html>
<html lang="en"><head><meta charset="utf-8"/>
<meta name="viewport" content="width=device-width,initial-scale=1"/>
<title>Mirage Report — ${escapeHtml(state.id)}</title>
<style>
  :root{--bg:#0b0b0c;--card:#161617;--elev:#1d1d1f;--fg:#f7f7f8;--muted:#9a9aa2;--red:#fb2c36;
    --teal:#00c7c9;--success:#00c758;--warning:#edb200;--border:rgba(255,255,255,.1);
    --mono:"JetBrains Mono",SFMono-Regular,ui-monospace,monospace}
  *{box-sizing:border-box}
  body{margin:0;background:var(--bg);color:var(--fg);font:15px/1.55 Inter,system-ui,sans-serif;
    padding:32px;max-width:960px;margin:0 auto}
  h1{font-size:24px;letter-spacing:-.02em;margin:0 0 2px}
  h1 .dot{color:var(--red)}
  .sub{color:var(--muted);font-family:var(--mono);font-size:12px;text-transform:uppercase;letter-spacing:.08em}
  .verdict{margin:14px 0 0;font-size:17px;font-weight:600}
  .verdict.hit{color:var(--red)} .verdict.clean{color:var(--success)}
  .grid{display:grid;grid-template-columns:repeat(4,1fr);gap:12px;margin:20px 0 8px}
  .stat{background:var(--card);border:1px solid var(--border);border-radius:12px;padding:16px}
  .stat b{font-size:30px;display:block;font-family:var(--mono);line-height:1.1}
  .stat.win b{color:var(--red)}
  .chips{display:flex;flex-wrap:wrap;gap:8px;margin:6px 0 8px}
  .chip{font-family:var(--mono);font-size:12px;border:1px solid var(--border);border-radius:999px;
    padding:3px 10px;color:var(--muted)}
  .chip.sev-critical{color:var(--red);border-color:var(--red)}
  .chip.sev-high{color:#ff6b6b;border-color:rgba(255,107,107,.5)}
  .chip.sev-medium{color:var(--warning);border-color:rgba(237,178,0,.5)}
  h2{margin:34px 0 10px;font-size:16px;border-bottom:1px solid var(--border);padding-bottom:6px}
  .finding,.probe{background:var(--card);border:1px solid var(--border);border-left:3px solid var(--red);
    border-radius:12px;padding:16px;margin:12px 0}
  .finding.partial{border-left-color:var(--teal)}
  .probe.refused{border-left-color:var(--teal)}
  .probe.no-win{border-left-color:#555}
  .probe.error{border-left-color:var(--warning)}
  .probe.CONFIRMED-WIN{border-left-color:var(--red)}
  .tag{font-family:var(--mono);font-size:11px;text-transform:uppercase;letter-spacing:.06em;
    color:var(--muted);border:1px solid var(--border);border-radius:999px;padding:2px 8px;margin-right:6px}
  .tag.hit{color:var(--red);border-color:var(--red)}
  .sev-critical{color:var(--red)} .sev-high{color:#ff6b6b} .sev-medium{color:var(--warning)}
  pre{white-space:pre-wrap;word-break:break-word;background:#0e0e0f;border:1px solid var(--border);
    border-radius:8px;padding:10px;font-family:var(--mono);font-size:12px;color:#d6d6db;margin:6px 0;
    max-height:340px;overflow:auto}
  .step h4,.probe h4{margin:12px 0 4px;font-size:11px;color:var(--muted);font-family:var(--mono);
    text-transform:uppercase;letter-spacing:.06em}
  .think{color:var(--muted);font-style:italic;margin:4px 0}
  .name{font-weight:600;font-size:15px;margin:2px 0}
  .err{color:#ff8a7a;margin:8px 0}
  img.shot{display:block;max-width:100%;border:1px solid var(--border);border-radius:8px;margin:8px 0}
  .gallery{display:grid;grid-template-columns:repeat(2,1fr);gap:12px}
  .gallery figure{margin:0}
  .gallery figcaption{color:var(--muted);font-family:var(--mono);font-size:11px;margin-top:4px}
  .timeline{background:var(--card);border:1px solid var(--border);border-radius:12px;padding:8px 14px}
  .timeline .row{display:flex;gap:10px;padding:6px 0;border-bottom:1px solid var(--border);font-size:13px}
  .timeline .row:last-child{border-bottom:none}
  .timeline .t{font-family:var(--mono);font-size:11px;color:var(--teal);flex-shrink:0;min-width:76px;text-transform:uppercase}
  .foot{margin-top:36px;padding-top:14px;border-top:1px solid var(--border);color:var(--muted);
    font-family:var(--mono);font-size:11px;text-transform:uppercase;letter-spacing:.08em}
</style></head><body>
<h1>Mirage<span class="dot">.</span> — AI Red-Team Report</h1>
<div class="sub">Run ${escapeHtml(state.id)} · target ${escapeHtml(state.config.targetKind)} · ${escapeHtml(
    state.config.pace ?? "balanced",
  )} pace · ${new Date(state.startedAt).toISOString()}</div>
<p class="verdict ${wins.length ? "hit" : "clean"}">${escapeHtml(verdict)}${
    topSev ? ` · highest severity: <span class="sev-${topSev}">${topSev}</span>` : ""
  }</p>
${state.error ? `<p class="err">Error: ${escapeHtml(state.error)}</p>` : ""}
<div class="grid">
  <div class="stat"><span class="sub">Attacks</span><b>${attacks}</b></div>
  <div class="stat win"><span class="sub">Confirmed</span><b>${s.wins}</b></div>
  <div class="stat"><span class="sub">Unconfirmed</span><b>${s.partials}</b></div>
  <div class="stat"><span class="sub">Duration</span><b>${fmtDuration(duration)}</b></div>
</div>
${
  Object.keys(s.bySeverity).length
    ? `<div class="chips">${sevOrder
        .filter((sv) => s.bySeverity[sv])
        .map((sv) => `<span class="chip sev-${sv}">${sv}: ${s.bySeverity[sv]}</span>`)
        .join("")}</div>`
    : ""
}

<h2>Confirmed findings (${wins.length})</h2>
${wins.map(findingHtml).join("") || `<p class="sub">No deterministically confirmed findings.</p>`}

<h2>Unconfirmed / agent-claimed (${partials.length})</h2>
${partials.map(findingHtml).join("") || `<p class="sub">None.</p>`}

<h2>Attack transcript (${transcript.length})</h2>
${transcript.map(probeHtml).join("") || `<p class="sub">No attacks recorded.</p>`}

${
  activity.length
    ? `<h2>Recon &amp; navigation (${activity.length})</h2>
<div class="timeline">${activity
        .map((a) => activityHtml(a))
        .join("")}</div>`
    : ""
}

${
  (state.screenshots?.length ?? 0) > 0
    ? `<h2>Evidence captures (${state.screenshots.length})</h2>
<div class="gallery">${state.screenshots
        .map(
          (c) =>
            `<figure><img class="shot" src="${c.dataUrl}" alt="evidence"/><figcaption>#${c.iteration} · ${escapeHtml(
              c.caption,
            )}</figcaption></figure>`,
        )
        .join("")}</div>`
    : ""
}
<div class="foot">Generated by Mirage · KageX · authorized testing only</div>
</body></html>`;
}

function probeHtml(p: ProbeLog): string {
  const won = p.outcome === "CONFIRMED-WIN";
  return `<div class="probe ${escapeHtml(p.outcome)}">
  <div>
    <span class="tag${won ? " hit" : ""}">attack #${p.iteration}</span>
    <span class="tag">${escapeHtml(p.phase)}</span>
    <span class="tag${won ? " hit" : ""}">${escapeHtml(p.outcome)}</span>
    ${p.category ? `<span class="tag">${escapeHtml(p.category)}</span>` : ""}
    ${p.elapsedMs != null ? `<span class="tag">${p.elapsedMs}ms</span>` : ""}
  </div>
  <p class="name">${escapeHtml(p.objective)}</p>
  ${p.thought ? `<p class="think">“${escapeHtml(p.thought)}”</p>` : ""}
  <h4>Input (attacker → target)</h4>
  <pre>${escapeHtml(p.prompt)}</pre>
  <h4>Output (target → attacker)</h4>
  <pre>${escapeHtml(p.response)}</pre>
  ${p.markersHit.length ? `<p class="sub">Matched: ${escapeHtml(p.markersHit.join(", "))}</p>` : ""}
</div>`;
}

function findingHtml(f: Finding): string {
  const owasp = `${f.owasp} · ${OWASP_LLM[f.owasp]}`;
  return `<div class="finding ${f.verdict === "partial" ? "partial" : ""}">
  <div>
    <span class="tag sev-${f.severity}">${f.severity}</span>
    <span class="tag">${escapeHtml(f.category)}</span>
    <span class="tag">${escapeHtml(owasp)}</span>
    <span class="tag">attack #${f.iteration}</span>
  </div>
  <p class="name">${escapeHtml(f.objective)}</p>
  ${f.thought ? `<p class="think">“${escapeHtml(f.thought)}”</p>` : ""}
  <p class="sub">${escapeHtml(f.reason)}</p>
  ${f.screenshot ? `<img class="shot" src="${f.screenshot}" alt="evidence screenshot"/>` : ""}
  ${f.steps
    .map(
      (st) =>
        `<div class="step"><h4>Input</h4><pre>${escapeHtml(st.prompt)}</pre>` +
        `<h4>Output</h4><pre>${escapeHtml(st.response)}</pre></div>`,
    )
    .join("")}
</div>`;
}

function activityHtml(a: ActivityEntry): string {
  return `<div class="row"><span class="t">${escapeHtml(a.tool)}</span><span>${escapeHtml(a.detail)}</span></div>`;
}

function fmtDuration(ms: number): string {
  if (ms <= 0) return "—";
  const sec = Math.round(ms / 1000);
  if (sec < 60) return `${sec}s`;
  return `${Math.floor(sec / 60)}m ${sec % 60}s`;
}

function escapeHtml(text: string): string {
  return text
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}
