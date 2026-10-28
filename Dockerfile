# Build the admin dashboard (React) first
FROM node:22-slim AS web
WORKDIR /web
COPY web/package*.json ./
RUN npm ci
COPY web ./
RUN npm run build

FROM node:22-slim

# System Chromium for whatsapp-web.js (puppeteer's bundled download is skipped)
RUN apt-get update && apt-get install -y --no-install-recommends \
      chromium fonts-liberation openssl ca-certificates \
    && rm -rf /var/lib/apt/lists/*
ENV PUPPETEER_SKIP_DOWNLOAD=true \
    PUPPETEER_EXECUTABLE_PATH=/usr/bin/chromium \
    NODE_ENV=production

WORKDIR /app
COPY package*.json ./
RUN npm ci --include=dev
COPY prisma ./prisma
RUN npx prisma generate
COPY tsconfig.json ./
COPY src ./src
COPY --from=web /web/dist ./web/dist
RUN npm run build && npm prune --omit=dev

ENV WA_SESSION_PATH=/data/wwebjs_auth
VOLUME /data
EXPOSE 3000
CMD ["sh", "-c", "npx prisma migrate deploy && node dist/server.js"]
