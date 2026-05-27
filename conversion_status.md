# Conversion Pipeline — Status Audit

## Overall Verdict
**The code is feature-complete but the infrastructure is not running.**  
Submitting a job from the web right now would 400/500 because Redis, Postgres, and the BullMQ worker are not started.

---

## What IS fully implemented ✅

| Layer | What's there |
|---|---|
| **Frontend wizard** | `ConversionWizard.tsx` — GitHub URL, app name, version, app ID, mode (offline / online / hybrid), platform targets (Windows / Linux / macOS / Android / iOS), mobile options |
| **API client** | `api-client.ts` — `conversionsApi.create/list/get/cancel/delete/getDownloadUrl` all wired |
| **API routes** | `conversions.routes.ts` — `POST /api/conversions` (zip upload + git/URL), `GET`, `DELETE/cancel`, signed download URL |
| **Job queue** | BullMQ queue + worker (`conversion.worker.ts`) — picks up jobs, runs `ConversionPipeline`, uploads to S3, marks DB |
| **Real-time logs** | Redis log lines streamed from worker → polled by `GET /conversions/:id` → shown in `ConversionLog.tsx` with stage-coloured output |
| **Storage** | Local `outputs/` in dev, S3 in prod (`storage.service.ts`) |
| **Auth** | JWT access + refresh token, `requireAuth` middleware on all conversion routes |
| **Plan limits** | FREE = 1 job/month, STARTER = 20, PRO = unlimited — enforced in `jobs.service.ts` |
| **Download** | Signed S3 URL (or local file serve in dev) via `GET /conversions/:id/download?platform=windows` |
| **Cancel** | `DELETE /conversions/:id?action=cancel` — marks CANCELLED, worker checks and aborts |
| **Core packages** | `packages/core`, `packages/builder`, `packages/detectors`, `packages/transformers`, `packages/mobile`, `packages/templates` all present |

---

## What's MISSING / broken ⚠️

### 🔴 Critical — nothing works without these

| # | Issue | Fix needed |
|---|---|---|
| 1 | **Redis not running** | `REDIS_URL=redis://localhost:6379` in `.env` — Redis must be started (`docker-compose up redis`) |
| 2 | **Postgres not running** | `DATABASE_URL` points to port 5433 — DB + Prisma migrations must be applied (`docker-compose up db && pnpm prisma migrate deploy`) |
| 3 | **BullMQ worker not started** | The worker process (`conversion.worker.ts`) is never started automatically. Must run `pnpm --filter api worker` (or equivalent) separately |
| 4 | **API server not started** | `POST /api/conversions` goes to port 3001 — API must be running alongside Next.js |

### 🟡 Medium — works but incomplete

| # | Issue | Fix needed |
|---|---|---|
| 5 | **`ConversionWizard` sends JSON but API field names differ** | Wizard sends `{ sourceUrl, targets, ... }` but API expects `{ sourceRepo, platforms, config: { name, appId, mode, ... } }` — the wizard body is **not correctly shaped** for the API |
| 6 | **No zip upload UI** | Wizard only supports GitHub URL. There's no file picker for zip upload even though the API supports it |
| 7 | **Log polling uses `liveLogLines` but the job page may not parse it** | `GET /conversions/:id` returns `liveLogLines: string[]` (raw strings) but `ConversionLog.tsx` expects `{ stage, message, ts }[]` objects |
| 8 | **No WebSocket / SSE** | Logs are polled via HTTP. Under load or slow builds this causes noticeable lag. Consider SSE on `GET /conversions/:id/stream` |
| 9 | **macOS cross-compile** | Worker correctly skips platforms it can't build natively — but there's no UI warning that macOS `.dmg` requires a macOS worker |
| 10 | **S3 keys are placeholder** | `AWS_ACCESS_KEY_ID=replace-me` — artifacts won't upload in prod until real S3 creds are set |

### 🟢 Nice to have — not blockers

| # | What |
|---|---|
| 11 | Zip file upload UI (drag-and-drop) on the new conversion page |
| 12 | Estimated wait time displayed in the UI (API returns `estimatedWait` but UI ignores it) |
| 13 | Progress bar on job page (pipeline has 7 named stages — could drive a visual progress bar) |
| 14 | Email notification when build completes (SMTP fields are in `.env` but unused) |

---

## Priority Action Plan

### Step 1 — Start infrastructure
```bash
# Start Postgres + Redis via Docker
docker-compose up -d db redis

# Apply DB migrations
pnpm --filter api exec prisma migrate deploy

# Start API server
pnpm --filter api dev

# Start BullMQ worker (separate terminal)
pnpm --filter api worker
```

### Step 2 — Fix wizard → API field mapping (Bug #5)
The wizard currently sends:
```json
{ "sourceUrl": "...", "targets": [...], "name": "...", "mode": "..." }
```
But the API `POST /conversions` (JSON path) expects:
```json
{
  "sourceRepo": "...",
  "platforms": [...],
  "config": { "name": "...", "appId": "...", "mode": "...", "targets": [...] }
}
```

### Step 3 — Fix log format mismatch (Bug #7)
`ConversionLog` expects `{ stage, message, ts }[]` but Redis lines are plain strings like:
```
[2026-05-27T...] [03-transform] Rewriting Supabase calls...
```
Need to parse them before passing to the component.

---

## docker-compose services status
The `docker-compose.yml` already defines `db` (Postgres on 5433) and `redis` — so Step 1 is just running the compose file.
