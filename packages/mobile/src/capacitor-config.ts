import path from 'path';
import fs from 'fs-extra';
import { MobileConfig } from './types.js';

/**
 * Writes capacitor.config.ts into the project root.
 * We write .ts (not .json) so it's type-safe and easy to extend.
 */
export async function writeCapacitorConfig(
  projectDir: string,
  config: MobileConfig
): Promise<void> {
  const webDir = config.webDir ?? 'dist';
  const configPath = path.join(projectDir, 'capacitor.config.ts');
  const content = buildCapacitorConfig(config, webDir);

  if (await fs.pathExists(configPath)) {
    const existing = await fs.readFile(configPath, 'utf8');
    await fs.writeFile(configPath, patchExistingCapacitorConfig(existing, config, webDir), 'utf8');
    return;
  }

  await fs.writeFile(configPath, content, 'utf8');
}

function buildCapacitorConfig(config: MobileConfig, webDir: string): string {
  const androidBlock = buildAndroidConfigBlock(config);

  return `import type { CapacitorConfig } from '@capacitor/cli';

const config: CapacitorConfig = {
  appId: ${tsString(config.appId)},
  appName: ${tsString(config.appName)},
  webDir: ${tsString(webDir)},
  server: {
    androidScheme: 'https',
  },
${androidBlock}
  plugins: {
    CapacitorHttp: {
      enabled: true,
    },
    CapacitorCookies: {
      enabled: true,
    },
    SplashScreen: {
      launchShowDuration: 2000,
      backgroundColor: '#ffffff',
      androidSplashResourceName: 'splash',
      androidScaleType: 'CENTER_CROP',
      showSpinner: false,
    },
  },
};

export default config;
`;
}

function buildAndroidConfigBlock(config: MobileConfig): string {
  const android = config.android;
  const isRelease = android?.buildVariant === 'release';

  if (!isRelease && !android?.keystorePath && !android?.artifactType) {
    return '';
  }

  const artifactType = (android?.artifactType ?? (isRelease ? 'aab' : 'apk')).toUpperCase();
  const buildOptions: string[] = [
    `      releaseType: ${tsString(artifactType)},`,
  ];

  if (android?.keystorePath) {
    buildOptions.push(`      keystorePath: ${tsString(android.keystorePath)},`);
  }
  if (android?.keystoreAlias) {
    buildOptions.push(`      keystoreAlias: ${tsString(android.keystoreAlias)},`);
  }
  if (android?.keystorePassword) {
    buildOptions.push(`      keystorePassword: ${tsString(android.keystorePassword)},`);
    buildOptions.push(`      keystoreAliasPassword: ${tsString(android.keystoreAliasPassword ?? android.keystorePassword)},`);
  }

  return `  android: {
    buildOptions: {
${buildOptions.join('\n')}
    },
  },
`;
}

function patchExistingCapacitorConfig(content: string, config: MobileConfig, webDir: string): string {
  let next = content;
  next = upsertTopLevelStringProperty(next, 'appId', config.appId);
  next = upsertTopLevelStringProperty(next, 'appName', config.appName);
  next = upsertTopLevelStringProperty(next, 'webDir', webDir);

  if (!/\bserver\s*:/.test(next)) {
    next = insertTopLevelProperty(
      next,
      `server: {
    androidScheme: 'https',
  }`
    );
  }

  return next;
}

function upsertTopLevelStringProperty(content: string, key: string, value: string): string {
  const propPattern = new RegExp(`(\\b${key}\\s*:\\s*)(['"\`])(?:\\\\.|(?!\\2)[\\s\\S])*\\2`);

  if (propPattern.test(content)) {
    return content.replace(propPattern, (_match, prefix: string) => `${prefix}${tsString(value)}`);
  }

  return insertTopLevelProperty(content, `${key}: ${tsString(value)}`);
}

function insertTopLevelProperty(content: string, property: string): string {
  const patterns = [
    /(const\s+config\s*:\s*CapacitorConfig\s*=\s*\{\s*)/,
    /(const\s+config\s*=\s*\{\s*)/,
    /(export\s+default\s+\{\s*)/,
  ];

  for (const pattern of patterns) {
    if (pattern.test(content)) {
      return content.replace(pattern, (_match, prefix: string) => `${prefix}\n  ${property},\n`);
    }
  }

  return content;
}

function tsString(value: string): string {
  return JSON.stringify(value);
}

/**
 * Patches the project's package.json to add Capacitor dependencies
 * and a mobile:build script.
 */
export async function patchPackageJsonForMobile(
  projectDir: string
): Promise<void> {
  const pkgPath = path.join(projectDir, 'package.json');
  const pkg = await fs.readJson(pkgPath);

  // Add Capacitor core deps
  pkg.dependencies = pkg.dependencies ?? {};
  pkg.devDependencies = pkg.devDependencies ?? {};
  pkg.scripts = pkg.scripts ?? {};

  const capacitorDeps: Record<string, string> = {
    '@capacitor/core': '^6.0.0',
    '@capacitor/app': '^6.0.0',
    '@capacitor/haptics': '^6.0.0',
    '@capacitor/keyboard': '^6.0.0',
    '@capacitor/status-bar': '^6.0.0',
  };

  const capacitorDevDeps: Record<string, string> = {
    '@capacitor/cli': '^6.0.0',
    '@capacitor/android': '^6.0.0',
    '@capacitor/ios': '^6.0.0',
  };

  for (const [name, version] of Object.entries(capacitorDeps)) {
    addDependencyIfMissing(pkg, 'dependencies', name, version);
  }

  for (const [name, version] of Object.entries(capacitorDevDeps)) {
    addDependencyIfMissing(pkg, 'devDependencies', name, version);
  }

  // Convenience scripts
  addScriptIfMissing(pkg, 'mobile:sync', 'npx cap sync');
  addScriptIfMissing(pkg, 'mobile:android', 'npx cap open android');
  addScriptIfMissing(pkg, 'mobile:ios', 'npx cap open ios');
  addScriptIfMissing(
    pkg,
    'mobile:build:android',
    'npm run build && npx cap sync android && cd android && ./gradlew assembleDebug'
  );
  addScriptIfMissing(
    pkg,
    'mobile:build:android:release',
    'npm run build && npx cap sync android && npx cap build android --androidreleasetype AAB'
  );
  addScriptIfMissing(
    pkg,
    'mobile:build:ios',
    'npm run build && npx cap sync ios && cd ios/App && pod install && xcodebuild -workspace App.xcworkspace -scheme App -configuration Debug -destination "generic/platform=iOS Simulator" build CODE_SIGN_IDENTITY="" CODE_SIGNING_REQUIRED=NO CODE_SIGNING_ALLOWED=NO'
  );

  await fs.writeJson(pkgPath, pkg, { spaces: 2 });
}

function addDependencyIfMissing(
  pkg: any,
  section: 'dependencies' | 'devDependencies',
  name: string,
  version: string
): void {
  if (pkg.dependencies?.[name] || pkg.devDependencies?.[name]) return;
  pkg[section][name] = version;
}

function addScriptIfMissing(pkg: any, name: string, command: string): void {
  if (pkg.scripts[name]) return;
  pkg.scripts[name] = command;
}
