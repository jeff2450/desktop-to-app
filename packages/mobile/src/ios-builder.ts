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

    // 4b. Build web assets — cap sync needs a populated dist/ folder
    log('\n🏗️   Building web assets (npm run build)...');
    await execa('npm', ['run', 'build'], {
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

    // 5b. Copy/patch custom iOS application icons
    await copyCustomIosIcons(projectDir, log);

    // 6. Sync web assets (writes Podfile / updates native project)
    log('\n🔄  Syncing web assets (npx cap sync ios)...');
    await execa('npx', ['cap', 'sync', 'ios'], {
      cwd: projectDir,
      stdio: 'inherit',
    });

    // 7. Install CocoaPods dependencies (must run AFTER cap sync writes the Podfile)
    const iosAppDir = path.join(iosDir, 'App');
    log('\n🍫  Installing CocoaPods (pod install)...');
    await execa('pod', ['install'], {
      cwd: iosAppDir,
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
      // No team ID — disable code signing so simulator builds succeed without a paid Apple account
      xcodebuildArgs.push(
        'CODE_SIGN_IDENTITY=',
        'CODE_SIGNING_REQUIRED=NO',
        'CODE_SIGNING_ALLOWED=NO',
      );
      warnings.push(
        'No iOS developmentTeam set — code signing disabled (simulator only). ' +
        'Add "ios": { "developmentTeam": "YOURTEAMID" } to webtoapp.config.json for device deployment.'
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

async function loadSharp(): Promise<any> {
  try {
    const dynamicImport = new Function("m", "return import(m)") as (m: string) => Promise<unknown>;
    const mod: any = await dynamicImport("sharp");
    return mod.default ?? mod;
  } catch {
    return null;
  }
}

async function copyCustomIosIcons(projectDir: string, log: (msg: string) => void): Promise<void> {
  const sourceIcon = path.join(projectDir, 'assets', 'icon.png');
  const appiconsetDir = path.join(projectDir, 'ios', 'App', 'App', 'Assets.xcassets', 'AppIcon.appiconset');
  const contentsJsonPath = path.join(appiconsetDir, 'Contents.json');

  if (!(await fs.pathExists(sourceIcon))) {
    log('⚠️   Custom icon source (assets/icon.png) not found.');
    return;
  }
  if (!(await fs.pathExists(contentsJsonPath))) {
    log('⚠️   iOS AppIcon.appiconset/Contents.json not found. Skipping iOS icon patch.');
    return;
  }

  log('🍎  Patching custom iOS application icons...');
  try {
    const contents = await fs.readJson(contentsJsonPath);
    const images = contents.images || [];
    const sharp = await loadSharp();

    if (!sharp) {
      log('⚠️   sharp is not installed. Copying base icon to all iOS sizes (quality will be low)...');
    }

    for (const img of images) {
      if (img.filename && img.size && img.scale) {
        const sizePt = parseFloat(img.size.split('x')[0]);
        const scaleVal = parseFloat(img.scale.replace('x', ''));
        const pixelSize = Math.round(sizePt * scaleVal);
        const destPath = path.join(appiconsetDir, img.filename);

        if (sharp) {
          await sharp(sourceIcon)
            .resize(pixelSize, pixelSize, { fit: 'contain' })
            .png({ compressionLevel: 9 })
            .toFile(destPath);
        } else {
          // Fallback: copy original source icon to all destinations
          await fs.copyFile(sourceIcon, destPath);
        }
      }
    }
    log('    ✓ iOS application icons patched successfully.');
  } catch (err: any) {
    log(`⚠️   Failed to patch iOS icons: ${err?.message ?? String(err)}`);
  }
}
