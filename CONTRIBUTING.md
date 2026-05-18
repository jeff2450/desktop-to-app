# Contributing to WebToApp

Thank you for your interest in contributing! This document covers everything you need to get the project running locally, understand the codebase, and submit a pull request.

---

## Table of contents

- [Prerequisites](#prerequisites)
- [Local setup](#local-setup)
- [Project structure](#project-structure)
- [Development workflow](#development-workflow)
- [Running tests](#running-tests)
- [Coding standards](#coding-standards)
- [Submitting a PR](#submitting-a-pr)
- [Adding a new transformer](#adding-a-new-transformer)
- [Adding a new detector](#adding-a-new-detector)

---

## Prerequisites

| Tool | Version | Install |
|------|---------|---------|
| Node.js | ≥ 20 | [nodejs.org](https://nodejs.org/) |
| pnpm | ≥ 9 | `npm install -g pnpm` |
| Docker | any recent | [docker.com](https://www.docker.com/) — only needed for the full SaaS stack |
| Git | any | — |

---

## Local setup

```bash
# 1. Fork the repo on GitHub, then clone your fork
git clone https://github.com/<your-username>/desktop-to-app.git
cd desktop-to-app

# 2. Install all dependencies (all packages in one shot via pnpm workspaces)
pnpm install

# 3. Copy environment files
cp .env.example .env
cp apps/api/.env.example apps/api/.env
cp apps/web/.env.example apps/web/.env

# 4. Build all packages in dependency order
pnpm build

# 5. Verify everything works
pnpm typecheck
pnpm test
```

### Running the CLI locally

```bash
# Build the CLI package
cd packages/cli && pnpm build

# Run against a test project
node dist/index.js doctor
node dist/index.js init
node dist/index.js convert
```

### Running the full SaaS stack

```bash
docker compose up -d
# API:       http://localhost:3001
# Dashboard: http://localhost:3000
```

---

## Project structure

```
webtoapp/
├── apps/
│   ├── api/              Express + BullMQ + Prisma backend
│   └── web/              Next.js SaaS dashboard
├── packages/
│   ├── cli/              CLI entry point (commander)
│   ├── core/             ConversionPipeline + all 8 stages
│   ├── detectors/        Stack detection (framework, backend, auth, schema)
│   ├── transformers/     AST-based code rewriters
│   ├── builder/          Vite + electron-builder wrapper
│   └── templates/        Handlebars templates for scaffold output
```

The most important package for pipeline logic is `packages/core/src/pipeline/`. Each numbered stage file (`00-preflight.ts` through `07-package.ts`) corresponds to one step of the conversion.

---

## Development workflow

```bash
# Watch mode across all packages (rebuilds on file change)
pnpm dev

# Type-check without emitting
pnpm typecheck

# Lint all packages
pnpm lint

# Run all tests
pnpm test

# Build everything
pnpm build

# Clean all build artifacts
pnpm clean
```

We use [Turborepo](https://turbo.build/) for task orchestration. Turbo respects the dependency graph in `pnpm-workspace.yaml`, so packages always build in the right order.

---

## Running tests

Tests use [Vitest](https://vitest.dev/). Each package has its own `vitest.config.ts`.

```bash
# Run all tests
pnpm test

# Run tests for a specific package
cd packages/core && pnpm test
cd packages/transformers && pnpm test

# Run tests in watch mode
cd packages/core && pnpm test --watch

# Run a single test file
cd packages/core && pnpm test src/__tests__/detection.test.ts
```

### Writing tests

- Place tests in `src/__tests__/` inside the relevant package.
- Use `describe` + `it` blocks.
- Use `beforeEach` / `afterEach` with `fs.mkdtemp` for any test that touches the filesystem — clean up in `afterEach`.
- Test both the happy path **and** failure paths (invalid config, missing files, unsupported stacks).

---

## Coding standards

- **TypeScript strict mode** is on. No `any` unless absolutely unavoidable — add a comment explaining why.
- **ESM only** — all packages use `"type": "module"`. Use `.js` extensions in imports even for `.ts` source files.
- **Imports:** Node built-ins use the `node:` prefix (`import fs from "node:fs/promises"`).
- **Error handling:** Throw typed errors or return `{ success: false, error: string }` objects. Never swallow errors silently.
- **Naming:** `camelCase` for variables/functions, `PascalCase` for classes/types, `SCREAMING_SNAKE_CASE` for constants.
- **Comments:** JSDoc on all exported functions and classes. Inline comments for non-obvious logic only.
- **Formatting:** Prettier is configured at the root. Run `pnpm prettier --write .` before committing or let the pre-commit hook handle it.

---

## Submitting a PR

1. **Create a branch** from `main`:
   ```bash
   git checkout -b feat/my-feature
   # or
   git checkout -b fix/the-bug
   ```

2. **Make your changes.** Keep commits small and descriptive:
   ```
   feat(transformers): add Prisma ORM transformer
   fix(cli): show actionable error when Node < 20 detected
   docs: add troubleshooting entry for fpm error
   ```
   We loosely follow [Conventional Commits](https://www.conventionalcommits.org/).

3. **Run the full check suite before pushing:**
   ```bash
   pnpm typecheck && pnpm lint && pnpm test && pnpm build
   ```

4. **Push and open a PR** against `main`. Fill in the PR template:
   - What does this change?
   - Why is it needed?
   - How was it tested?
   - Any breaking changes?

5. **Address review comments.** Once approved, a maintainer will squash-merge.

---

## Adding a new transformer

Transformers live in `packages/transformers/src/`. Each one extends `BaseTransformer`.

```ts
// packages/transformers/src/mystack/MyStackTransformer.ts
import { BaseTransformer } from "../base/BaseTransformer.js";
import type { TransformContext, TransformResult } from "../index.js";

export class MyStackTransformer extends BaseTransformer {
  canTransform(source: string): boolean {
    return source.includes("my-stack-sdk");
  }

  async transform(source: string, ctx: TransformContext): Promise<TransformResult> {
    // Use @babel/parser or regex to rewrite SDK calls
    const transformedContent = source.replace(/myStack\.doThing\(/g, "localApi.doThing(");
    return {
      success: true,
      transformedContent,
      changes: ["Replaced myStack.doThing → localApi.doThing"],
    };
  }
}
```

Then register it in `packages/transformers/src/index.ts` and add a corresponding detector in `packages/detectors/`.

Don't forget tests in `packages/transformers/src/__tests__/MyStackTransformer.test.ts`.

---

## Adding a new detector

Detectors live in `packages/detectors/src/`. They inspect `package.json` and source files to identify which stack a project uses.

```ts
// packages/detectors/src/backend/MyStackDetector.ts
import type { DetectionResult } from "@webtoapp/core";

export async function detectMyStack(projectRoot: string): Promise<Partial<DetectionResult>> {
  // Read package.json, check for dependency, return detection result
}
```

Register it in `packages/detectors/src/index.ts` and call it from `packages/core/src/pipeline/stages/01-detect.ts`.

---

## Questions?

Open a [GitHub Discussion](https://github.com/jeff2450/desktop-to-app/discussions) or file an issue. We're happy to help!
