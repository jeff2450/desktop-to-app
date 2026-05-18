# Changelog

All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.0.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

---

## [Unreleased]

### Planned
- Full test coverage for Firebase Firestore transformer
- Full test coverage for Auth0 transformer
- Full test coverage for Vue transformer
- `--dry-run` flag for `webtoapp convert` to preview changes without writing files
- Windows code-signing support via `electron-builder` + Azure Key Vault
- macOS notarization support

---

## [1.0.0] — 2024-01-01

### Added

**Core pipeline (`@webtoapp/core`)**
- 8-stage conversion pipeline: `00-preflight` → `01-detect` → `02-plan` → `03-transform` → `04-scaffold` → `05-install` → `06-build` → `07-package`
- `ConversionPipeline` class with `onLog` streaming callback for progress reporting
- `PipelineContext` for shared state across all stages
- `ConversionConfig` type with full JSDoc, supporting `offline` / `online` / `hybrid` modes
- Conversion report generation (`webtoapp-report.json`) with per-file transform summaries
- Mobile stage (`07b-mobile.ts`) for Capacitor-based Android/iOS output (beta)

**Detectors (`@webtoapp/detectors`)**
- React + Vite framework detection via `package.json` scanning
- Supabase backend detection (dependency + import pattern matching)
- Firebase backend detection
- Clerk auth detection
- Auth0 auth detection
- `SchemaExtractor` — infers database table structure from Supabase query patterns

**Transformers (`@webtoapp/transformers`)**
- `SupabaseAuthTransformer` — rewrites `supabase.auth.*` → `localAuth.*`
- `SupabaseQueryTransformer` — rewrites `.from().select/insert/update/delete()` → local API calls
- `SupabaseStorageTransformer` — rewrites `supabase.storage.*` → local file API
- `SupabaseRealtimeTransformer` — rewrites `supabase.channel()` → local event emitter
- `FirebaseAuthTransformer` — rewrites Firebase Auth SDK → local auth
- `FirestoreTransformer` — rewrites Firestore SDK → local API (partial)
- `ClerkTransformer` — rewrites Clerk React hooks → local auth hooks
- `Auth0Transformer` — rewrites Auth0 SDK → local auth (partial)
- `VueTransformer` — Vue 3 Composition API support (partial)
- `AiFallbackTransformer` — AI-assisted rewriting for unrecognised patterns

**Builder (`@webtoapp/builder`)**
- Vite build wrapper with automatic `base: "./"` patch for Electron
- `electron-builder` integration for `.exe` (Windows NSIS), `.AppImage` (Linux), `.dmg` (macOS)
- Capacitor wrapper for Android/iOS output (beta)

**CLI (`@webtoapp/cli`)**
- `npx webtoapp init` — interactive config generator, writes `webtoapp.config.json`
- `npx webtoapp convert` — runs the full pipeline with spinner progress
- `npx webtoapp doctor` — checks Node.js, pnpm, electron-builder, and platform build tools
- `npx webtoapp dev` — watch mode for iterative development
- `npx webtoapp login` — authenticate with WebToApp SaaS (optional)
- Config validation via AJV with human-readable error messages

**SaaS layer (optional, self-hostable)**
- `apps/api` — Express + BullMQ + Prisma backend
  - JWT auth with refresh tokens
  - Stripe billing integration (FREE / PRO / ENTERPRISE plans)
  - BullMQ job queue for async conversions
  - S3-compatible storage for upload/download
  - Rate limiting, helmet, compression middleware
- `apps/web` — Next.js 14 dashboard (App Router + shadcn/ui)
  - Auth pages (login, register)
  - Dashboard with job history
  - Billing page with plan management

**DevOps**
- Multi-stage Dockerfiles for `api` and `web`
- `docker-compose.yml` for local full-stack development
- GitHub Actions CI (lint → typecheck → test → build) with Postgres + Redis services
- GitHub Actions deploy workflows for API and web
- `publish-cli.yml` workflow for npm publish on release tag

### Notes

> ⚠ Firebase Firestore, Auth0, and Vue transformers are implemented but partially tested. Complex query patterns may require manual review after conversion. Use `--mode online` for full cloud fidelity until these are fully validated.

---

[Unreleased]: https://github.com/jeff2450/desktop-to-app/compare/v1.0.0...HEAD
[1.0.0]: https://github.com/jeff2450/desktop-to-app/releases/tag/v1.0.0
