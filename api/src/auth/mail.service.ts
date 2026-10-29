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
    if (!this.transport) {
      const port = Number(process.env.SMTP_PORT ?? 465);
      this.transport = nodemailer.createTransport({
        host: process.env.SMTP_HOST,
        port,
        secure: port === 465,
        auth: process.env.SMTP_USER
          ? { user: process.env.SMTP_USER, pass: process.env.SMTP_PASS ?? '' }
          : undefined,
      });
    }
    try {
      await this.transport.sendMail({ from: this.from(), ...mail });
    } catch (e) {
      this.log.error(`Could not send email: ${String(e)}`);
      throw e;
    }
  }
}
