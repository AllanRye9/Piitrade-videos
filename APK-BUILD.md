# Piitrade Videos – Android APK packaging

The frontend (React + Vite) is wrapped with **Capacitor 6**. The `frontend/android/` folder is a complete native Android project (app id `com.piitrade.videos`) that bundles the built web app. The backend is **not** inside the APK – it must be deployed on a public HTTPS URL.

## 1. Before you build
1. Deploy the backend (see main README / docker-compose) on HTTPS, e.g. `https://yotweek.com`.
2. Allow the app's WebView origin on the backend. In `.env` set:
   `ALLOWED_ORIGIN=https://yotweek.com,https://localhost`
   (`https://localhost` is the origin Android Capacitor apps use. If `ALLOWED_ORIGIN` is unset, all origins are allowed.)
3. `cd frontend && cp .env.production.example .env.production` and set `VITE_API_BASE_URL` to the backend URL.

## 2. Build a debug APK (install/test on a phone)
Requirements: Node 18+, JDK 17, Android SDK (Android Studio installs it).

    ./build-apk.sh

Output: `frontend/android/app/build/outputs/apk/debug/app-debug.apk`
Install: `adb install -r app-debug.apk` or copy the file to the phone.

No local tooling? Set the repository variable `VITE_API_BASE_URL`. GitHub Actions builds the debug APK on pushes and pull requests targeting `main`, on `v*` tags, and when manually run via **Actions > Build Android APK**. Download the APK from the run's artifacts.

## 3. Android Studio route
    cd frontend && npm ci && npm run cap:sync && npm run cap:open
Then Build > Build APK(s).

## 4. Signed release (Play Store / distribution)
    keytool -genkey -v -keystore piitrade.jks -alias piitrade -keyalg RSA -keysize 2048 -validity 10000
Configure signing in Android Studio (Build > Generate Signed Bundle/APK) or in `frontend/android/app/build.gradle`, then:
    cd frontend && npm run aab:release      # Play Store .aab
    cd frontend && npm run apk:release      # signed .apk
Keep the keystore and its passwords safe and out of git.

## Useful scripts (frontend/package.json)
| Script | Purpose |
|---|---|
| `npm run cap:sync` | Build web app and copy into the Android project |
| `npm run cap:assets` | Regenerate icons/splash from `frontend/resources/` |
| `npm run cap:open` | Open project in Android Studio |
| `npm run apk:debug` | Sync and build debug APK |

## Notes
- Service worker registration is skipped inside the app (assets are local).
- Orientation is locked to portrait, matching the web manifest.
- Video upload uses the standard file picker; no extra permissions are required.
- Fonts load from Google Fonts at runtime (needs internet). Bundle Manrope locally if you need offline start-up.
- Change app id/name in `frontend/capacitor.config.ts` (then `npx cap sync`).
- `screenshots/` holds mobile (390x844 @2x) and desktop (1440x900) captures taken with mocked API data.
