const RESEND_API_KEY = process.env["RESEND_API_KEY"];
const FROM_EMAIL = process.env["FROM_EMAIL"] ?? "WebToApp <noreply@webtoapp.dev>";
const APP_URL = process.env["APP_URL"] ?? "https://webtoapp.dev";

/**
 * Email notification service — uses Resend (https://resend.com).
 *
 * Falls back to console.log in development when RESEND_API_KEY is not set.
 *
 * Sends:
 *  - Conversion complete (with download link)
 *  - Conversion failed (with error details)
 *  - Welcome email on registration
 *  - Payment failed warning
 *  - Plan upgrade confirmation
 */
export class NotificationService {
  private async send(params: {
    to: string;
    subject: string;
    html: string;
    text: string;
  }): Promise<void> {
    if (!RESEND_API_KEY) {
      console.log(`[email] DEV — To: ${params.to} | Subject: ${params.subject}`);
      return;
    }

    const res = await fetch("https://api.resend.com/emails", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${RESEND_API_KEY}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        from: FROM_EMAIL,
        to: [params.to],
        subject: params.subject,
        html: params.html,
        text: params.text,
      }),
    });

    if (!res.ok) {
      const body = await res.text();
      console.error(`[email] Failed to send to ${params.to}: ${res.status} ${body}`);
    }
  }

  // ── Conversion complete ──────────────────────────────────────────────────────

  async sendConversionComplete(params: {
    to: string;
    userName?: string;
    conversionName: string;
    conversionId: string;
    durationMs: number;
    targets: string[];
  }): Promise<void> {
    const { to, userName, conversionName, conversionId, durationMs, targets } = params;
    const name = userName ?? "there";
    const duration = this.formatDuration(durationMs);
    const downloadUrl = `${APP_URL}/conversions/${conversionId}`;

    await this.send({
      to,
      subject: `✅ Your app "${conversionName}" is ready to download`,
      html: `
        <div style="font-family:sans-serif;max-width:560px;margin:0 auto;padding:32px 24px">
          <h1 style="font-size:24px;color:#1a1a1a;margin-bottom:8px">Your app is ready!</h1>
          <p style="color:#555;margin-bottom:24px">Hi ${name},</p>
          <p style="color:#555">
            <strong>${conversionName}</strong> has been successfully converted to a desktop app
            for <strong>${targets.join(", ")}</strong> in ${duration}.
          </p>
          <div style="margin:32px 0">
            <a href="${downloadUrl}"
               style="background:#6366f1;color:#fff;padding:12px 24px;border-radius:8px;text-decoration:none;font-weight:600;display:inline-block">
              Download Installer →
            </a>
          </div>
          <p style="color:#999;font-size:13px">
            Download link expires in 1 hour. You can always generate a new one from your dashboard.
          </p>
          <hr style="border:none;border-top:1px solid #eee;margin:32px 0">
          <p style="color:#bbb;font-size:12px">
            WebToApp · <a href="${APP_URL}/unsubscribe" style="color:#bbb">Unsubscribe</a>
          </p>
        </div>
      `,
      text: `Hi ${name},\n\n${conversionName} has been converted successfully in ${duration}.\n\nDownload: ${downloadUrl}\n\nThe link expires in 1 hour.`,
    });
  }

  // ── Conversion failed ────────────────────────────────────────────────────────

  async sendConversionFailed(params: {
    to: string;
    userName?: string;
    conversionName: string;
    conversionId: string;
    errorMessage: string;
  }): Promise<void> {
    const { to, userName, conversionName, conversionId, errorMessage } = params;
    const name = userName ?? "there";
    const dashboardUrl = `${APP_URL}/conversions/${conversionId}`;

    await this.send({
      to,
      subject: `❌ Conversion failed: "${conversionName}"`,
      html: `
        <div style="font-family:sans-serif;max-width:560px;margin:0 auto;padding:32px 24px">
          <h1 style="font-size:24px;color:#1a1a1a;margin-bottom:8px">Conversion failed</h1>
          <p style="color:#555">Hi ${name},</p>
          <p style="color:#555">
            We were unable to convert <strong>${conversionName}</strong> to a desktop app.
          </p>
          <div style="background:#fff5f5;border:1px solid #fecaca;border-radius:8px;padding:16px;margin:24px 0">
            <p style="color:#dc2626;font-family:monospace;font-size:13px;margin:0;white-space:pre-wrap">${errorMessage}</p>
          </div>
          <p style="color:#555">Common causes:</p>
          <ul style="color:#555;line-height:1.8">
            <li>The repository uses an unsupported framework</li>
            <li>Build errors in the source project</li>
            <li>Missing environment variables in the source code</li>
          </ul>
          <div style="margin:24px 0">
            <a href="${dashboardUrl}"
               style="background:#6366f1;color:#fff;padding:12px 24px;border-radius:8px;text-decoration:none;font-weight:600;display:inline-block">
              View Details →
            </a>
          </div>
          <p style="color:#999;font-size:13px">
            Credits for failed conversions are automatically refunded to your account.
          </p>
        </div>
      `,
      text: `Hi ${name},\n\nConversion of "${conversionName}" failed.\n\nError: ${errorMessage}\n\nView details: ${dashboardUrl}`,
    });
  }

  // ── Welcome ──────────────────────────────────────────────────────────────────

  async sendWelcome(params: { to: string; userName?: string }): Promise<void> {
    const { to, userName } = params;
    const name = userName ?? "there";

    await this.send({
      to,
      subject: "Welcome to WebToApp 🚀",
      html: `
        <div style="font-family:sans-serif;max-width:560px;margin:0 auto;padding:32px 24px">
          <h1 style="font-size:24px;color:#1a1a1a;margin-bottom:8px">Welcome to WebToApp!</h1>
          <p style="color:#555">Hi ${name},</p>
          <p style="color:#555">
            You're all set. Start converting your web apps to desktop apps in minutes.
          </p>
          <div style="margin:32px 0;display:flex;flex-direction:column;gap:12px">
            <div style="background:#f9f9f9;border-radius:8px;padding:16px">
              <strong style="display:block;margin-bottom:4px">1. Install the CLI</strong>
              <code style="color:#6366f1">npx webtoapp login</code>
            </div>
            <div style="background:#f9f9f9;border-radius:8px;padding:16px">
              <strong style="display:block;margin-bottom:4px">2. In your project directory</strong>
              <code style="color:#6366f1">npx webtoapp convert</code>
            </div>
          </div>
          <a href="${APP_URL}/conversions/new"
             style="background:#6366f1;color:#fff;padding:12px 24px;border-radius:8px;text-decoration:none;font-weight:600;display:inline-block">
            Start converting →
          </a>
        </div>
      `,
      text: `Hi ${name},\n\nWelcome to WebToApp!\n\nGet started:\n  npx webtoapp login\n  npx webtoapp convert\n\nDashboard: ${APP_URL}`,
    });
  }

  // ── Payment failed ───────────────────────────────────────────────────────────

  async sendPaymentFailed(params: { to: string; userName?: string }): Promise<void> {
    const { to, userName } = params;
    const name = userName ?? "there";
    const billingUrl = `${APP_URL}/billing`;

    await this.send({
      to,
      subject: "⚠️ Payment failed — action required",
      html: `
        <div style="font-family:sans-serif;max-width:560px;margin:0 auto;padding:32px 24px">
          <h1 style="font-size:24px;color:#1a1a1a;margin-bottom:8px">Payment failed</h1>
          <p style="color:#555">Hi ${name},</p>
          <p style="color:#555">
            We were unable to process your subscription payment. Your account will remain active
            for a short grace period, but please update your payment method to avoid interruption.
          </p>
          <div style="margin:24px 0">
            <a href="${billingUrl}"
               style="background:#dc2626;color:#fff;padding:12px 24px;border-radius:8px;text-decoration:none;font-weight:600;display:inline-block">
              Update payment method →
            </a>
          </div>
        </div>
      `,
      text: `Hi ${name},\n\nYour payment failed. Update your payment method: ${billingUrl}`,
    });
  }

  // ── Plan upgraded ────────────────────────────────────────────────────────────

  async sendPlanUpgraded(params: {
    to: string;
    userName?: string;
    plan: string;
  }): Promise<void> {
    const { to, userName, plan } = params;
    const name = userName ?? "there";

    await this.send({
      to,
      subject: `🎉 You're now on the ${plan} plan`,
      html: `
        <div style="font-family:sans-serif;max-width:560px;margin:0 auto;padding:32px 24px">
          <h1 style="font-size:24px;color:#1a1a1a">You're on ${plan}!</h1>
          <p style="color:#555">Hi ${name},</p>
          <p style="color:#555">
            Your account has been upgraded to <strong>${plan}</strong>.
            Enjoy higher limits and priority build queues.
          </p>
          <a href="${APP_URL}/conversions/new"
             style="background:#6366f1;color:#fff;padding:12px 24px;border-radius:8px;text-decoration:none;font-weight:600;display:inline-block;margin-top:16px">
            Start a conversion →
          </a>
        </div>
      `,
      text: `Hi ${name},\n\nYou're now on the ${plan} plan. Enjoy!\n\nDashboard: ${APP_URL}`,
    });
  }

  // ── Helpers ──────────────────────────────────────────────────────────────────

  private formatDuration(ms: number): string {
    if (ms < 60_000) return `${Math.round(ms / 1000)}s`;
    const mins = Math.floor(ms / 60_000);
    const secs = Math.round((ms % 60_000) / 1000);
    return secs > 0 ? `${mins}m ${secs}s` : `${mins}m`;
  }
}

export const notificationService = new NotificationService();
