FROM node:20-bookworm-slim

WORKDIR /app

COPY package.json package-lock.json* ./
RUN npm install --omit=dev

COPY worker.js ./

EXPOSE 8787

HEALTHCHECK --interval=10s --timeout=5s --start-period=10s --retries=10 \
  CMD node -e "require('http').get('http://localhost:8787/health', (r) => process.exit(r.statusCode === 200 ? 0 : 1)).on('error', () => process.exit(1))"

CMD ["node", "worker.js"]
