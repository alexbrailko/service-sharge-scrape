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
  if (!process.env.INFO_EMAIL || !process.env.INFO_EMAIL_PASSWORD) {
    throw new Error(
      'INFO_EMAIL / INFO_EMAIL_PASSWORD not set — add them to the scraper .env'
    );
  }

  const transport = nodemailer.createTransport({
    host: 'mail.service-charge.co.uk',
    port: 587,
    auth: {
      user: process.env.INFO_EMAIL,
      pass: process.env.INFO_EMAIL_PASSWORD,
    },
  });

  await transport.sendMail({
    from: process.env.INFO_EMAIL,
    to,
    subject,
    html,
    text,
  });
}
