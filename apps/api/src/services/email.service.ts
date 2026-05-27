/**
 * Email service — sends transactional emails on job completion / failure.
 *
 * Priority:
 *   1. Nodemailer via SMTP  (when SMTP_HOST is set)
 *   2. Resend REST API      (when RESEND_API_KEY is set)
 *   3. Console-log fallback (when neither is configured — useful in dev)
 */

import { env } from "../config/env.js";

// ─── Nodemailer (lazy import — only when SMTP is configured) ─────────────────

let _transporter: import("nodemailer").Transporter | null = null;

async function getTransporter(): Promise<import("nodemailer").Transporter | null> {
  if (!env.SMTP_HOST) return null;
  if (_transporter) return _transporter;

  try {
    const nodemailer = await import("nodemailer");
    _transporter = nodemailer.createTransport({
      host: env.SMTP_HOST,
      port: env.SMTP_PORT,
      secure: env.SMTP_PORT === 465,
      auth: env.SMTP_USER && env.SMTP_PASS
        ? { user: env.SMTP_USER, pass: env.SMTP_PASS }
        : undefined,
    });
    return _transporter;
  } catch {
    console.warn("[email] nodemailer not available — skipping SMTP transport");
    return null;
  }
}

// ─── Low-level send ──────────────────────────────────────────────────────────

interface MailPayload {
  to: string;
  subject: string;
  html: string;
  text: string;
}

async function sendMail(payload: MailPayload): Promise<void> {
  // 1. Try SMTP via nodemailer
  const transporter = await getTransporter();
  if (transporter) {
    await transporter.sendMail({
      from: env.SMTP_FROM,
      ...payload,
    });
    return;
  }

  // 2. Try Resend REST API
  if (env.RESEND_API_KEY) {
    const res = await fetch("https://api.resend.com/emails", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${env.RESEND_API_KEY}`,
      },
      body: JSON.stringify({
        from: env.SMTP_FROM,
        to: [payload.to],
        subject: payload.subject,
        html: payload.html,
        text: payload.text,
      }),
    });
    if (!res.ok) {
      const body = await res.text().catch(() => "");
      console.error(`[email] Resend API error ${res.status}: ${body}`);
    }
    return;
  }

  // 3. Dev fallback — log to console
  console.log(
    `[email] No transport configured. Would have sent:\n` +
    `  To: ${payload.to}\n  Subject: ${payload.subject}`
  );
}

// ─── Email templates ─────────────────────────────────────────────────────────

function successHtml(jobName: string, platforms: string[], dashboardUrl: string): string {
  const platformList = platforms.map(p => `<li>${p}</li>`).join("");
  return `
<!DOCTYPE html>
<html>
<head><meta charset="utf-8"><title>Build Complete</title></head>
<body style="font-family:system-ui,sans-serif;background:#0a0a0a;color:#e4e4e7;padding:40px 20px">
  <div style="max-width:560px;margin:0 auto;background:#18181b;border:1px solid #27272a;border-radius:12px;overflow:hidden">
    <div style="background:linear-gradient(135deg,#4f46e5,#7c3aed);padding:32px 24px">
      <h1 style="margin:0;font-size:22px;color:#fff">✅ Build Successful</h1>
      <p style="margin:8px 0 0;color:rgba(255,255,255,0.8);font-size:14px">${jobName}</p>
    </div>
    <div style="padding:24px">
      <p style="color:#a1a1aa;font-size:14px">Your conversion pipeline completed successfully for the following platforms:</p>
      <ul style="color:#e4e4e7;font-size:15px;line-height:1.8">
        ${platformList}
      </ul>
      <a href="${dashboardUrl}" style="display:inline-block;margin-top:16px;padding:12px 24px;background:#4f46e5;color:#fff;text-decoration:none;border-radius:8px;font-size:14px;font-weight:600">
        Download Artifacts →
      </a>
    </div>
    <div style="padding:16px 24px;border-top:1px solid #27272a">
      <p style="margin:0;font-size:12px;color:#52525b">You're receiving this because you started a build on Web-to-App.</p>
    </div>
  </div>
</body>
</html>`;
}

function failureHtml(jobName: string, errorMessage: string, dashboardUrl: string): string {
  return `
<!DOCTYPE html>
<html>
<head><meta charset="utf-8"><title>Build Failed</title></head>
<body style="font-family:system-ui,sans-serif;background:#0a0a0a;color:#e4e4e7;padding:40px 20px">
  <div style="max-width:560px;margin:0 auto;background:#18181b;border:1px solid #27272a;border-radius:12px;overflow:hidden">
    <div style="background:linear-gradient(135deg,#dc2626,#991b1b);padding:32px 24px">
      <h1 style="margin:0;font-size:22px;color:#fff">✖ Build Failed</h1>
      <p style="margin:8px 0 0;color:rgba(255,255,255,0.8);font-size:14px">${jobName}</p>
    </div>
    <div style="padding:24px">
      <p style="color:#a1a1aa;font-size:14px">Unfortunately your conversion pipeline encountered an error:</p>
      <pre style="background:#0a0a0a;border:1px solid #27272a;border-radius:8px;padding:16px;font-size:13px;color:#f87171;overflow:auto;white-space:pre-wrap">${errorMessage}</pre>
      <a href="${dashboardUrl}" style="display:inline-block;margin-top:16px;padding:12px 24px;background:#4f46e5;color:#fff;text-decoration:none;border-radius:8px;font-size:14px;font-weight:600">
        View Details &amp; Retry →
      </a>
    </div>
    <div style="padding:16px 24px;border-top:1px solid #27272a">
      <p style="margin:0;font-size:12px;color:#52525b">You're receiving this because you started a build on Web-to-App.</p>
    </div>
  </div>
</body>
</html>`;
}

// ─── Public API ──────────────────────────────────────────────────────────────

const DASHBOARD_URL = (env as any).DASHBOARD_URL ?? "http://localhost:3000";

export async function sendBuildComplete(
  to: string,
  jobName: string,
  jobId: string,
  platforms: string[]
): Promise<void> {
  const jobUrl = `${DASHBOARD_URL}/jobs/${jobId}`;
  await sendMail({
    to,
    subject: `✅ Build complete: ${jobName}`,
    html: successHtml(jobName, platforms, jobUrl),
    text: [
      `Build complete: ${jobName}`,
      `Platforms: ${platforms.join(", ")}`,
      `View and download your artifacts at: ${jobUrl}`,
    ].join("\n"),
  }).catch((err) => {
    console.error(`[email] Failed to send completion email to ${to}:`, err);
  });
}

export async function sendBuildFailed(
  to: string,
  jobName: string,
  jobId: string,
  errorMessage: string
): Promise<void> {
  const jobUrl = `${DASHBOARD_URL}/jobs/${jobId}`;
  await sendMail({
    to,
    subject: `✖ Build failed: ${jobName}`,
    html: failureHtml(jobName, errorMessage, jobUrl),
    text: [
      `Build failed: ${jobName}`,
      `Error: ${errorMessage}`,
      `View details at: ${jobUrl}`,
    ].join("\n"),
  }).catch((err) => {
    console.error(`[email] Failed to send failure email to ${to}:`, err);
  });
}
