#!/bin/sh
set -e

echo "Running database migrations..."
npx prisma migrate deploy

echo "Checking whether seed data is needed..."
VIDEO_COUNT=$(node -e "
const { PrismaClient } = require('@prisma/client');
const prisma = new PrismaClient();
prisma.video.count().then((n) => { console.log(n); process.exit(0); }).catch(() => { console.log(0); process.exit(0); });
")

if [ "$VIDEO_COUNT" = "0" ]; then
  echo "No videos found — seeding sample data..."
  npm run prisma:seed
else
  echo "Existing data found ($VIDEO_COUNT videos) — skipping seed."
fi

echo "Starting server..."
exec node dist/index.js
