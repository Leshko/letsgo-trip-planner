import { smtpOptions } from '../src/auth/mail.service';

describe('email settings', () => {
  const saved = { ...process.env };
  afterEach(() => {
    process.env = { ...saved };
  });

  it('needs only the host and key for Resend', () => {
    Object.assign(process.env, {
      SMTP_HOST: 'smtp.resend.com',
      SMTP_PASS: 're_abc',
      SMTP_PORT: '',
      SMTP_USER: '',
    });
    expect(smtpOptions()).toEqual({
      host: 'smtp.resend.com',
      port: 465,
      secure: true,
      auth: { user: 'resend', pass: 're_abc' },
    });
  });

  it('uses whatever is set for other providers', () => {
    Object.assign(process.env, {
      SMTP_HOST: 'smtp.example.com',
      SMTP_PASS: 'pw',
      SMTP_PORT: '587',
      SMTP_USER: 'me',
    });
    expect(smtpOptions()).toEqual({
      host: 'smtp.example.com',
      port: 587,
      secure: false,
      auth: { user: 'me', pass: 'pw' },
    });
  });
});
