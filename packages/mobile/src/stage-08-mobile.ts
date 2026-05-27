/**
 * Stage 08 — Mobile
 *
 * Runs after stage 07 (package/Electron build).
 * Builds Android and/or iOS targets when listed in config.targets.
 *
 * Drop this file into: packages/core/src/stages/08-mobile.ts
 * Then import and call it from ConversionPipeline.ts after stage 07.
 */

import { buildAndroid } from './android-builder.js';
import { buildIos } from './ios-builder.js';
import { MobileConfig } from './types.js';

// Minimal interface that matches what your PipelineContext already provides.
// Adjust field names to match your actual PipelineContext type.
export interface MobilePipelineContext {
  config: {
    targets: string[];
    appId: string;
    name: string;
    mobile?: Partial<MobileConfig>;
    android?: MobileConfig['android'];
    ios?: MobileConfig['ios'];
  };
  /** The directory of the converted project (input to Capacitor) */
  outputDir: string;
  log: (msg: string) => void;
}

export async function stageMobile(ctx: MobilePipelineContext): Promise<void> {
  const targets = ctx.config.targets ?? [];
  const wantsAndroid = targets.includes('android');
  const wantsIos = targets.includes('ios');

  if (!wantsAndroid && !wantsIos) {
    return; // No mobile targets — skip entirely
  }

  ctx.log('\n━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
  ctx.log('Stage 08 — Mobile (Capacitor)');
  ctx.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n');

  const mobileConfig: MobileConfig = {
    appId: ctx.config.appId ?? 'com.example.app',
    appName: ctx.config.name ?? 'MyApp',
    webDir: ctx.config.mobile?.webDir ?? 'dist',
    ...ctx.config.mobile,
    android: ctx.config.android ?? ctx.config.mobile?.android,
    ios: ctx.config.ios ?? ctx.config.mobile?.ios,
  };

  // ── Android ────────────────────────────────────────────────────────────────
  if (wantsAndroid) {
    ctx.log('📱  Building Android APK...\n');
    const result = await buildAndroid(ctx.outputDir, mobileConfig, ctx.log);

    if (result.warnings.length > 0) {
      for (const w of result.warnings) {
        ctx.log(`  ⚠  ${w}`);
      }
    }

    if (!result.success) {
      throw new Error(`[stage-08-mobile] Android build failed: ${result.error}`);
    }

    if (result.outputPath) {
      ctx.log(`\n  📦  APK output: ${result.outputPath}`);
    }
  }

  // ── iOS ────────────────────────────────────────────────────────────────────
  if (wantsIos) {
    ctx.log('\n🍎  Building iOS app...\n');
    const result = await buildIos(ctx.outputDir, mobileConfig, ctx.log);

    if (result.warnings.length > 0) {
      for (const w of result.warnings) {
        ctx.log(`  ⚠  ${w}`);
      }
    }

    if (!result.success) {
      // iOS failure is non-fatal if Android already succeeded — warn instead of throw
      if (wantsAndroid) {
        ctx.log(`\n  ✗  iOS build failed (non-fatal): ${result.error}`);
        ctx.log('     Tip: iOS builds require macOS + Xcode. Consider GitHub Actions macos-latest.\n');
      } else {
        throw new Error(`[stage-08-mobile] iOS build failed: ${result.error}`);
      }
    }
  }

  ctx.log('\n✅  Stage 08 complete.\n');
}
