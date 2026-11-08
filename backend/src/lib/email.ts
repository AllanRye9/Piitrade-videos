/**
 * Minimal, dependency-free transactional email sender. No SMTP/email
 * provider is configured anywhere in this codebase today, so this is
 * built to degrade safely rather than assume one exists:
 *
 * - If RESEND_API_KEY is set, sends via Resend's HTTPS API (a single
 *   fetch call — no SDK/dependency needed for one endpoint).
 * - Otherwise, logs the email to the server console instead of
 *   silently dropping it. This is NOT a production email solution —
 *   it exists so password reset is fully testable and functional
 *   end-to-end before a real provider is wired up, and so a missing
 *   env var fails loudly (in the logs) rather than pretending to have
 *   sent an email nobody will ever receive.
 *
 * Swap in a different provider by changing only sendEmail() below —
 * nothing else in the app needs to know how email actually gets sent.
 */

interface SendEmailInput {
  to: string;
  subject: string;
  html: string;
  text: string;
}

export async function sendEmail(input: SendEmailInput): Promise<void> {
  const apiKey = process.env.RESEND_API_KEY;
  const from = process.env.EMAIL_FROM || 'Piitrade <no-reply@piitrade.com>';

  if (!apiKey) {
    console.warn(
      `[email] RESEND_API_KEY not set — printing email instead of sending it. This must be configured before real users can use password reset.\n` +
        `[email] To: ${input.to}\n[email] Subject: ${input.subject}\n[email] Body:\n${input.text}`
    );
    return;
  }

  const response = await fetch('https://api.resend.com/emails', {
    method: 'POST',
    headers: { Authorization: `Bearer ${apiKey}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ from, to: input.to, subject: input.subject, html: input.html, text: input.text }),
  });

  if (!response.ok) {
    // Logged, not thrown: a delivery failure shouldn't turn into a
    // 500 that also reveals (via timing/error content) whether the
    // recipient's email address exists — see routes/account.ts's
    // forgot-password handler, which always returns success either way.
    console.error(`[email] Resend API error ${response.status}: ${await response.text().catch(() => '')}`);
  }
}
