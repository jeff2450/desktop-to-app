# WebToApp

> Convert AI-generated web apps into offline desktop apps — automatically.

Supports **React + Vite**, cloud backends (**Supabase**, **Firebase**), auth providers (**Clerk**, **Auth0**), and builds native installers for **Windows**, **Linux**, and **macOS**.

---

## Quick start

```bash
# In your existing web project root:
npx webtoapp init        # create webtoapp.config.json
npx webtoapp convert     # run the full pipeline

# Check system dependencies first:
npx webtoapp doctor
```

---

## How it works

```
Source project (React + Supabase)
          │
          ▼
  00-preflight→  Validates config + project structure (fail-fast)
  01-detect   →  Identifies framework, backend, auth, tables
  02-plan     →  Decides what to transform, copy, generate
  03-transform→  Rewrites cloud SDK calls → local API (AST-based)
  04-scaffold →  Generates Electron main, backend server, SQLite DB
  05-install  →  Merges package.json, runs npm install
  06-build    →  Runs vite build (patches base: './' for Electron)
  07-package  →  Runs electron-builder → .exe / .AppImage / .dmg
          │
          ▼
  Output: MyApp Setup 1.0.0.exe  ✔
```

---

## Monorepo structure

```
webtoapp/
├── apps/
│   ├── web/          Next.js SaaS dashboard      ✅
│   └── api/          Node.js + BullMQ backend     ✅
├── packages/
│   ├── core/         Pipeline orchestrator        ✅
│   ├── detectors/    Stack detection modules      ✅
│   ├── transformers/ AST code transformers        ✅
│   ├── templates/    Handlebars file templates    ✅
│   ├── builder/      Vite + electron-builder      ✅
│   └── cli/          npx webtoapp CLI             ✅
```

---

## webtoapp.config.json

```json
{
  "name": "My App",
  "version": "1.0.0",
  "appId": "com.example.myapp",
  "source": ".",
  "mode": "offline",
  "targets": ["windows", "linux"],
  "backend": { "type": "auto", "port": 3001 },
  "auth": { "type": "local", "defaultAdmin": "admin@app.local" },
  "database": { "type": "sqlite" }
}
```

---

## Conversion modes

| Mode | Behaviour | Best for |
|------|-----------|----------|
| `offline` | All data stored in local SQLite. No internet needed. | Pharmacy, clinic, field apps |
| `online` | Cloud backend untouched. Electron wrapper only. Internet required. | Apps that must share a live database |
| `hybrid` | Local SQLite + auto-sync to cloud when internet available. | Areas with intermittent connectivity |

---

## Development

```bash
pnpm install
pnpm build          # build all packages in dependency order
pnpm dev            # watch mode across all packages
pnpm typecheck      # type-check without emitting
pnpm test           # run all tests
```

---

## Running the full stack (Docker)

```bash
cp .env.example .env   # fill in your secrets
docker compose up -d
```

Services started:
- **postgres** — PostgreSQL 16 on port 5432
- **redis** — Redis 7 on port 6379
- **api** — Express + BullMQ API on port 3001
- **worker** — BullMQ conversion worker
- **web** — Next.js SaaS dashboard on port 3000

---

## Sessions completed

| Session | What was built | Status |
|---------|---------------|--------|
| 1 | Monorepo root + `packages/core` pipeline skeleton | ✅ |
| 2 | Detectors + Supabase transformers + stages 03–04 | ✅ |
| 3 | Templates + Builder + CLI + stages 05–07 | ✅ |
| 4 | API backend (Express + BullMQ + Prisma) | ✅ |
| 5 | API services (billing, downloads, auth, jobs) | ✅ |
| 6 | Next.js SaaS dashboard (shadcn/ui + protected routes) | ✅ |
| 7 | Firebase, Clerk, Auth0, Vue transformers + AI fallback | ✅ ⚠ partial |
| 8 | DevOps: Docker Compose, multi-stage Dockerfiles, Capacitor | ✅ |

> ⚠ **Session 7 note:** Firebase Firestore, Auth0, and Vue transformers are implemented but partially tested.
> Complex query patterns may require manual review after conversion.
> Use `--mode online` for full cloud fidelity.
