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
│   └── index.ts              — Public exports
├── webtoapp.config.example.json  — Updated config with android target
├── mobile-build.yml              — GitHub Actions workflow
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

## Step 6 — Copy GitHub Actions workflow

Copy `mobile-build.yml` to `.github/workflows/mobile-build.yml` in your repo.

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
