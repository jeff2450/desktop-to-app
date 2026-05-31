# @webtoapp/mobile

Capacitor-based Android and iOS build pipeline for WebToApp.

---

## Files in this package

```
packages/mobile/
├── src/
│   ├── types.ts              — Shared TypeScript interfaces
│   ├── doctor.ts             — Environment checks (Java, ANDROID_HOME, Xcode, etc.)
│   ├── capacitor-config.ts   — Writes capacitor.config.ts + patches package.json
│   ├── android-builder.ts    — Full Android build pipeline
│   ├── ios-builder.ts        — Full iOS build pipeline (macOS only)
│   ├── stage-08-mobile.ts    — Drop-in pipeline stage for packages/core
│   ├── mobile-doctor-cli.ts  — CLI extension for `npx webtoapp doctor --android`
│   ├── index.ts              — Public exports
│   └── __tests__/
│       ├── doctor.test.ts         — Environment check unit tests
│       ├── java-env.test.ts       — JDK version parsing + discovery tests
│       └── capacitor-config.test.ts — Config generation + package.json patching tests
├── webtoapp.config.example.json  — Updated config with android target
├── mobile-build.yml              — Reference copy (see .github/workflows/mobile-build.yml)
├── package.json
└── tsconfig.json
```

---

## Step 1 — Add to pnpm workspace

In `pnpm-workspace.yaml`, `packages/mobile` is automatically included if you have:
```yaml
packages:
  - 'packages/*'
```
No change needed.

---

## Step 2 — Add to turbo.json

In `turbo.json`, add `@webtoapp/mobile` to the build pipeline if you have explicit
package references. Usually no change needed with a wildcard config.

---

## Step 3 — Wire into ConversionPipeline.ts

In `packages/core/src/ConversionPipeline.ts`, add after stage 07:

```typescript
import { stageMobile } from '@webtoapp/mobile';

// Inside your run() method, after stage07Package(ctx):
await stageMobile(ctx);
```

The `stageMobile` function is a no-op when no mobile targets are in config.targets,
so it's safe to always include.

---

## Step 4 — Update the config type

In `packages/core/src/types.ts` (or wherever WebToAppConfig is defined), add:

```typescript
import type { MobileConfig } from '@webtoapp/mobile';

export interface WebToAppConfig {
  // ... existing fields ...
  targets: Array<'windows' | 'linux' | 'macos' | 'android' | 'ios'>;
  mobile?: Partial<MobileConfig>;
}
```

---

## Step 5 — Wire into CLI doctor

In `packages/cli/src/commands/doctor.ts`, add:

```typescript
import { runMobileDoctor } from '@webtoapp/mobile/mobile-doctor-cli';

// In the doctor command handler:
if (options.android || options.ios) {
  const platforms: Array<'android' | 'ios'> = [];
  if (options.android) platforms.push('android');
  if (options.ios) platforms.push('ios');
  runMobileDoctor(platforms);
}
```

Then users can run:
```bash
npx webtoapp doctor --android
npx webtoapp doctor --ios
```

---

## Step 6 — CI/CD Workflow (`.github/workflows/mobile-build.yml`)

The canonical workflow is already deployed at `.github/workflows/mobile-build.yml`
(the `packages/mobile/mobile-build.yml` file is now a reference copy only).

The workflow has **4 jobs**:

| Job | Trigger | Runner | Duration |
|-----|---------|--------|----------|
| `mobile-unit-tests` | Every push & PR | ubuntu-latest | ~30s |
| `gradle-health-check` | Every push & PR (needs unit tests) | ubuntu-latest | ~2 min |
| `build-android` | Push to `main` + `workflow_dispatch` | ubuntu-latest | ~5–8 min |
| `build-ios` | `workflow_dispatch` (ios/both) only | macos-latest | ~15–20 min |

### Running unit tests locally

```bash
# Run mobile unit tests only
pnpm --filter @webtoapp/mobile test

# Watch mode during development
pnpm --filter @webtoapp/mobile test:watch

# Full monorepo test suite (includes mobile)
pnpm turbo test
```

### Triggering a full build via `workflow_dispatch`

1. Go to **Actions → Mobile Build → Run workflow**
2. Select platform: `android`, `ios`, or `both`
3. The APK artifact is uploaded as `webtoapp-debug-<sha>` (retained 14 days)

---

## Usage in webtoapp.config.json

```json
{
  "targets": ["windows", "linux", "android"],
  "mobile": {
    "webDir": "dist",
    "android": {
      "minSdkVersion": 22,
      "targetSdkVersion": 35,
      "buildVariant": "debug"
    }
  }
}
```

Add `"ios"` to targets when you're on macOS or using the GitHub Actions workflow.

For a Google Play release, use a signed AAB:

```json
{
  "targets": ["android"],
  "mobile": {
    "android": {
      "buildVariant": "release",
      "artifactType": "aab",
      "targetSdkVersion": 35,
      "keystorePath": "release.jks",
      "keystoreAlias": "upload",
      "keystorePassword": "..."
    }
  }
}
```

---

## Android requirements (local build)

- Java JDK 17 - Capacitor 6's Android Gradle stack can fail on newer JDKs such as 25
- Android Studio — https://developer.android.com/studio
- Set `ANDROID_HOME` env var to your SDK path

## iOS requirements

- macOS only
- Xcode (Mac App Store)
- CocoaPods: `sudo gem install cocoapods`
- Apple Developer account for device/store deployment
