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

RUN mkdir -p uploads/videos uploads/posters uploads/products

EXPOSE 4000

CMD ["./docker-entrypoint.sh"]
