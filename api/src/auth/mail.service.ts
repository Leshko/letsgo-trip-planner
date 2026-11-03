import { Injectable, Logger } from '@nestjs/common';
import { appendFileSync } from 'fs';
import nodemailer, { Transporter } from 'nodemailer';

export interface OutgoingMail {
  to: string;
  subject: string;
  text: string;
  html: string;
}

/** Test/dev only: MAIL_DEV_OUTBOX=memory keeps mail here instead of sending it. */
export const devOutbox: OutgoingMail[] = [];

/**
 * Sends email through any SMTP service (Resend: host smtp.resend.com, port 465,
 * user "resend", password = API key). Off when not configured.
 */
@Injectable()
export class MailService {
  private readonly log = new Logger('Mail');
  private transport: Transporter | null = null;

  get configured(): boolean {
    return (
      !!this.devTarget() || (!!process.env.SMTP_HOST?.trim() && !!this.from())
    );
  }

  private devTarget(): string {
    return process.env.MAIL_DEV_OUTBOX?.trim() ?? '';
  }

  private from(): string {
    return process.env.MAIL_FROM?.trim() ?? '';
  }

  async send(mail: OutgoingMail): Promise<void> {
    const dev = this.devTarget();
    if (dev) {
      if (dev === 'memory') devOutbox.push(mail);
      else appendFileSync(dev, JSON.stringify(mail) + '\n');
      return;
    }
    if (!this.transport)
      this.transport = nodemailer.createTransport(smtpOptions());
    try {
      await this.transport.sendMail({ from: this.from(), ...mail });
    } catch (e) {
      this.log.error(`Could not send email: ${String(e)}`);
      throw e;
    }
  }
}

/**
 * SMTP settings from the environment. Empty values (the Docker tab passes
 * blank fields through) count as unset, and Resend needs only the host and
 * the API key: its port (465) and user ("resend") are filled in.
 */
export function smtpOptions() {
  const host = process.env.SMTP_HOST?.trim() ?? '';
  const resend = /(^|\.)resend\.com$/i.test(host);
  const port = Number(process.env.SMTP_PORT?.trim()) || 465;
  const user = process.env.SMTP_USER?.trim() || (resend ? 'resend' : '');
  return {
    host,
    port,
    secure: port === 465,
    auth: user
      ? { user, pass: process.env.SMTP_PASS?.trim() ?? '' }
      : undefined,
  };
}
