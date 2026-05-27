import path from 'path';
import fs from 'fs-extra';
import { execa } from 'execa';
import { MobileConfig, MobileBuildResult } from './types.js';
import { checkAndroid } from './doctor.js';
import { writeCapacitorConfig, patchPackageJsonForMobile } from './capacitor-config.js';
import { createAndroidJavaEnv } from './java-env.js';

const DEFAULT_RELEASE_TARGET_SDK = 35;

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

    // 4b. Build web assets — cap sync needs a populated dist/ folder
    log('\n🏗️   Building web assets (npm run build)...');
    await execa('npm', ['run', 'build'], {
      cwd: projectDir,
      stdio: 'inherit',
    });
    await ensureWebDirExists(projectDir, config.webDir ?? 'dist');

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
    await patchAndroidSdkVersions(androidDir, config, warnings);

    // 8. Build the APK with Gradle
    const variant = config.android?.buildVariant ?? 'debug';
    const artifactType = config.android?.artifactType ?? (variant === 'release' ? 'aab' : 'apk');

    if (variant === 'release') {
      validateAndroidReleaseConfig(config);
      log(`\n🔨  Building Android release ${artifactType.toUpperCase()} (npx cap build android)...`);
      await ensureGradleWrapper(androidDir);
      await buildReleaseWithCapacitor(projectDir, config, artifactType);
    } else {
      const gradleTask = 'assembleDebug';
      log(`\n🔨  Building debug APK (./gradlew ${gradleTask})...`);

      const gradlew = await ensureGradleWrapper(androidDir);
      await execa(gradlew, [gradleTask, '--no-daemon'], {
        cwd: androidDir,
        env: createAndroidJavaEnv(),
        stdio: 'inherit',
      });
    }

    // 9. Locate Android output
    const artifactPath = await findAndroidArtifact(androidDir, variant, artifactType);
    if (!artifactPath) {
      warnings.push(`Android ${artifactType.toUpperCase()} built but could not locate output file automatically.`);
    }

    log(`\n✅  Android build complete!`);
    if (artifactPath) {
      log(`    ${artifactType.toUpperCase()}: ${artifactPath}`);
    }

    return {
      platform: 'android',
      success: true,
      outputPath: artifactPath ?? undefined,
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

async function ensureWebDirExists(projectDir: string, webDir: string): Promise<void> {
  const webDirPath = path.resolve(projectDir, webDir);
  const exists = await fs.stat(webDirPath).then((s) => s.isDirectory()).catch(() => false);

  if (!exists) {
    throw new Error(
      `Web assets directory not found: ${webDir}. ` +
      `Set mobile.webDir to the build output directory or update your build script to produce it.`
    );
  }
}

async function ensureGradleWrapper(androidDir: string): Promise<string> {
  const gradlewFile = process.platform === 'win32' ? 'gradlew.bat' : 'gradlew';
  const gradlewPath = path.join(androidDir, gradlewFile);

  if (!(await fs.pathExists(gradlewPath))) {
    throw new Error(
      `Android Gradle wrapper not found at ${gradlewPath}. ` +
      '`npx cap add android` may not have completed successfully.'
    );
  }

  if (process.platform !== 'win32') {
    try {
      await execa('chmod', ['+x', gradlewFile], { cwd: androidDir });
    } catch (err: any) {
      throw new Error(`Unable to mark ${gradlewFile} executable: ${err?.message ?? String(err)}`);
    }
  }

  return process.platform === 'win32' ? gradlewFile : `./${gradlewFile}`;
}

function validateAndroidReleaseConfig(config: MobileConfig): void {
  const android = config.android;
  const missing = [
    ['mobile.android.keystorePath', android?.keystorePath],
    ['mobile.android.keystoreAlias', android?.keystoreAlias],
    ['mobile.android.keystorePassword', android?.keystorePassword],
  ]
    .filter(([, value]) => !value)
    .map(([name]) => name);

  if (missing.length > 0) {
    throw new Error(
      `Android release builds require signing config before Gradle runs. Missing: ${missing.join(', ')}. ` +
      'Use buildVariant "debug" for an unsigned test APK.'
    );
  }
}

async function buildReleaseWithCapacitor(
  projectDir: string,
  config: MobileConfig,
  artifactType: 'apk' | 'aab'
): Promise<void> {
  const android = config.android!;
  const keystorePath = path.isAbsolute(android.keystorePath!)
    ? android.keystorePath!
    : path.resolve(projectDir, android.keystorePath!);

  const args = [
    'cap',
    'build',
    'android',
    '--androidreleasetype',
    artifactType.toUpperCase(),
    '--keystorepath',
    keystorePath,
    '--keystorealias',
    android.keystoreAlias!,
    '--keystorepass',
    android.keystorePassword!,
    '--keystorealiaspass',
    android.keystoreAliasPassword ?? android.keystorePassword!,
  ];

  await execa('npx', args, {
    cwd: projectDir,
    env: createAndroidJavaEnv(),
    stdio: 'inherit',
  });
}

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

async function patchAndroidSdkVersions(
  androidDir: string,
  config: MobileConfig,
  warnings: string[]
): Promise<void> {
  const variant = config.android?.buildVariant ?? 'debug';
  const minSdkVersion = config.android?.minSdkVersion;
  const targetSdkVersion = config.android?.targetSdkVersion ?? (
    variant === 'release' ? DEFAULT_RELEASE_TARGET_SDK : undefined
  );

  if (!minSdkVersion && !targetSdkVersion) return;

  const variablesPath = path.join(androidDir, 'variables.gradle');
  if (!(await fs.pathExists(variablesPath))) {
    warnings.push('android/variables.gradle not found — skipping Android SDK version patch.');
    return;
  }

  let variables = await fs.readFile(variablesPath, 'utf8');
  if (minSdkVersion) {
    variables = upsertGradleExtValue(variables, 'minSdkVersion', minSdkVersion);
  }
  if (targetSdkVersion) {
    variables = upsertGradleExtValue(variables, 'targetSdkVersion', targetSdkVersion);
    variables = upsertGradleExtValue(variables, 'compileSdkVersion', targetSdkVersion);
  }

  await fs.writeFile(variablesPath, variables, 'utf8');
}

function upsertGradleExtValue(content: string, key: string, value: number): string {
  const assignment = new RegExp(`(${key}\\s*=\\s*)\\d+`);
  if (assignment.test(content)) {
    return content.replace(assignment, `$1${value}`);
  }

  if (/ext\s*\{/.test(content)) {
    return content.replace(/ext\s*\{\s*/, (match) => `${match}\n    ${key} = ${value}`);
  }

  return `${content.trimEnd()}\n\next {\n    ${key} = ${value}\n}\n`;
}

async function findAndroidArtifact(
  androidDir: string,
  variant: string,
  artifactType: 'apk' | 'aab'
): Promise<string | null> {
  if (artifactType === 'aab') {
    const candidates = [
      path.join(androidDir, 'app', 'build', 'outputs', 'bundle', variant, `app-${variant}.aab`),
      path.join(androidDir, 'app', 'build', 'outputs', 'bundle', variant, `app-${variant}-signed.aab`),
    ];

    for (const candidate of candidates) {
      if (await fs.pathExists(candidate)) {
        return candidate;
      }
    }

    return findArtifactInDir(path.join(androidDir, 'app', 'build', 'outputs', 'bundle'), '.aab');
  }

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

  return findArtifactInDir(path.join(androidDir, 'app', 'build', 'outputs', 'apk'), '.apk');
}

async function findArtifactInDir(outputsDir: string, extension: '.apk' | '.aab'): Promise<string | null> {
  if (await fs.pathExists(outputsDir)) {
    const walk = async (dir: string): Promise<string | null> => {
      const entries = await fs.readdir(dir, { withFileTypes: true });
      for (const entry of entries) {
        const full = path.join(dir, entry.name);
        if (entry.isDirectory()) {
          const found = await walk(full);
          if (found) return found;
        } else if (entry.name.endsWith(extension)) {
          return full;
        }
      }
      return null;
    };
    return walk(outputsDir);
  }

  return null;
}
