# WebToApp — Sessions 4–6: Master Build Prompt
**API Backend + Stripe Billing + Next.js SaaS Dashboard**

> Copy each SESSION PROMPT in order into your AI coding assistant (Cursor, Copilot, Claude Code, etc.).
> Each session builds on the previous one. Do NOT skip sessions.

---

## CONTEXT (Read before every session)

You are continuing development of **WebToApp** — an `npx` CLI tool that converts AI-generated web apps
(React + Vite + Supabase/Firebase) into offline Electron desktop apps.

**Monorepo root:** `webtoapp/`
**Package manager:** `pnpm` with Turborepo
**Existing packages (already built):**
- `packages/core` — 7-stage conversion pipeline
- `packages/detectors` — stack detection (React, Vue, Supabase, Firebase, Clerk)
- `packages/transformers` — AST + regex code transformers
- `packages/templates` — Handlebars file templates
- `packages/builder` — Vite + electron-builder integration
- `packages/cli` — `npx webtoapp` CLI entrypoint

**What we are building now:**
- `apps/api` — Node.js + Express + BullMQ backend (Sessions 4–5)
- `apps/web` — Next.js 14 SaaS dashboard (Session 6)

**Database:** PostgreSQL via Prisma ORM
**Auth:** JWT (access + refresh tokens), bcrypt passwords
**Queue:** BullMQ + Redis for async conversion jobs
**Payments:** Stripe Checkout + Webhooks
**Storage:** AWS S3 (or Cloudflare R2) for `.exe` / `.AppImage` / `.dmg` installers

---

---

# SESSION 4 PROMPT
## API Backend — Core (Express + Auth + Jobs + DB)

```
You are building `apps/api` inside the WebToApp monorepo.
Package manager: pnpm. Language: TypeScript (strict). Runtime: Node.js 20.

## TASK
Scaffold a production-ready Express API that:
1. Manages user accounts (register, login, refresh token, logout)
2. Accepts conversion job submissions from authenticated users
3. Processes conversion jobs asynchronously via BullMQ + Redis
4. Stores all state in PostgreSQL via Prisma

## DIRECTORY STRUCTURE TO CREATE
apps/api/
├── src/
│   ├── index.ts                  # Express app entry, graceful shutdown
│   ├── config/
│   │   └── env.ts                # Zod-validated env vars
│   ├── db/
│   │   └── prisma.ts             # PrismaClient singleton
│   ├── middleware/
│   │   ├── auth.ts               # JWT verification middleware
│   │   ├── rateLimiter.ts        # express-rate-limit per IP + per user
│   │   └── errorHandler.ts       # Global error handler, never leaks stack traces
│   ├── routes/
│   │   ├── auth.routes.ts        # POST /auth/register, /auth/login, /auth/refresh, /auth/logout
│   │   ├── jobs.routes.ts        # POST /jobs, GET /jobs, GET /jobs/:id, DELETE /jobs/:id
│   │   └── downloads.routes.ts   # GET /downloads/:jobId/:platform — signed S3 URL
│   ├── services/
│   │   ├── auth.service.ts       # hashPassword, verifyPassword, signTokens, verifyToken
│   │   ├── jobs.service.ts       # createJob, getJob, listJobs, cancelJob
│   │   ├── queue.service.ts      # BullMQ queue init, addJob, getJobStatus
│   │   └── storage.service.ts    # uploadToS3, generateSignedUrl, deleteObject
│   └── workers/
│       └── conversion.worker.ts  # BullMQ worker: runs the webtoapp pipeline, uploads result to S3
├── prisma/
│   └── schema.prisma
├── Dockerfile
├── package.json
└── tsconfig.json

## PRISMA SCHEMA
Define these models exactly:

model User {
  id            String    @id @default(cuid())
  email         String    @unique
  passwordHash  String
  plan          Plan      @default(FREE)
  stripeCustomerId String? @unique
  createdAt     DateTime  @default(now())
  jobs          Job[]
  sessions      Session[]
}

model Session {
  id           String   @id @default(cuid())
  userId       String
  refreshToken String   @unique
  expiresAt    DateTime
  user         User     @relation(fields: [userId], references: [id], onDelete: Cascade)
}

model Job {
  id            String      @id @default(cuid())
  userId        String
  status        JobStatus   @default(QUEUED)
  sourceRepo    String      // GitHub URL or uploaded zip path in S3
  config        Json        // webtoapp.config.json contents
  platforms     String[]    // ["windows", "linux", "macos"]
  logs          String?     // streaming log output
  artifacts     Artifact[]
  createdAt     DateTime    @default(now())
  completedAt   DateTime?
  user          User        @relation(fields: [userId], references: [id])
}

model Artifact {
  id         String   @id @default(cuid())
  jobId      String
  platform   String   // "windows" | "linux" | "macos"
  s3Key      String
  sizeBytes  Int
  job        Job      @relation(fields: [jobId], references: [id], onDelete: Cascade)
}

enum Plan { FREE STARTER PRO }
enum JobStatus { QUEUED RUNNING SUCCESS FAILED CANCELLED }

## AUTH SPEC
- POST /auth/register  → { email, password } → creates User, returns { accessToken, refreshToken }
- POST /auth/login     → { email, password } → returns { accessToken, refreshToken }
- POST /auth/refresh   → { refreshToken } → rotates refresh token, returns new pair
- POST /auth/logout    → { refreshToken } → deletes session from DB
- Access token: JWT, 15min expiry, payload { sub: userId, plan }
- Refresh token: JWT, 7d expiry, stored in Session table (rotation on use)

## JOBS API SPEC
All routes require Authorization: Bearer <accessToken> header.

- POST /jobs
  Body: { sourceRepo: string, config: WebToAppConfig, platforms: string[] }
  Plan enforcement:
    FREE  → max 3 jobs/month, platforms: ["linux"] only
    STARTER → max 20 jobs/month, all platforms
    PRO   → unlimited, all platforms, priority queue
  Returns: { jobId, status: "QUEUED", estimatedWait: number }

- GET /jobs           → paginated list of user's jobs { data: Job[], total, page }
- GET /jobs/:id       → full job detail including artifacts and logs
- DELETE /jobs/:id    → cancel a QUEUED or RUNNING job

## CONVERSION WORKER SPEC
File: src/workers/conversion.worker.ts

The BullMQ worker should:
1. Pull the job from the queue
2. Clone the repo from GitHub (or download zip from S3) into a temp dir
3. Run the webtoapp core pipeline programmatically (import from @webtoapp/core)
4. On each pipeline stage completion, update job.logs in DB (append-only)
5. On success: upload each platform artifact to S3 at key `artifacts/{jobId}/{platform}/installer.*`
6. Update Job status to SUCCESS, set completedAt, create Artifact records
7. On failure: update Job status to FAILED, log error message
8. On cancel signal: kill child process, clean up temp dir, set CANCELLED

## STORAGE SERVICE SPEC
Use AWS SDK v3 (@aws-sdk/client-s3, @aws-sdk/s3-request-presigner).
- uploadToS3(key, stream, contentType) → uploads multipart for large files
- generateSignedUrl(key, expiresIn = 3600) → returns pre-signed GET URL
- deleteObject(key) → cleanup on job deletion

## RATE LIMITING
- Global: 100 req/min per IP
- /auth/register: 5 req/15min per IP
- /auth/login: 10 req/15min per IP
- /jobs POST: enforced by plan limits (see above), not express-rate-limit

## ENV VARS (validate all with Zod in config/env.ts)
DATABASE_URL, REDIS_URL, JWT_ACCESS_SECRET, JWT_REFRESH_SECRET,
AWS_ACCESS_KEY_ID, AWS_SECRET_ACCESS_KEY, AWS_REGION, S3_BUCKET,
PORT (default 3001), NODE_ENV

## DOCKER
Write a multi-stage Dockerfile:
- Stage 1 (builder): install deps, compile TypeScript
- Stage 2 (runner): copy dist + node_modules, run as non-root user
Expose port 3001.

## PACKAGE.JSON SCRIPTS
  "dev": "tsx watch src/index.ts",
  "build": "tsc -p tsconfig.json",
  "start": "node dist/index.js",
  "db:migrate": "prisma migrate deploy",
  "db:generate": "prisma generate",
  "worker": "tsx src/workers/conversion.worker.ts"

## CONSTRAINTS
- No `any` types — use strict TypeScript throughout
- All errors go through errorHandler middleware — never expose internal errors to client
- All DB queries through Prisma — no raw SQL except for migrations
- Use zod for all request body validation inside routes
- Graceful shutdown: drain BullMQ queue, close DB connection, then exit
```

---

---

# SESSION 5 PROMPT
## API Backend — Stripe Billing + Webhooks + Plan Enforcement

> Prerequisite: Session 4 is complete. Prisma schema is migrated. Auth + Jobs API are working.

```
You are extending `apps/api` with full Stripe billing integration.

## TASK
Add Stripe Checkout, subscription management, and webhook handling so users can
upgrade from FREE → STARTER ($9/mo) → PRO ($29/mo) plans.

## NEW ROUTES TO ADD
Mount all under /billing

POST  /billing/checkout          → create Stripe Checkout Session, return { url }
POST  /billing/portal            → create Stripe Customer Portal session, return { url }
GET   /billing/subscription      → return current plan, renewal date, usage stats
POST  /billing/webhooks          → Stripe webhook endpoint (raw body, verify signature)

## CHECKOUT FLOW SPEC

POST /billing/checkout
- Requires auth (JWT middleware)
- Body: { plan: "STARTER" | "PRO" }
- If user.stripeCustomerId is null: create Stripe Customer, save to DB
- Create Stripe Checkout Session:
    mode: "subscription"
    line_items: [{ price: STRIPE_PRICE_ID_FOR_PLAN, quantity: 1 }]
    success_url: DASHBOARD_URL + "/billing/success?session_id={CHECKOUT_SESSION_ID}"
    cancel_url:  DASHBOARD_URL + "/billing"
    customer: user.stripeCustomerId
    metadata: { userId: user.id, plan }
- Return { url: checkoutSession.url }

## CUSTOMER PORTAL SPEC

POST /billing/portal
- Requires auth
- Stripe Customer Portal lets user cancel, change plan, update payment method
- Create portal session: { customer: user.stripeCustomerId, return_url: DASHBOARD_URL + "/billing" }
- Return { url: portalSession.url }

## WEBHOOK HANDLER SPEC

POST /billing/webhooks
- Raw body parser (not JSON — use express.raw({ type: 'application/json' }))
- Verify Stripe signature: stripe.webhooks.constructEvent(rawBody, sig, STRIPE_WEBHOOK_SECRET)
- Handle these events:

  checkout.session.completed
    → If subscription: update User.plan in DB from metadata.plan
    → Save stripeCustomerId if not already set

  customer.subscription.updated
    → Re-derive plan from price ID, update User.plan
    → Handle downgrades: if new plan < current plan, enforce immediately

  customer.subscription.deleted
    → Set User.plan = FREE
    → Do NOT delete jobs — just prevent new ones

  invoice.payment_failed
    → Log warning, send email notification (use nodemailer or Resend)
    → After 3 failures: set User.plan = FREE (Stripe handles dunning but we enforce locally too)

- Always return 200 immediately to Stripe, process async

## PRICE ID CONFIG
Add to env.ts (Zod-validated):
  STRIPE_SECRET_KEY
  STRIPE_WEBHOOK_SECRET
  STRIPE_PRICE_STARTER    # Monthly price ID for STARTER plan
  STRIPE_PRICE_PRO        # Monthly price ID for PRO plan
  DASHBOARD_URL           # e.g. https://webtoapp.dev

## PLAN ENFORCEMENT UPDATE
Update jobs.service.ts createJob() to query current usage:

const jobsThisMonth = await prisma.job.count({
  where: {
    userId,
    createdAt: { gte: startOfMonth(new Date()) },
    status: { not: 'CANCELLED' }
  }
})

Limits:
  FREE:    3 jobs/month, linux only, queue priority: LOW
  STARTER: 20 jobs/month, all platforms, queue priority: NORMAL
  PRO:     unlimited, all platforms, queue priority: HIGH, dedicated worker slot

Throw PlanLimitError (HTTP 402) with message describing the limit and upgrade URL.

## USAGE STATS ENDPOINT

GET /billing/subscription returns:
{
  plan: "FREE" | "STARTER" | "PRO",
  jobsUsedThisMonth: number,
  jobsLimitThisMonth: number | null,   // null = unlimited
  renewsAt: string | null,             // ISO date
  cancelAtPeriodEnd: boolean,
  stripePortalUrl: string | null
}

## EMAIL NOTIFICATIONS (payment_failed)
Use Resend (npm: resend) or nodemailer with SMTP.
Send a plain-text email to user.email:
  Subject: "Action required — WebToApp payment failed"
  Body: brief message, link to /billing portal to update card.

Add env vars: RESEND_API_KEY (or SMTP_HOST, SMTP_USER, SMTP_PASS)

## CONSTRAINTS
- Stripe SDK: stripe npm package, always use TypeScript types (Stripe.Event, etc.)
- Never log or store raw card data
- Idempotent webhook handler — check event.id against processed set (Redis SET) before acting
- All Stripe API calls wrapped in try/catch with proper error forwarding
```

---

---

# SESSION 6 PROMPT
## Next.js SaaS Dashboard — Full UI

> Prerequisite: Sessions 4 + 5 complete. API running at http://localhost:3001 (or configured URL).

```
You are building `apps/web` — the Next.js 14 SaaS dashboard for WebToApp.

## TECH STACK
- Next.js 14 (App Router)
- TypeScript (strict)
- Tailwind CSS + shadcn/ui
- React Query (TanStack Query v5) for server state
- Zustand for client state (auth tokens, UI)
- React Hook Form + Zod for all forms
- Recharts for usage charts
- next-themes for dark mode

## PAGES TO BUILD

### Public pages (no auth required)
/                     → Landing page (see spec below)
/pricing              → Pricing table with plan comparison
/login                → Login form
/register             → Register form

### Protected pages (redirect to /login if no token)
/dashboard            → Home: recent jobs, usage meter, quick-convert CTA
/jobs                 → Jobs list with filters (status, date range, platform)
/jobs/new             → New conversion form
/jobs/[id]            → Job detail: live log stream, download buttons, status badge
/billing              → Plan info, usage chart, upgrade/manage buttons
/billing/success      → Post-checkout success page (verify session, show confirmation)
/settings             → Account settings (email, password change)

## API CLIENT
Create lib/api.ts:
- Axios instance with baseURL from NEXT_PUBLIC_API_URL
- Request interceptor: attach Authorization: Bearer <accessToken> header
- Response interceptor: on 401, attempt token refresh via POST /auth/refresh,
  retry original request once. On second 401, clear tokens, redirect to /login.
- Export typed functions for every endpoint:
  auth: register(), login(), logout(), refreshToken()
  jobs: createJob(), listJobs(), getJob(), cancelJob()
  billing: getCheckoutUrl(), getPortalUrl(), getSubscription()

## AUTH STATE (Zustand store: stores/auth.ts)
{
  accessToken: string | null,
  user: { id, email, plan } | null,
  isLoading: boolean,
  login(email, password): Promise<void>,
  register(email, password): Promise<void>,
  logout(): void,
  hydrate(): void   // read refresh token from httpOnly cookie on mount
}
Store accessToken in memory only (never localStorage).
Store refreshToken in httpOnly cookie via a Next.js API route /api/auth/cookie.

## LANDING PAGE SPEC  (/)
Sections in order:
1. Hero: headline "Convert your AI-generated web app into a desktop app in 60 seconds",
   subtext, two CTAs: "Start for free" (→/register) and "View docs" (→ external).
   Show a terminal animation of `npx webtoapp convert` with scrolling output lines.

2. How it works: 3-step horizontal cards:
   Step 1 → "Point at your repo" (GitHub URL input illustration)
   Step 2 → "We run the pipeline" (progress bar animation)
   Step 3 → "Download your .exe" (download button illustration)

3. Conversion mode table: offline / online / hybrid comparison (match README table)

4. Pricing preview: 3 cards (FREE / STARTER / PRO) with CTA buttons → /pricing

5. Footer: links to docs, GitHub, Twitter/X

## NEW CONVERSION FORM SPEC (/jobs/new)
A multi-step form (3 steps):

Step 1 — Source
  - Radio: "GitHub URL" or "Upload ZIP"
  - If GitHub: text input for repo URL with validation (must be github.com URL)
  - If ZIP: file upload dropzone (max 50MB)

Step 2 — Configuration
  - App name (text, required)
  - App ID (text, e.g. com.example.myapp, regex validated)
  - Conversion mode: radio — offline / online / hybrid
  - Target platforms: checkboxes — Windows / Linux / macOS
    (FREE plan: Linux only, others disabled with upgrade tooltip)
  - Default admin email (shown only when mode = offline)

Step 3 — Review & Submit
  - Summary card of all choices
  - Estimated build time based on platform count
  - Plan limit warning if user is near monthly cap
  - "Start conversion" button → POST /jobs → redirect to /jobs/:id

## JOB DETAIL PAGE SPEC (/jobs/[id])
Layout: two columns

Left column:
- Job metadata card: status badge (color-coded), created time, source repo, platforms
- Platforms section: for each platform show status chip + "Download .exe" button
  (Download button calls GET /downloads/:jobId/:platform → opens signed URL)
- Cancel button (only if status is QUEUED or RUNNING)

Right column — Live Logs:
- Auto-scrolling terminal-style log viewer (dark background, monospace font)
- Poll GET /jobs/:id every 3 seconds while status is QUEUED or RUNNING
- Show stage progress bar: "Stage 3/7 — Transform" with animated progress
- On completion: stop polling, show success/failure banner

## BILLING PAGE SPEC (/billing)
Three sections:

1. Current plan card
   - Plan name badge, renewal date, cancel-at-period-end warning if applicable
   - "Manage subscription" button → calls POST /billing/portal → redirect to Stripe portal

2. Usage chart
   - Bar chart (Recharts) showing jobs used per day this month
   - Meter: "12 / 20 jobs used this month" with colored progress bar

3. Plan comparison cards (FREE / STARTER / PRO)
   - Highlight current plan
   - "Upgrade" button on lower plans → calls POST /billing/checkout → redirect to Stripe
   - "Current plan" label on active plan
   - "Downgrade via portal" on higher plans

## DESIGN SYSTEM
Use shadcn/ui components throughout. Color palette:
  Primary: indigo-600
  Success: emerald-500
  Warning: amber-500
  Error:   rose-500
  Background: zinc-950 (dark), zinc-50 (light)

Dark mode enabled by default (class-based via next-themes).
All pages must be responsive (mobile-first, md: breakpoint for two-column layouts).

## PACKAGE.JSON SCRIPTS
  "dev": "next dev",
  "build": "next build",
  "start": "next start",
  "lint": "next lint",
  "typecheck": "tsc --noEmit"

## ENV VARS (Next.js)
  NEXT_PUBLIC_API_URL          # http://localhost:3001 in dev
  NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY

## CONSTRAINTS
- No `any` types
- All API calls through lib/api.ts — no fetch() calls scattered in components
- Loading skeletons on every data-fetching page (use shadcn Skeleton)
- Error boundaries on job detail and billing pages
- All forms show inline validation errors (React Hook Form + Zod)
- Protected routes: create a middleware.ts that redirects unauthenticated users
```

---

---

# INFRASTRUCTURE PROMPT (Optional — after Sessions 4–6)
## Docker Compose + CI/CD

```
Add the following to the monorepo root:

## docker-compose.yml (for local development)
Services:
  postgres:
    image: postgres:16-alpine
    env: POSTGRES_DB=webtoapp, POSTGRES_USER=webtoapp, POSTGRES_PASSWORD=secret
    ports: 5432:5432
    volumes: pgdata:/var/lib/postgresql/data

  redis:
    image: redis:7-alpine
    ports: 6379:6379

  api:
    build: ./apps/api
    depends_on: [postgres, redis]
    env_file: .env
    ports: 3001:3001
    volumes: ./apps/api/src:/app/src   # hot reload in dev

  worker:
    build: ./apps/api
    command: node dist/workers/conversion.worker.js
    depends_on: [postgres, redis]
    env_file: .env

  web:
    build: ./apps/web
    depends_on: [api]
    env_file: .env.web
    ports: 3000:3000

volumes:
  pgdata:

## .github/workflows/ci.yml
Trigger: push to main, PR to main

Jobs:
  1. typecheck: run `pnpm typecheck` across all packages
  2. lint: run `pnpm lint` across all packages
  3. test: run `pnpm test` (unit + integration, needs postgres + redis services)
  4. build: run `pnpm build` — fail if any package fails to compile
  5. docker-build: build api and web Docker images, push to GHCR
  6. deploy (main branch only): SSH into VPS, pull new images, run docker-compose up -d

## DEPLOYMENT NOTES
- API: deploy on a $6/mo VPS (Hetzner CX22 or DigitalOcean Droplet)
- Web: deploy on Vercel (free tier handles Next.js perfectly)
- Postgres: Supabase free tier or Railway $5/mo
- Redis: Upstash free tier (10k commands/day free — enough for early stage)
- S3: Cloudflare R2 (free egress — better than AWS for downloads)
- Stripe: test mode until first paying customer
```

---

## QUICK REFERENCE — Session Order

| Session | What you build | Est. time |
|---------|---------------|-----------|
| 4 | Express API + Auth + BullMQ + Prisma + S3 | 3–4 hrs |
| 5 | Stripe Checkout + Webhooks + Plan enforcement | 2–3 hrs |
| 6 | Next.js Dashboard (all pages) | 4–6 hrs |
| Infra | Docker Compose + GitHub Actions CI/CD | 1–2 hrs |

**Total to production-ready SaaS: ~12 hours of focused building.**

---

*Generated for: WebToApp (github.com/jeff2450/desktop-to-app)*
*Monorepo: pnpm + Turborepo | Backend: Node.js 20 + Express + BullMQ | DB: PostgreSQL + Prisma | Payments: Stripe | Frontend: Next.js 14 + shadcn/ui*
