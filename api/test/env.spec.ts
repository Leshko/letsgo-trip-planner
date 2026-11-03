import { dropEmptySettings, pushSubject } from '../src/common/env';

describe('settings from the Unraid Docker tab', () => {
  it('treats empty fields as not set', () => {
    const env: NodeJS.ProcessEnv = {
      VAPID_SUBJECT: '',
      AI_MODEL: '  ',
      ADMIN_KEY: 'keep-me-1234567890',
      DATABASE_URL: '',
    };
    expect(dropEmptySettings(env).sort()).toEqual([
      'AI_MODEL',
      'DATABASE_URL',
      'VAPID_SUBJECT',
    ]);
    expect(env).toEqual({ ADMIN_KEY: 'keep-me-1234567890' });
  });

  it('accepts the push contact in the forms people type, and rejects junk', () => {
    expect(pushSubject(undefined)).toBe('mailto:letsgo@example.com');
    expect(pushSubject('  ')).toBe('mailto:letsgo@example.com');
    expect(pushSubject('mailto:me@example.com')).toBe('mailto:me@example.com');
    expect(pushSubject('me@example.com')).toBe('mailto:me@example.com');
    expect(pushSubject('https://letsgotogether.app')).toBe(
      'https://letsgotogether.app',
    );
    expect(pushSubject('not a contact')).toBeNull();
  });
});
