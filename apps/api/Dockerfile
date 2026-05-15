# ── Stage 1: Build ────────────────────────────────────────────────────────────
FROM node:20-alpine AS builder
WORKDIR /app

# Enable corepack for pnpm
RUN corepack enable

# Copy workspace manifests first (better layer caching)
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml turbo.json tsconfig.base.json ./
COPY apps/api/package.json                apps/api/package.json
COPY packages/core/package.json           packages/core/package.json
COPY packages/builder/package.json        packages/builder/package.json
COPY packages/detectors/package.json      packages/detectors/package.json
COPY packages/templates/package.json      packages/templates/package.json
COPY packages/transformers/package.json   packages/transformers/package.json

RUN pnpm install --frozen-lockfile

# Copy all source
COPY . .

# Generate Prisma client then compile TypeScript
RUN pnpm --filter @webtoapp/api db:generate
RUN pnpm --filter @webtoapp/api build

# ── Stage 2: Runtime ──────────────────────────────────────────────────────────
FROM node:20-alpine AS runner
WORKDIR /app
ENV NODE_ENV=production

# Non-root user for security
RUN addgroup -S webtoapp && adduser -S webtoapp -G webtoapp

# Runtime tools needed by the worker (git clone, wine for cross-compile, etc.)
RUN apk add --no-cache git

# Copy built artefacts
COPY --from=builder /app/node_modules          ./node_modules
COPY --from=builder /app/apps/api/package.json ./package.json
COPY --from=builder /app/apps/api/dist         ./dist
COPY --from=builder /app/apps/api/prisma       ./prisma

# Create upload/output dirs and chown to app user
RUN mkdir -p uploads outputs && chown -R webtoapp:webtoapp uploads outputs

USER webtoapp
EXPOSE 3001

CMD ["node", "dist/index.js"]
