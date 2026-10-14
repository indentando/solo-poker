# Imagen de producción: un único proceso Node sirve la web compilada y el Socket.IO.

# ─── 1. Compilar la web ────────────────────────────────────────
FROM node:22-slim AS web
WORKDIR /app

# Primero solo los manifiestos, para aprovechar la caché de capas de Docker.
COPY package.json package-lock.json ./
COPY packages/engine/package.json packages/engine/
COPY packages/protocol/package.json packages/protocol/
COPY apps/server/package.json apps/server/
COPY apps/web/package.json apps/web/
RUN npm ci --no-audit --no-fund

COPY tsconfig.base.json ./
COPY packages packages
COPY apps/web apps/web
RUN npm run build -w @solo-poker/web

# ─── 2. Imagen final: solo el servidor y sus dependencias ──────
FROM node:22-slim
ENV NODE_ENV=production \
    PORT=8080 \
    HOST=0.0.0.0 \
    STATIC_DIR=/app/public
WORKDIR /app

COPY package.json package-lock.json ./
COPY packages/engine/package.json packages/engine/
COPY packages/protocol/package.json packages/protocol/
COPY apps/server/package.json apps/server/
COPY apps/web/package.json apps/web/
RUN npm ci --omit=dev --no-audit --no-fund -w @solo-poker/server && npm cache clean --force

COPY tsconfig.base.json ./
COPY packages/engine/src packages/engine/src
COPY packages/protocol/src packages/protocol/src
COPY apps/server/tsconfig.json apps/server/
COPY apps/server/src apps/server/src
COPY --from=web /app/apps/web/dist/web/browser public

USER node
EXPOSE 8080
CMD ["node", "--import", "tsx", "apps/server/src/main.ts"]
