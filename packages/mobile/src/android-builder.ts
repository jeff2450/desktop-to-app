import path from 'path';
import fs from 'fs-extra';
import { execa } from 'execa';
import { MobileConfig, MobileBuildResult } from './types.js';
import { checkAndroid } from './doctor.js';
import { writeCapacitorConfig, patchPackageJsonForMobile } from './capacitor-config.js';

// ─── Main Android builder ─────────────────────────────────────────────────────

export async function buildAndroid(
  projectDir: string,
  config: MobileConfig,
  log: (msg: string) => void = console.log
): Promise<MobileBuildResult> {
  const warnings: string[] = [];

  // 1. Environment check
  log('🔍  Checking Android environment...');
  const doctor = checkAndroid();
  for (const check of doctor.checks) {
    const icon = check.passed ? '  ✓' : check.required ? '  ✗' : '  ⚠';
    log(`${icon}  ${check.name}: ${check.message}`);
  }

  if (!doctor.ready) {
    return {
      platform: 'android',
      success: false,
      error:
        'Android environment is not ready. Run `npx webtoapp doctor --android` for details.',
      warnings,
    };
  }

  try {
    // 2. Write capacitor.config.ts
    log('\n📝  Writing capacitor.config.ts...');
    await writeCapacitorConfig(projectDir, config);

    // 3. Patch package.json with Capacitor deps
    log('📦  Patching package.json with Capacitor dependencies...');
    await patchPackageJsonForMobile(projectDir);

    // 4. Install Capacitor packages
    log('\n⬇️   Installing Capacitor packages (npm install)...');
    await execa('npm', ['install', '--legacy-peer-deps'], {
      cwd: projectDir,
      stdio: 'inherit',
    });

    // 5. Add Android platform (idempotent — safe to re-run)
    const androidDir = path.join(projectDir, 'android');
    if (!(await fs.pathExists(androidDir))) {
      log('\n➕  Adding Android platform (npx cap add android)...');
      await execa('npx', ['cap', 'add', 'android'], {
        cwd: projectDir,
        stdio: 'inherit',
      });
    } else {
      log('\n♻️   Android platform already exists — skipping cap add.');
      warnings.push('Android platform already existed; skipped `cap add android`.');
    }

    // 6. Sync web assets into Android project
    log('\n🔄  Syncing web assets into Android project (npx cap sync android)...');
    await execa('npx', ['cap', 'sync', 'android'], {
      cwd: projectDir,
      stdio: 'inherit',
    });

    // 7. Patch AndroidManifest for internet permission (needed for hybrid/online modes)
    await ensureInternetPermission(projectDir, config, warnings);

    // 8. Build the APK with Gradle
    const variant = config.android?.buildVariant ?? 'debug';
    const gradleTask = variant === 'release' ? 'assembleRelease' : 'assembleDebug';
    log(`\n🔨  Building APK (./gradlew ${gradleTask})...`);

    const gradlew = process.platform === 'win32' ? 'gradlew.bat' : './gradlew';
    await execa(gradlew, [gradleTask, '--no-daemon'], {
      cwd: androidDir,
      stdio: 'inherit',
    });

    // 9. Locate APK output
    const apkPath = await findApk(androidDir, variant);
    if (!apkPath) {
      warnings.push('APK built but could not locate output file automatically.');
    }

    log(`\n✅  Android build complete!`);
    if (apkPath) {
      log(`    APK: ${apkPath}`);
    }

    return {
      platform: 'android',
      success: true,
      outputPath: apkPath ?? undefined,
      warnings,
    };
  } catch (err: any) {
    return {
      platform: 'android',
      success: false,
      error: err?.message ?? String(err),
      warnings,
    };
  }
}

// ─── Helpers ─────────────────────────────────────────────────────────────────

async function ensureInternetPermission(
  projectDir: string,
  config: MobileConfig,
  warnings: string[]
): Promise<void> {
  const manifestPath = path.join(
    projectDir,
    'android',
    'app',
    'src',
    'main',
    'AndroidManifest.xml'
  );

  if (!(await fs.pathExists(manifestPath))) {
    warnings.push('AndroidManifest.xml not found — skipping internet permission patch.');
    return;
  }

  let manifest = await fs.readFile(manifestPath, 'utf8');
  const internetPermission = '<uses-permission android:name="android.permission.INTERNET" />';

  if (!manifest.includes('android.permission.INTERNET')) {
    manifest = manifest.replace(
      '<application',
      `${internetPermission}\n\n    <application`
    );
    await fs.writeFile(manifestPath, manifest, 'utf8');
  }
}

async function findApk(androidDir: string, variant: string): Promise<string | null> {
  // Standard Gradle output path
  const candidates = [
    path.join(androidDir, 'app', 'build', 'outputs', 'apk', variant, `app-${variant}.apk`),
    path.join(androidDir, 'app', 'build', 'outputs', 'apk', variant, `app-${variant}-unsigned.apk`),
  ];

  for (const candidate of candidates) {
    if (await fs.pathExists(candidate)) {
      return candidate;
    }
  }

  // Fallback: glob the outputs directory
  const outputsDir = path.join(androidDir, 'app', 'build', 'outputs', 'apk');
  if (await fs.pathExists(outputsDir)) {
    const walk = async (dir: string): Promise<string | null> => {
      const entries = await fs.readdir(dir, { withFileTypes: true });
      for (const entry of entries) {
        const full = path.join(dir, entry.name);
        if (entry.isDirectory()) {
          const found = await walk(full);
          if (found) return found;
        } else if (entry.name.endsWith('.apk')) {
          return full;
        }
      }
      return null;
    };
    return walk(outputsDir);
  }

  return null;
}
