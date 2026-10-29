import { INestApplication } from '@nestjs/common';
import { randomUUID } from 'crypto';
import { AuthService } from '../src/auth/auth.service';

/** Sign in a (new) account directly and return the header the app sends. */
export async function organizer(
  app: INestApplication,
  email = `organizer-${randomUUID()}@example.com`,
): Promise<{ 'X-Account': string }> {
  const { token } = await app.get(AuthService).signInByEmail(email);
  return { 'X-Account': token };
}
