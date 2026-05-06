FROM node:20-alpine AS base
RUN npm install -g pnpm@9

# ── Dependencies ──────────────────────────────────────────────────────────────
FROM base AS deps
WORKDIR /app
COPY package.json pnpm-workspace.yaml ./
COPY apps/api/package.json ./apps/api/
COPY packages/core/package.json ./packages/core/
COPY packages/detectors/package.json ./packages/detectors/
COPY packages/transformers/package.json ./packages/transformers/
COPY packages/builder/package.json ./packages/builder/
RUN pnpm install --frozen-lockfile

# ── Build ─────────────────────────────────────────────────────────────────────
FROM deps AS builder
WORKDIR /app
COPY . .
RUN pnpm build

# ── Runtime ───────────────────────────────────────────────────────────────────
FROM node:20-alpine AS runner
RUN npm install -g pnpm@9

WORKDIR /app
ENV NODE_ENV=production

# Copy only what's needed
COPY --from=builder /app/apps/api/dist         ./apps/api/dist
COPY --from=builder /app/apps/api/package.json ./apps/api/package.json
COPY --from=builder /app/packages              ./packages
COPY --from=builder /app/package.json          ./package.json
COPY --from=builder /app/pnpm-workspace.yaml   ./pnpm-workspace.yaml

# Install production deps only
RUN pnpm install --prod --frozen-lockfile

EXPOSE 3000

HEALTHCHECK --interval=30s --timeout=5s --start-period=10s \
  CMD wget -qO- http://localhost:3000/api/health || exit 1

CMD ["node", "apps/api/dist/index.js"]
