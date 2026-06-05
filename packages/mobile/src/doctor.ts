import { execSync } from 'child_process';
import { existsSync } from 'fs';
import path from 'path';
import os from 'os';
import { DoctorCheck, DoctorResult } from './types.js';
import {
  ANDROID_JDK_MAJOR,
  configureAndroidJava,
  formatJavaRuntime,
  getCurrentJava,
} from './java-env.js';

// ─── Helpers ─────────────────────────────────────────────────────────────────

function commandExists(cmd: string): boolean {
  try {
    execSync(`${cmd} --version`, { stdio: 'ignore' });
    return true;
  } catch {
    return false;
  }
}

function envExists(name: string): boolean {
  return !!process.env[name];
}

function addToPath(dir: string): void {
  const currentPath = process.env['PATH'] ?? process.env['Path'] ?? '';
  const entries = currentPath.split(path.delimiter).filter(Boolean);
  if (!entries.some((entry) => entry.toLowerCase() === dir.toLowerCase())) {
    process.env['PATH'] = [...entries, dir].join(path.delimiter);
  }
}

function findAndroidSdk(): string | null {
  const configured = process.env['ANDROID_HOME'] ?? process.env['ANDROID_SDK_ROOT'];
  if (configured && existsSync(configured)) {
    return configured;
  }

  const candidates = [
    process.env['LOCALAPPDATA'] ? path.join(process.env['LOCALAPPDATA'], 'Android', 'Sdk') : null,
    process.env['ANDROID_SDK_HOME'] ? path.join(process.env['ANDROID_SDK_HOME'], 'Sdk') : null,
    process.platform === 'win32' && !process.env['WEBTOAPP_TEST_NO_SDK_DISCOVERY']
      ? path.join(os.homedir(), 'AppData', 'Local', 'Android', 'Sdk')
      : null,
  ].filter((candidate): candidate is string => !!candidate);

  return candidates.find((candidate) => existsSync(candidate)) ?? null;
}

function configureAndroidSdk(): string | null {
  const sdk = findAndroidSdk();
  if (!sdk) return null;

  process.env['ANDROID_HOME'] = sdk;
  process.env['ANDROID_SDK_ROOT'] = sdk;
  addToPath(path.join(sdk, 'platform-tools'));
  addToPath(path.join(sdk, 'cmdline-tools', 'latest', 'bin'));
  return sdk;
}

function getCommandVersion(cmd: string, args = '--version'): string {
  try {
    return execSync(`${cmd} ${args}`, { stdio: ['ignore', 'pipe', 'ignore'] })
      .toString()
      .trim()
      .split('\n')[0];
  } catch {
    return 'unknown';
  }
}

// ─── Android doctor ──────────────────────────────────────────────────────────

export function checkAndroid(): DoctorResult {
  const checks: DoctorCheck[] = [];
  const androidSdk = configureAndroidSdk();

  // Java
  const androidJava = configureAndroidJava();
  const currentJava = androidJava ?? getCurrentJava();
  checks.push({
    name: 'Java JDK',
    passed: !!androidJava,
    message: androidJava
      ? `Using ${formatJavaRuntime(androidJava)}`
      : currentJava
        ? `Found ${formatJavaRuntime(currentJava)}, but Android builds require JDK ${ANDROID_JDK_MAJOR}. Install JDK ${ANDROID_JDK_MAJOR} and set JAVA_HOME to it.`
        : `Not found - install JDK ${ANDROID_JDK_MAJOR} from https://adoptium.net`,
    required: true,
  });

  // Node (already assumed available but double-check)
  const nodeOk = commandExists('node');
  checks.push({
    name: 'Node.js',
    passed: nodeOk,
    message: nodeOk
      ? `Found: ${getCommandVersion('node')}`
      : 'Not found — required for Capacitor CLI',
    required: true,
  });

  // ANDROID_HOME env
  const androidHomeOk = !!androidSdk || envExists('ANDROID_HOME') || envExists('ANDROID_SDK_ROOT');
  checks.push({
    name: 'ANDROID_HOME / ANDROID_SDK_ROOT',
    passed: androidHomeOk,
    message: androidHomeOk
      ? `Set to: ${androidSdk ?? process.env['ANDROID_HOME'] ?? process.env['ANDROID_SDK_ROOT']}`
      : 'Not set — install Android Studio and set ANDROID_HOME in your environment',
    required: true,
  });

  // adb
  const adbOk = commandExists('adb');
  checks.push({
    name: 'adb (Android Debug Bridge)',
    passed: adbOk,
    message: adbOk
      ? `Found: ${getCommandVersion('adb', 'version').split('\n')[0]}`
      : 'Not found — install Android SDK Platform-Tools',
    required: false, // needed for device deploy, not just building
  });

  // Gradle (ships with Android Studio but check anyway)
  const gradleOk = commandExists('gradle');
  checks.push({
    name: 'Gradle',
    passed: gradleOk,
    message: gradleOk
      ? `Found: ${getCommandVersion('gradle')}`
      : 'Not found in PATH — Android project uses its own Gradle wrapper (gradlew), so this is optional',
    required: false,
  });

  const ready = checks.filter((c) => c.required).every((c) => c.passed);
  return { platform: 'android', ready, checks };
}

// ─── iOS doctor ──────────────────────────────────────────────────────────────

export function checkIos(): DoctorResult {
  const checks: DoctorCheck[] = [];

  // Must be macOS
  const isMac = process.platform === 'darwin';
  checks.push({
    name: 'macOS',
    passed: isMac,
    message: isMac
      ? 'Running on macOS ✓'
      : 'iOS builds require macOS. Use GitHub Actions macos-latest runner for CI.',
    required: true,
  });

  if (!isMac) {
    return { platform: 'ios', ready: false, checks };
  }

  // Xcode
  const xcodeOk = commandExists('xcodebuild');
  checks.push({
    name: 'Xcode',
    passed: xcodeOk,
    message: xcodeOk
      ? `Found: ${getCommandVersion('xcodebuild', '-version').split('\n')[0]}`
      : 'Not found — install Xcode from the Mac App Store',
    required: true,
  });

  // Xcode command line tools
  const xcrunOk = commandExists('xcrun');
  checks.push({
    name: 'Xcode Command Line Tools',
    passed: xcrunOk,
    message: xcrunOk ? 'Installed ✓' : 'Run: xcode-select --install',
    required: true,
  });

  // CocoaPods
  const podOk = commandExists('pod');
  checks.push({
    name: 'CocoaPods',
    passed: podOk,
    message: podOk
      ? `Found: ${getCommandVersion('pod')}`
      : 'Not found — run: sudo gem install cocoapods',
    required: true,
  });

  const ready = checks.filter((c) => c.required).every((c) => c.passed);
  return { platform: 'ios', ready, checks };
}
