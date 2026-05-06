#!/usr/bin/env bash
# WebToApp — local development setup
# Run: bash scripts/dev-setup.sh

set -e
GREEN='\033[0;32m'; YELLOW='\033[1;33m'; NC='\033[0m'

echo -e "${GREEN}WebToApp — Dev Setup${NC}\n"

# Check prerequisites
for cmd in node pnpm docker git; do
  if ! command -v $cmd &> /dev/null; then
    echo -e "${YELLOW}Missing: $cmd${NC} — install it first (run: webtoapp doctor)"
    exit 1
  fi
done

echo "✓ Prerequisites OK"

# Install dependencies
echo -e "\nInstalling dependencies..."
pnpm install

# Build all packages
echo -e "\nBuilding packages..."
pnpm build

# Start Docker services (Postgres, Redis, MinIO)
echo -e "\nStarting Docker services..."
docker compose -f infra/docker/docker-compose.yml up -d postgres redis minio
echo "Waiting for services to be healthy..."
sleep 5

# Run DB migrations
echo -e "\nRunning database migrations..."
export DATABASE_URL="postgresql://webtoapp:webtoapp@localhost:5432/webtoapp"
psql $DATABASE_URL < apps/api/src/db/migrations/001_init.sql 2>/dev/null || true

# Copy .env.example if .env doesn't exist
if [ ! -f apps/api/.env ]; then
  cp apps/api/.env.example apps/api/.env
  echo "Created apps/api/.env from .env.example — edit it to add your API keys"
fi

echo -e "\n${GREEN}Setup complete!${NC}"
echo ""
echo "Start the API:  cd apps/api && pnpm dev"
echo "Start the web:  cd apps/web && pnpm dev"
echo "Use the CLI:    node packages/cli/bin/webtoapp.js doctor"
echo ""
echo "Or start everything with Docker:"
echo "  docker compose -f infra/docker/docker-compose.yml up"
