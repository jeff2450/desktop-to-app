import path from "node:path";
import fs from "node:fs/promises";
import type { BuildResult } from "../types/BuildResult.js";

/**
 * Generates a self-contained webtoapp-report.html in the output directory
 * after a conversion run (success or failure).
 *
 * The report shows:
 *  - Overall status + duration
 *  - Stage-by-stage timeline with status and duration
 *  - Files transformed, copied, generated
 *  - Credentials stripped from .env
 *  - Low-confidence transforms that need manual review
 *  - Dependency changes (added / removed)
 *  - Full conversion log with colour-coded severity
 */
export async function generateReport(
  result: BuildResult,
  outputDir: string
): Promise<void> {
  const html = buildHtml(result, outputDir);
  const reportPath = path.join(outputDir, "webtoapp-report.html");
  await fs.mkdir(outputDir, { recursive: true });
  await fs.writeFile(reportPath, html, "utf-8");
}

// ── HTML Builder ──────────────────────────────────────────────────────────────

function buildHtml(result: BuildResult, outputDir: string): string {
  const statusColor = result.status === "success" ? "#22c55e" : "#ef4444";
  const statusIcon  = result.status === "success" ? "✔" : "✖";
  const statusLabel = result.status === "success" ? "SUCCESS" : "FAILED";

  const totalSeconds = ((result.totalDurationMs ?? 0) / 1000).toFixed(1);

  // ── Stage rows ──────────────────────────────────────────────────
  const stageRows = (result.stages ?? []).map((s) => {
    const icon = s.status === "done"      ? "✔" :
                 s.status === "failed"    ? "✖" :
                 s.status === "skipped"   ? "⊘" : "○";
    const color = s.status === "done"      ? "#22c55e" :
                  s.status === "failed"    ? "#ef4444" :
                  s.status === "skipped"   ? "#6b7280" : "#f59e0b";
    const dur = s.durationMs != null ? `${(s.durationMs / 1000).toFixed(1)}s` : "—";
    const errHtml = s.error
      ? `<div style="margin-top:4px;color:#ef4444;font-size:12px;font-family:monospace">${escHtml(s.error)}</div>`
      : "";
    return `
      <tr>
        <td style="color:${color};font-size:18px;text-align:center;padding:6px 12px">${icon}</td>
        <td style="padding:6px 12px;font-weight:500">${escHtml(s.name)}</td>
        <td style="padding:6px 12px;color:#9ca3af;text-align:right">${dur}</td>
        <td style="padding:6px 12px">${escHtml(s.status)}${errHtml}</td>
      </tr>`;
  }).join("");

  // ── Detection summary ───────────────────────────────────────────
  const det = result.detectionResult;
  const detHtml = det ? `
    <div class="card">
      <h2>🔍 Detection</h2>
      <table class="info-table">
        <tr><td>Framework</td><td>${escHtml(det.framework)}</td></tr>
        <tr><td>Bundler</td><td>${escHtml(det.bundler)}</td></tr>
        <tr><td>Backend</td><td>${escHtml(det.backend)}</td></tr>
        <tr><td>Auth</td><td>${escHtml(det.auth)}</td></tr>
        <tr><td>UI Library</td><td>${escHtml(det.uiLibrary)}</td></tr>
        <tr><td>Tables</td><td>${det.tables.length > 0 ? det.tables.map(escHtml).join(", ") : "—"}</td></tr>
        <tr><td>Confidence</td><td>${(det.confidence * 100).toFixed(0)}%</td></tr>
      </table>
    </div>` : "";

  // ── Log entries ─────────────────────────────────────────────────
  const logHtml = (result.logs ?? []).map((entry) => {
    const levelColor = entry.level === "error" ? "#ef4444" :
                       entry.level === "warn"  ? "#f59e0b" :
                       entry.level === "debug" ? "#6b7280" : "#d1d5db";
    const badge = `<span style="color:${levelColor};font-weight:600;text-transform:uppercase;font-size:10px;min-width:40px;display:inline-block">${escHtml(entry.level)}</span>`;
    const stage = entry.stage
      ? `<span style="color:#6366f1;font-size:10px;margin-right:6px">[${escHtml(entry.stage)}]</span>`
      : "";
    return `<div style="padding:2px 0;border-bottom:1px solid #1f2937">${badge} ${stage}<span style="color:#d1d5db">${escHtml(entry.message)}</span></div>`;
  }).join("");

  // ── Low-confidence warning list ─────────────────────────────────
  const lowConfidenceLogs = (result.logs ?? []).filter(
    (e) => e.level === "warn" && e.message.toLowerCase().includes("low confidence")
  );
  const reviewHtml = lowConfidenceLogs.length > 0 ? `
    <div class="card" style="border-color:#f59e0b">
      <h2 style="color:#f59e0b">⚠ Files Needing Manual Review (${lowConfidenceLogs.length})</h2>
      <p style="color:#9ca3af;font-size:13px">These files had low transform confidence and may need manual verification:</p>
      <ul style="margin:8px 0;padding-left:20px">
        ${lowConfidenceLogs.map(e => `<li style="color:#fbbf24;font-family:monospace;font-size:12px">${escHtml(e.message)}</li>`).join("")}
      </ul>
    </div>` : "";

  // ── Installer path ──────────────────────────────────────────────
  const installerHtml = result.installerPath ? `
    <div class="card" style="border-color:#22c55e">
      <h2 style="color:#22c55e">📦 Output Installer</h2>
      <code style="background:#111827;padding:8px 12px;border-radius:6px;display:block;color:#a3e635;font-size:13px">${escHtml(result.installerPath)}</code>
    </div>` : "";

  const errorHtml = result.error ? `
    <div class="card" style="border-color:#ef4444">
      <h2 style="color:#ef4444">✖ Error</h2>
      <pre style="background:#111827;padding:12px;border-radius:6px;color:#fca5a5;font-size:12px;overflow-x:auto;white-space:pre-wrap">${escHtml(result.error)}</pre>
    </div>` : "";

  const generatedAt = new Date().toLocaleString();

  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>WebToApp Migration Report</title>
  <style>
    *, *::before, *::after { box-sizing: border-box; margin: 0; padding: 0; }
    body {
      font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif;
      background: #030712;
      color: #f9fafb;
      padding: 32px 24px;
      min-height: 100vh;
    }
    .container { max-width: 900px; margin: 0 auto; }
    .header {
      display: flex;
      align-items: center;
      gap: 16px;
      padding: 24px;
      background: #0f172a;
      border: 1px solid #1e293b;
      border-radius: 12px;
      margin-bottom: 24px;
    }
    .status-badge {
      display: inline-flex;
      align-items: center;
      gap: 8px;
      padding: 6px 16px;
      border-radius: 9999px;
      font-weight: 700;
      font-size: 14px;
      letter-spacing: 0.05em;
    }
    .card {
      background: #0f172a;
      border: 1px solid #1e293b;
      border-radius: 12px;
      padding: 20px;
      margin-bottom: 16px;
    }
    h2 {
      font-size: 16px;
      font-weight: 600;
      margin-bottom: 12px;
      color: #e2e8f0;
    }
    table { width: 100%; border-collapse: collapse; }
    th {
      text-align: left;
      padding: 6px 12px;
      color: #6b7280;
      font-size: 12px;
      font-weight: 500;
      text-transform: uppercase;
      letter-spacing: 0.05em;
      border-bottom: 1px solid #1e293b;
    }
    td { vertical-align: top; }
    .info-table td { padding: 6px 12px; color: #9ca3af; }
    .info-table td:first-child { color: #6b7280; font-size: 12px; text-transform: uppercase; letter-spacing: 0.05em; width: 140px; }
    .info-table tr:not(:last-child) td { border-bottom: 1px solid #1e293b; }
    .log-container {
      background: #030712;
      border-radius: 8px;
      padding: 12px;
      max-height: 500px;
      overflow-y: auto;
      font-size: 12px;
      line-height: 1.6;
    }
    footer { text-align: center; color: #374151; font-size: 12px; margin-top: 32px; }
  </style>
</head>
<body>
  <div class="container">

    <!-- Header -->
    <div class="header">
      <div style="flex:1">
        <div style="font-size:22px;font-weight:700;color:#f1f5f9;margin-bottom:4px">
          WebToApp Migration Report
        </div>
        <div style="color:#6b7280;font-size:13px">Generated ${escHtml(generatedAt)}</div>
        <div style="color:#6b7280;font-size:13px;margin-top:2px">${escHtml(outputDir)}</div>
      </div>
      <div>
        <span class="status-badge" style="background:${statusColor}20;color:${statusColor};border:1px solid ${statusColor}40">
          ${statusIcon} ${statusLabel}
        </span>
        <div style="text-align:center;color:#6b7280;font-size:12px;margin-top:6px">
          ${escHtml(totalSeconds)}s total
        </div>
      </div>
    </div>

    ${errorHtml}
    ${installerHtml}
    ${reviewHtml}

    <!-- Pipeline Stages -->
    <div class="card">
      <h2>⚙ Pipeline Stages</h2>
      <table>
        <thead>
          <tr>
            <th style="width:40px"></th>
            <th>Stage</th>
            <th style="text-align:right">Duration</th>
            <th>Status</th>
          </tr>
        </thead>
        <tbody>${stageRows}</tbody>
      </table>
    </div>

    ${detHtml}

    <!-- Conversion Log -->
    <div class="card">
      <h2>📋 Conversion Log</h2>
      <div class="log-container">
        ${logHtml || '<span style="color:#4b5563">No log entries</span>'}
      </div>
    </div>

    <footer>
      Generated by <strong>WebToApp</strong> — web to desktop converter
    </footer>
  </div>
</body>
</html>`;
}

function escHtml(str: string): string {
  return String(str)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}
