FROM node:20-alpine AS builder
WORKDIR /app

COPY package.json pnpm-lock.yaml pnpm-workspace.yaml turbo.json tsconfig.base.json ./
COPY apps/api/package.json apps/api/package.json
COPY packages/core/package.json packages/core/package.json
COPY packages/builder/package.json packages/builder/package.json
COPY packages/detectors/package.json packages/detectors/package.json
COPY packages/templates/package.json packages/templates/package.json
COPY packages/transformers/package.json packages/transformers/package.json

RUN corepack enable && pnpm install --frozen-lockfile

COPY . .
RUN pnpm --filter @webtoapp/api db:generate
RUN pnpm --filter @webtoapp/api build

FROM node:20-alpine AS runner
WORKDIR /app
ENV NODE_ENV=production

RUN addgroup -S webtoapp && adduser -S webtoapp -G webtoapp

COPY --from=builder /app/node_modules ./node_modules
COPY --from=builder /app/apps/api/package.json ./package.json
COPY --from=builder /app/apps/api/dist ./dist
COPY --from=builder /app/apps/api/prisma ./prisma

USER webtoapp
EXPOSE 3001

CMD ["node", "dist/index.js"]
