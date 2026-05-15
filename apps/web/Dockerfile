FROM node:20-alpine AS base
RUN corepack enable
WORKDIR /app

# ── Stage 1: Install all dependencies ────────────────────────────────────────
FROM base AS deps

COPY package.json pnpm-lock.yaml pnpm-workspace.yaml ./
COPY apps/web/package.json apps/web/package.json
COPY packages/core/package.json packages/core/package.json
COPY packages/builder/package.json packages/builder/package.json
COPY packages/detectors/package.json packages/detectors/package.json
COPY packages/templates/package.json packages/templates/package.json
COPY packages/transformers/package.json packages/transformers/package.json

RUN pnpm install --frozen-lockfile

# ── Stage 2: Build ───────────────────────────────────────────────────────────
FROM deps AS builder

COPY . .

# Build dependency packages first, then the web app
ENV NEXT_TELEMETRY_DISABLED=1
RUN pnpm --filter @webtoapp/core build
RUN pnpm --filter @webtoapp/web build

# ── Stage 3: Production runner ───────────────────────────────────────────────
FROM node:20-alpine AS runner
WORKDIR /app

ENV NODE_ENV=production
ENV NEXT_TELEMETRY_DISABLED=1

RUN addgroup -S webtoapp && adduser -S webtoapp -G webtoapp

# Only copy the Next.js standalone output (much smaller image)
COPY --from=builder --chown=webtoapp:webtoapp /app/apps/web/.next/standalone ./
COPY --from=builder --chown=webtoapp:webtoapp /app/apps/web/.next/static ./apps/web/.next/static
COPY --from=builder --chown=webtoapp:webtoapp /app/apps/web/public ./apps/web/public

USER webtoapp

EXPOSE 3000
ENV PORT=3000
ENV HOSTNAME="0.0.0.0"

CMD ["node", "apps/web/server.js"]
