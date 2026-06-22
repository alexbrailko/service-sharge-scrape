import nodemailer from 'nodemailer';

// Mirrors the SMTP setup used by the Next.js app's contact form
// (src/app/api/send/contact-us/route.ts): same host/port and the same
// INFO_EMAIL / INFO_EMAIL_PASSWORD credentials. `from` must be INFO_EMAIL so the
// message aligns with the sending domain's SPF/DKIM and isn't flagged as spoofed.
export interface MailInput {
  to: string;
  subject: string;
  html: string;
  text?: string;
}

export async function sendMail({ to, subject, html, text }: MailInput): Promise<void> {
  // Fully env-configurable so the SMTP server can be changed without a code change.
  // Falls back to the old INFO_EMAIL creds for backwards-compatibility.
  const host = process.env.SMTP_HOST || 'mail.service-charge.co.uk';
  const port = parseInt(process.env.SMTP_PORT || '587', 10);
  const user = process.env.SMTP_USER || process.env.INFO_EMAIL;
  const pass = process.env.SMTP_PASS || process.env.INFO_EMAIL_PASSWORD;
  const from = process.env.SMTP_FROM || user;

  if (!host || !user || !pass) {
    throw new Error(
      'SMTP not configured — set SMTP_HOST / SMTP_USER / SMTP_PASS (and SMTP_FROM) in the scraper .env'
    );
  }

  const transport = nodemailer.createTransport({
    host,
    port,
    secure: port === 465, // 465 = implicit TLS; 587 = STARTTLS
    auth: { user, pass },
  });

  await transport.sendMail({ from, to, subject, html, text });
}
