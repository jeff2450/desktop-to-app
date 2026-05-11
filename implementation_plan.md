# Fix Web-to-Desktop Conversion Pipeline (10 Errors)

Addresses all 10 errors from `ERRORS_EXPLAINED.md` that prevented Lovable projects from being converted to desktop apps.

## Summary of All Errors → Fixes

| # | Error | Stage | Fix Location |
|---|-------|-------|--------------|
| 1 | Orphaned imports after file deletion | 03-transform | `03-transform.ts` — add import/usage scrubbing |
| 2 | Electron in `dependencies` instead of `devDependencies` | 04-scaffold / 05-install | `04-scaffold.ts` + `05-install.ts` — move electron |
| 3 | Missing `author` field in package.json | 04-scaffold / 05-install | `04-scaffold.ts` + `05-install.ts` — add author |
| 4 | `vite-plugin-pwa` incompatibility | 04-scaffold / 06-build | `04-scaffold.ts` — remove from deps; `06-build.ts` already patches vite config |
| 5 | `lovable-tagger` plugin conflict | 06-build | `06-build.ts` already patches — verify completeness |
| 6 | Missing `base: './'` in vite config | 06-build | `06-build.ts` already patches — verify regex works |
| 7 | `date-fns` v4 / `react-day-picker` v8 peer conflict | 05-install | `05-install.ts` — downgrade date-fns to v3 |
| 8 | Missing CSS/SVG static assets | 03-transform | `03-transform.ts` — already copies assets; ensure index.html also copied |
| 9 | `index.html` missing from output | 06-build | `06-build.ts` already handles — verify works for nested paths |
| 10 | No error recovery/rollback | ConversionPipeline | `ConversionPipeline.ts` — add backup & rollback |

## Proposed Changes

---

### Stage 03 — Transform (`03-transform.ts`) [MODIFY]

#### Fix #1: Orphaned Imports After File Deletion

After transforming/copying all files to the output directory, add a post-processing pass that:
1. Scans all `.ts`/`.tsx` files in `outputDir/src/`
2. Finds any import lines referencing deleted files (syncEngine, SyncStatus, useSyncStatus, useOnlineStatus)
3. Removes those import lines entirely
4. Removes any JSX usage like `<SyncStatus />` / `<SyncStatusBadge />`

**Files that Stage 04 deletes in non-hybrid mode:**
- `src/lib/syncEngine.ts`
- `src/hooks/useOnlineStatus.ts`

So Stage 03 should clean up references to these modules from all remaining source files.

---

### Stage 04 — Scaffold (`04-scaffold.ts`) [MODIFY]

#### Fix #2: Electron in `devDependencies`

In `patchPackageJson()`, after applying `plan.dependenciesToAdd`, add a guard that moves `electron` (and `electron-builder`) out of `dependencies` into `devDependencies` if they landed there.

#### Fix #3: Add `author` field

In `patchPackageJson()`, if `pkg.author` is missing, set it to `ctx.config.author ?? "WebToApp Conversion"`.

#### Fix #4: Remove `vite-plugin-pwa` from dependencies

In `patchPackageJson()`, remove `vite-plugin-pwa` from both `dependencies` and `devDependencies`.

---

### Stage 05 — Install (`05-install.ts`) [MODIFY]

#### Fix #2 (also): Double-check electron placement

In `writeOutputPackageJson()`, after merging deps, move `electron` from `deps` → `devDeps` if present.

#### Fix #3 (also): Add `author` field

In `writeOutputPackageJson()`, add `author: ctx.config.author ?? "WebToApp Conversion"` to `outputPkg`.

#### Fix #7: Fix `date-fns` peer dependency conflict

In `writeOutputPackageJson()`, after merging `deps`, if `react-day-picker` version starts with `^8` and `date-fns` version is `^4.*`, downgrade `date-fns` to `"^3.6.0"`.

---

### Stage 06 — Build (`06-build.ts`) [MODIFY]

#### Fix #4 (also): Remove `vite-plugin-pwa` config

The import removal is already done. Verify the regex also handles `VitePWA` calls in the `plugins` array.  
**Status: Already implemented** — `removeVitePWABlock()` handles this.

#### Fix #5: `lovable-tagger` removal

**Status: Already implemented** — the regex handles `componentTagger`. Also add removal of `lovableTagger` (alternative export name) to cover all cases.

#### Fix #6: `base: './'` in vite config

**Status: Already implemented** — adds `base: './'` if missing. Verify the regex handles the common `defineConfig({` pattern (no arrow function).

#### Fix #8: Copy missing static assets

The `03-transform.ts` `copySrcAssets()` already copies CSS/SVG/PNG. Also ensure `index.html` is copied from source root.
**Status: Already handled** by `ensureIndexHtml()` in 06-build.ts.

#### Fix #9: `index.html` in dist

**Status: Already handled** — Vite produces `dist/index.html` when `base: './'` is set correctly. The `ensureIndexHtml()` ensures input `index.html` exists before build.

---

### Core Pipeline (`ConversionPipeline.ts`) [MODIFY]

#### Fix #10: Add Backup & Rollback

Before running any stage, snapshot `outputDir` to `outputDir + ".backup"`. On any stage failure, restore from backup.

```
run() {
  await createBackup(outputDir)
  try {
    // run all stages
  } catch {
    await rollback(outputDir)  // restore from backup
    throw
  }
}
```

---

## Verification Plan

### Automated
- Run `pnpm build` at monorepo root to ensure TypeScript compiles with no errors.

### Manual
- Point the pipeline at the DawaTrack / test-app-tmp project and run a conversion.
- Confirm no orphaned import errors in the vite build.
- Confirm `package.json` has electron in devDependencies and has author field.
- Confirm `vite.config.ts` has `base: './'` and no lovable-tagger / PWA plugin.
- Confirm `dist/index.html` is produced after vite build.
