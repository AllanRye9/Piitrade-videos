#!/usr/bin/env bash
# Builds a debug APK. Requires: Node 18+, JDK 17, Android SDK (ANDROID_HOME set).
set -euo pipefail
cd "$(dirname "$0")/frontend"
if [ ! -f .env.production ]; then
  echo "Missing frontend/.env.production - copy .env.production.example and set VITE_API_BASE_URL" >&2
  exit 1
fi
npm ci
npm run cap:sync
(cd android && chmod +x gradlew && ./gradlew assembleDebug)
echo
echo "APK: frontend/android/app/build/outputs/apk/debug/app-debug.apk"
