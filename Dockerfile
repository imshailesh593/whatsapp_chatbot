# Build the admin dashboard (React) first
FROM node:22-slim AS web
WORKDIR /web
COPY web/package*.json ./
RUN npm ci
COPY web ./
RUN npm run build

FROM node:22-slim

RUN apt-get update && apt-get install -y --no-install-recommends openssl ca-certificates \
    && rm -rf /var/lib/apt/lists/*
ENV NODE_ENV=production

WORKDIR /app
COPY package*.json ./
RUN npm ci --include=dev
COPY prisma ./prisma
RUN npx prisma generate
COPY tsconfig.json ./
COPY src ./src
COPY --from=web /web/dist ./web/dist
RUN npm run build && npm prune --omit=dev

ENV WA_SESSION_PATH=/data/wa_auth
VOLUME /data
EXPOSE 3000
CMD ["sh", "-c", "npx prisma migrate deploy && node dist/server.js"]
