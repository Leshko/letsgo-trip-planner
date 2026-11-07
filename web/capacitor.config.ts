import type { CapacitorConfig } from '@capacitor/cli';

/**
 * The iPhone and Android apps: the same Angular app (dist/web/browser)
 * inside a native shell, talking to https://letsgotogether.app.
 */
const config: CapacitorConfig = {
  appId: 'app.letsgotogether',
  appName: 'LetsGo Together',
  webDir: 'dist/web/browser',
  android: {
    // Keeps family-map updates flowing while the app is in the background.
    useLegacyBridge: true,
  },
  plugins: {
    SplashScreen: { launchShowDuration: 600, backgroundColor: '#ffffff', showSpinner: false },
    PushNotifications: { presentationOptions: ['badge', 'sound', 'alert'] },
  },
};

export default config;
