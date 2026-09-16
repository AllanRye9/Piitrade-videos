FROM node:20-bookworm-slim

# ffmpeg is required for real poster-frame extraction and (in the seed
# script) generating sample videos. sharp's prebuilt binaries need
# libvips' runtime deps, which this base image already ships with glibc
# for, so no extra libvips install is needed.
RUN apt-get update && apt-get install -y --no-install-recommends \
    ffmpeg \
    openssl \
    && rm -rf /var/lib/apt/lists/*

WORKDIR /app

COPY package.json package-lock.json* ./
RUN npm install

COPY prisma ./prisma
RUN npx prisma generate

COPY tsconfig.json ./
COPY src ./src
RUN npm run build

COPY docker-entrypoint.sh ./
RUN chmod +x docker-entrypoint.sh

RUN mkdir -p uploads/videos uploads/posters uploads/products uploads/avatars

EXPOSE 4000

# Lets `docker ps` and any orchestrator (Compose, Swarm, ECS, Railway,
# Render, etc.) know when the API is actually accepting requests, not
# just that the process has started.
HEALTHCHECK --interval=10s --timeout=5s --start-period=20s --retries=10 \
  CMD node -e "require('http').get('http://localhost:4000/api/health', (r) => process.exit(r.statusCode === 200 ? 0 : 1)).on('error', () => process.exit(1))"

CMD ["./docker-entrypoint.sh"]
