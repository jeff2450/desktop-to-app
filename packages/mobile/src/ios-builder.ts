import path from 'path';
import fs from 'fs-extra';
import { execa } from 'execa';
import { MobileConfig, MobileBuildResult } from './types.js';
import { checkIos } from './doctor.js';
import { writeCapacitorConfig, patchPackageJsonForMobile } from './capacitor-config.js';

// ─── Main iOS builder ─────────────────────────────────────────────────────────

export async function buildIos(
  projectDir: string,
  config: MobileConfig,
  log: (msg: string) => void = console.log
): Promise<MobileBuildResult> {
  const warnings: string[] = [];

  // 1. Environment check
  log('🔍  Checking iOS environment...');
  const doctor = checkIos();
  for (const check of doctor.checks) {
    const icon = check.passed ? '  ✓' : check.required ? '  ✗' : '  ⚠';
    log(`${icon}  ${check.name}: ${check.message}`);
  }

  if (!doctor.ready) {
    return {
      platform: 'ios',
      success: false,
      error: doctor.checks.find((c) => !c.passed && c.required)?.message ??
        'iOS environment not ready. iOS builds require macOS + Xcode.',
      warnings,
    };
  }

  try {
    // 2. Write capacitor config (shared with android)
    log('\n📝  Writing capacitor.config.ts...');
    await writeCapacitorConfig(projectDir, config);

    // 3. Patch package.json
    log('📦  Patching package.json with Capacitor dependencies...');
    await patchPackageJsonForMobile(projectDir);

    // 4. Install packages
    log('\n⬇️   Installing Capacitor packages...');
    await execa('npm', ['install', '--legacy-peer-deps'], {
      cwd: projectDir,
      stdio: 'inherit',
    });

    // 5. Add iOS platform
    const iosDir = path.join(projectDir, 'ios');
    if (!(await fs.pathExists(iosDir))) {
      log('\n➕  Adding iOS platform (npx cap add ios)...');
      await execa('npx', ['cap', 'add', 'ios'], {
        cwd: projectDir,
        stdio: 'inherit',
      });
    } else {
      log('\n♻️   iOS platform already exists — skipping cap add.');
      warnings.push('iOS platform already existed; skipped `cap add ios`.');
    }

    // 6. Install CocoaPods dependencies
    const iosAppDir = path.join(iosDir, 'App');
    log('\n🍫  Installing CocoaPods (pod install)...');
    await execa('pod', ['install'], {
      cwd: iosAppDir,
      stdio: 'inherit',
    });

    // 7. Sync
    log('\n🔄  Syncing web assets (npx cap sync ios)...');
    await execa('npx', ['cap', 'sync', 'ios'], {
      cwd: projectDir,
      stdio: 'inherit',
    });

    // 8. Build with xcodebuild
    const deploymentTarget = config.ios?.deploymentTarget ?? '13.0';
    const teamId = config.ios?.developmentTeam;

    log(`\n🔨  Building iOS app (xcodebuild)...`);

    const xcodebuildArgs = [
      '-workspace', path.join(iosAppDir, 'App.xcworkspace'),
      '-scheme', 'App',
      '-configuration', 'Debug',
      '-destination', 'generic/platform=iOS Simulator',
      'build',
      `IPHONEOS_DEPLOYMENT_TARGET=${deploymentTarget}`,
    ];

    if (teamId) {
      xcodebuildArgs.push(`DEVELOPMENT_TEAM=${teamId}`);
    } else {
      warnings.push(
        'No iOS developmentTeam set in config. Build may fail for device deployment. ' +
        'Add "ios": { "developmentTeam": "YOURTEAMID" } to webtoapp.config.json.'
      );
    }

    await execa('xcodebuild', xcodebuildArgs, {
      cwd: projectDir,
      stdio: 'inherit',
    });

    log(`\n✅  iOS build complete!`);
    log('    To deploy to device, open Xcode: npx cap open ios');

    return {
      platform: 'ios',
      success: true,
      warnings,
    };
  } catch (err: any) {
    return {
      platform: 'ios',
      success: false,
      error: err?.message ?? String(err),
      warnings,
    };
  }
}
