import { Controller, Get, Header, NotFoundException } from '@nestjs/common';

/** The phone apps' identifier in both stores. */
export const APP_ID = 'app.letsgotogether';

/** Paths that open in the app when it's installed (invite links, sign-in links, trip pages). */
const APP_PATHS = ['/join/*', '/auth/email*', '/trip', '/trip/*'];

/** Apple Team ID: 10 letters/digits, shown in the Apple Developer account. */
export function appleTeamId(raw = process.env.APPLE_TEAM_ID): string | null {
  const v = (raw ?? '').trim().toUpperCase();
  return /^[A-Z0-9]{10}$/.test(v) ? v : null;
}

/** Android signing-key fingerprints (SHA-256, AA:BB:..). Several may be listed, comma-separated. */
export function androidFingerprints(
  raw = process.env.ANDROID_CERT_SHA256,
): string[] {
  return (raw ?? '')
    .split(/[,\s]+/)
    .map((f) => f.trim().toUpperCase())
    .filter((f) => /^([0-9A-F]{2}:){31}[0-9A-F]{2}$/.test(f));
}

/**
 * Files Apple and Google fetch to confirm the apps may open links on this
 * address. Served only once the matching setting is filled in.
 */
@Controller('.well-known')
export class AppLinksController {
  @Get('apple-app-site-association')
  @Header('Content-Type', 'application/json')
  @Header('Cache-Control', 'public, max-age=3600')
  apple() {
    const team = appleTeamId();
    if (!team) throw new NotFoundException();
    const appID = `${team}.${APP_ID}`;
    return {
      applinks: {
        details: [
          { appIDs: [appID], components: APP_PATHS.map((p) => ({ '/': p })) },
        ],
      },
      webcredentials: { apps: [appID] },
    };
  }

  @Get('assetlinks.json')
  @Header('Cache-Control', 'public, max-age=3600')
  android() {
    const prints = androidFingerprints();
    if (!prints.length) throw new NotFoundException();
    return [
      {
        relation: ['delegate_permission/common.handle_all_urls'],
        target: {
          namespace: 'android_app',
          package_name: APP_ID,
          sha256_cert_fingerprints: prints,
        },
      },
    ];
  }
}
