import type { CapacitorConfig } from '@capacitor/cli';

const config: CapacitorConfig = {
  appId: 'com.piitrade.videos',
  appName: 'Piitrade Videos',
  webDir: 'dist',
  // Android WebView serves the bundled app from https://localhost.
  // Add that origin to ALLOWED_ORIGIN on the backend (see APK-BUILD.md).
  server: {
    androidScheme: 'https',
  },
  android: {
    allowMixedContent: false,
  },
  plugins: {
    SplashScreen: {
      launchShowDuration: 1200,
      backgroundColor: '#0a0a0a',
      showSpinner: false,
    },
    StatusBar: {
      style: 'DARK',
      backgroundColor: '#0a0a0a',
    },
  },
};

export default config;
