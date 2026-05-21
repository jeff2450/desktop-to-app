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

  const content = `import { CapacitorConfig } from '@capacitor/cli';

const config: CapacitorConfig = {
  appId: '${config.appId}',
  appName: '${config.appName}',
  webDir: '${webDir}',
  server: {
    androidScheme: 'https',
  },
  plugins: {
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

  await fs.writeFile(path.join(projectDir, 'capacitor.config.ts'), content, 'utf8');
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

  Object.assign(pkg.dependencies, capacitorDeps);
  Object.assign(pkg.devDependencies, capacitorDevDeps);

  // Convenience scripts
  pkg.scripts['mobile:sync'] = 'npx cap sync';
  pkg.scripts['mobile:android'] = 'npx cap open android';
  pkg.scripts['mobile:ios'] = 'npx cap open ios';
  pkg.scripts['mobile:build:android'] =
    'npm run build && npx cap sync android && cd android && ./gradlew assembleDebug';

  await fs.writeJson(pkgPath, pkg, { spaces: 2 });
}
