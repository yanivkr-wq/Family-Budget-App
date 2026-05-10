/**
 * Notification channel adapters.
 *
 * Each channel exposes one async `send` function. Returns a normalized result:
 *   { ok: true }                — delivered (or accepted by provider)
 *   { ok: false, skipped, reason } — channel not configured / no contact info
 *   { ok: false, error }        — provider returned an error
 *
 * The dispatcher in `cron/notifications.ts` calls each enabled channel in
 * sequence and writes the outcome back to notification_event.state.
 *
 * Provider choices:
 *   • Email    = nodemailer SMTP. Works with any SMTP server (Gmail w/
 *     app-password, Sendgrid SMTP relay, Mailgun, AWS SES, self-hosted
 *     postfix). All config via SMTP_* env vars. If host/user/pass missing,
 *     channel skips with a clear message.
 *   • WhatsApp = Twilio HTTP API. Direct fetch — no SDK needed. Requires
 *     TWILIO_ACCOUNT_SID, TWILIO_AUTH_TOKEN, TWILIO_WHATSAPP_FROM, plus the
 *     recipient's user.phone_e164. Sandbox numbers must be added to the
 *     "approved" list in Twilio console first.
 *   • In-app = no external call; the cron writes the event row directly and
 *     the bell dropdown polls for it. This adapter is a no-op (returns ok).
 */

import nodemailer from 'nodemailer';
import type { Config } from '../config';

export type ChannelOutcome =
  | { ok: true }
  | { ok: false; skipped: true; reason: string }
  | { ok: false; skipped?: false; error: string };

export interface ChannelMessage {
  /** Recipient email (when channel = email). */
  toEmail?: string | null;
  /** Recipient phone in E.164, no 'whatsapp:' prefix (we add it). */
  toPhone?: string | null;
  /** Subject / push title. */
  title: string;
  /** Plain-text body. */
  body: string;
}

// ── In-app channel (no-op) ───────────────────────────────────────────────────
// The "delivery" for in-app IS just writing to notification_event with
// state='sent' — the bell dropdown reads from that table. This adapter exists
// for API symmetry; the dispatcher could special-case in-app, but uniformity
// is easier to reason about.
export async function sendInApp(_msg: ChannelMessage): Promise<ChannelOutcome> {
  return { ok: true };
}

// ── Email channel (nodemailer SMTP) ──────────────────────────────────────────
let cachedTransporter: nodemailer.Transporter | null = null;

function getTransporter(config: Config): nodemailer.Transporter | null {
  if (cachedTransporter) return cachedTransporter;
  if (!config.SMTP_HOST || !config.SMTP_USER || !config.SMTP_PASS) return null;
  cachedTransporter = nodemailer.createTransport({
    host: config.SMTP_HOST,
    port: config.SMTP_PORT ?? 587,
    secure: config.SMTP_SECURE ?? false, // STARTTLS by default
    auth: { user: config.SMTP_USER, pass: config.SMTP_PASS },
  });
  return cachedTransporter;
}

export async function sendEmail(
  msg: ChannelMessage,
  config: Config,
): Promise<ChannelOutcome> {
  const transporter = getTransporter(config);
  if (!transporter) {
    return { ok: false, skipped: true, reason: 'SMTP not configured' };
  }
  if (!msg.toEmail) {
    return { ok: false, skipped: true, reason: 'recipient has no email' };
  }
  const from = config.SMTP_FROM ?? config.SMTP_USER ?? 'noreply@family-budget.local';
  try {
    await transporter.sendMail({
      from,
      to: msg.toEmail,
      subject: msg.title,
      text: msg.body,
      // Light HTML wrapper — most clients render plain text, but a basic
      // HTML body looks less spammy and supports RTL Hebrew correctly.
      html: `<!doctype html><html dir="rtl" lang="he"><body style="font-family: system-ui, -apple-system, Arial, sans-serif; line-height: 1.5;">
<h2 style="margin: 0 0 12px;">${escapeHtml(msg.title)}</h2>
<p style="white-space: pre-wrap; margin: 0;">${escapeHtml(msg.body)}</p>
</body></html>`,
    });
    return { ok: true };
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : String(err) };
  }
}

// ── WhatsApp channel (Twilio HTTP API) ───────────────────────────────────────
export async function sendWhatsApp(
  msg: ChannelMessage,
  config: Config,
): Promise<ChannelOutcome> {
  if (!config.TWILIO_ACCOUNT_SID || !config.TWILIO_AUTH_TOKEN || !config.TWILIO_WHATSAPP_FROM) {
    return { ok: false, skipped: true, reason: 'Twilio not configured' };
  }
  if (!msg.toPhone) {
    return { ok: false, skipped: true, reason: 'recipient has no phone' };
  }
  // Twilio convention: WhatsApp numbers prefixed with 'whatsapp:' on both From and To.
  const to = msg.toPhone.startsWith('whatsapp:') ? msg.toPhone : `whatsapp:${msg.toPhone}`;
  const from = config.TWILIO_WHATSAPP_FROM.startsWith('whatsapp:')
    ? config.TWILIO_WHATSAPP_FROM
    : `whatsapp:${config.TWILIO_WHATSAPP_FROM}`;

  // Twilio's Messages endpoint expects application/x-www-form-urlencoded.
  const url = `https://api.twilio.com/2010-04-01/Accounts/${config.TWILIO_ACCOUNT_SID}/Messages.json`;
  const auth = Buffer.from(`${config.TWILIO_ACCOUNT_SID}:${config.TWILIO_AUTH_TOKEN}`).toString('base64');
  const body = new URLSearchParams({
    From: from,
    To: to,
    // WhatsApp messages have a 1600-char limit; truncate gently if needed.
    Body: `*${msg.title}*\n${msg.body}`.slice(0, 1500),
  });

  try {
    const res = await fetch(url, {
      method: 'POST',
      headers: {
        Authorization: `Basic ${auth}`,
        'Content-Type': 'application/x-www-form-urlencoded',
      },
      body: body.toString(),
    });
    if (!res.ok) {
      const text = await res.text().catch(() => '<no body>');
      return { ok: false, error: `Twilio ${res.status}: ${text.slice(0, 200)}` };
    }
    return { ok: true };
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : String(err) };
  }
}

// ── Helpers ─────────────────────────────────────────────────────────────────
function escapeHtml(s: string): string {
  return s
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}
