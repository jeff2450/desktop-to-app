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
│   ├── web/          Next.js SaaS dashboard      (Session 6)
│   └── api/          Node.js + BullMQ backend     (Sessions 4–5)
├── packages/
│   ├── core/         Pipeline orchestrator        (Sessions 1–3) ✔
│   ├── detectors/    Stack detection modules      (Session 2)    ✔
│   ├── transformers/ AST code transformers        (Session 2)    ✔
│   ├── templates/    Handlebars file templates    (Session 3)    ✔
│   ├── builder/      Vite + electron-builder      (Session 3)    ✔
│   └── cli/          npx webtoapp CLI             (Session 3)    ✔
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

## Sessions completed

| Session | What was built | Status |
|---------|---------------|--------|
| 1 | Monorepo root + `packages/core` pipeline skeleton | ✅ |
| 2 | Detectors + Supabase transformers + stages 03–04 | ✅ |
| 3 | Templates + Builder + CLI + stages 05–07 | ✅ |
| 4 | API backend (Express + BullMQ) | 🔜 |
| 5 | API services (GitHub, S3, Stripe) | 🔜 |
| 6 | Next.js SaaS dashboard | 🔜 |
| 7 | Firebase, Clerk, Vue + AI fallback | 🔜 |
| 8 | DevOps, CI/CD, Capacitor | 🔜 |
