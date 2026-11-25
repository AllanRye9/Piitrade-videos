FROM node:20-bookworm-slim AS build
WORKDIR /app
COPY package.json package-lock.json* ./
RUN npm install
COPY . .
ARG VITE_API_BASE_URL
ARG VITE_PIITRADE_SITE_URL
ENV VITE_API_BASE_URL=$VITE_API_BASE_URL VITE_PIITRADE_SITE_URL=$VITE_PIITRADE_SITE_URL
RUN npm run build

FROM nginx:1.27-alpine
COPY nginx.conf /etc/nginx/conf.d/default.conf
COPY 40-backend-upstream.sh /docker-entrypoint.d/40-backend-upstream.sh
RUN chmod +x /docker-entrypoint.d/40-backend-upstream.sh
COPY --from=build /app/dist /usr/share/nginx/html
EXPOSE 80

HEALTHCHECK --interval=10s --timeout=5s --start-period=10s --retries=5 \
  CMD wget -q -O /dev/null http://localhost:80/ || exit 1
