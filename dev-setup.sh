#!/usr/bin/env bash
# dev-setup.sh — One-command local dev setup
# Usage: bash dev-setup.sh

set -euo pipefail

BOLD="\033[1m"
GREEN="\033[32m"
YELLOW="\033[33m"
RESET="\033[0m"

step() { echo -e "\n${BOLD}${GREEN}▶ $1${RESET}"; }
info() { echo -e "  ${YELLOW}$1${RESET}"; }

step "Checking prerequisites"
command -v node  >/dev/null || { echo "Node.js 20+ required"; exit 1; }
command -v pnpm  >/dev/null || { echo "pnpm required — run: npm i -g pnpm"; exit 1; }
command -v docker>/dev/null || { echo "Docker required"; exit 1; }

step "Setting up environment files"

if [ ! -f .env ]; then
  cp apps/api/.env.example .env
  info "Created .env from apps/api/.env.example — please fill in secrets before running"
else
  info ".env already exists, skipping"
fi

if [ ! -f .env.web ]; then
  cp apps/web/.env.example .env.web
  info "Created .env.web from apps/web/.env.example"
else
  info ".env.web already exists, skipping"
fi

step "Installing dependencies"
pnpm install

step "Starting Postgres + Redis via Docker Compose"
docker compose up -d postgres redis
info "Waiting for Postgres to be ready..."
until docker compose exec postgres pg_isready -U webtoapp -d webtoapp >/dev/null 2>&1; do
  sleep 1
done

step "Generating Prisma client"
pnpm --filter @webtoapp/api db:generate

step "Syncing database schema"
DATABASE_URL="postgresql://webtoapp:secret@localhost:5432/webtoapp" \
  pnpm --filter @webtoapp/api db:sync

step "Building packages"
pnpm turbo build --filter @webtoapp/core --filter @webtoapp/transformers \
  --filter @webtoapp/detectors --filter @webtoapp/builder --filter @webtoapp/templates

echo -e "\n${BOLD}${GREEN}✅ Setup complete!${RESET}"
echo ""
echo "  Start the API:    pnpm --filter @webtoapp/api dev"
echo "  Start the web:    pnpm --filter @webtoapp/web dev"
echo "  Start a worker:   pnpm --filter @webtoapp/api worker"
echo ""
echo "  Or run everything via Docker:"
echo "  docker compose up --build"
echo ""
