# syntax=docker/dockerfile:1
# One image for every organisation: nothing org-specific is baked in; all configuration is runtime
# env (see .env.example). Published multi-arch to ghcr.io by .github/workflows/docker.yml.

FROM node:24-slim AS base
ENV PNPM_HOME=/pnpm COREPACK_ENABLE_DOWNLOAD_PROMPT=0
RUN corepack enable
WORKDIR /app
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml ./

FROM base AS build
RUN --mount=type=cache,id=pnpm,target=/pnpm/store pnpm install --frozen-lockfile --store-dir /pnpm/store
COPY . .
RUN pnpm build

# Production dependencies only; sharp's native binary comes from its per-platform package.
FROM base AS prod-deps
RUN --mount=type=cache,id=pnpm,target=/pnpm/store pnpm install --prod --frozen-lockfile --store-dir /pnpm/store

FROM node:24-slim
WORKDIR /app
ENV NODE_ENV=production PORT=3000 DATA_DIR=/data
COPY --from=prod-deps /app/package.json ./
COPY --from=prod-deps /app/node_modules ./node_modules
COPY --from=build /app/dist ./dist
RUN mkdir -p /data && chown node:node /data
USER node
VOLUME ["/data"]
EXPOSE 3000
HEALTHCHECK --interval=30s --timeout=3s --start-period=10s CMD ["node", "-e", "fetch('http://127.0.0.1:'+process.env.PORT+'/healthz').then(r=>process.exit(r.ok?0:1),()=>process.exit(1))"]
CMD ["node", "dist/server/main.js"]
