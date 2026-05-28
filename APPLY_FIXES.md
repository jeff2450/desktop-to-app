# WebToApp — Bug Fix Patch

Three files changed, all in `packages/core/src/pipeline/stages/`.

## How to apply

Copy the three files in this zip into your repo, replacing the originals:

```
packages/core/src/pipeline/stages/00-preflight.ts
packages/core/src/pipeline/stages/05-install.ts
packages/core/src/pipeline/stages/07-package.ts   (no change — fix was already present)
```

Then rebuild:

```bash
pnpm build
```

---

## What was fixed

### Fix 1 — Early cross-platform warning (00-preflight.ts)
**Problem:** When you requested `targets: ["windows", "linux"]` on a Windows machine,
the pipeline ran through 6 stages before failing with a cryptic `mksquashfs: file does not exist`
error deep inside stage 07.

**Fix:** Stage 00 now detects cross-platform targets at startup and logs a clear warning:

```
⚠  Cross-platform targets requested: linux. On this windows machine, only the
   windows installer will be built. To build linux installers, run on the target
   OS or use a CI matrix (see .github/workflows/publish-cli.yml for an example).
```

The pipeline continues normally and builds the native-platform installer. No more
surprise failures at the packaging step.

---

### Fix 2 — Auto-fix npm vulnerabilities (05-install.ts)
**Problem:** After `npm install`, the generated output project had 15 vulnerabilities
(the `npm warn` lines visible in the conversion log). These were left for the user
to deal with manually.

**Fix:** Stage 05 now runs `npm audit fix --omit=dev` immediately after install:

- `--omit=dev` — only patches runtime (production) dependencies; dev tools like
  electron-builder are left alone to avoid breaking the build chain.
- No `--force` — breaking changes are never applied automatically.
- Non-fatal — if audit fix itself fails or finds nothing to patch, the pipeline
  logs a warning and continues without interrupting the conversion.

---

### Fix 3 — Cross-platform guard (07-package.ts)
Already present from a previous session. Stage 07 filters `targets` down to the
current OS before invoking electron-builder, so even if stage 00's warning is
somehow bypassed, packaging won't attempt to build an AppImage on Windows.

No changes to this file in this patch.
