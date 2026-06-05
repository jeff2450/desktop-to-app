import path from "node:path";
import fs from "node:fs/promises";
import { execFile } from "node:child_process";
import { promisify } from "node:util";

const execFileAsync = promisify(execFile);

export interface CapacitorBuildOptions {
  projectDir: string;
  appName: string;
  appId: string;
  version: string;
  targets: Array<"android" | "ios">;
  onLog: (line: string) => void;
}

export interface CapacitorBuildResult {
  success: boolean;
  artifacts: Array<{ platform: string; path: string }>;
  error?: string;
}

/**
 * CapacitorBuilder — wraps Capacitor CLI to produce Android APK / iOS IPA
 * from the same Vite-built web app that electron-builder uses for desktop.
 *
 * Prerequisites on the build host:
 *  - Android: Android SDK + JAVA_HOME set
 *  - iOS:     Xcode (macOS only) + CocoaPods
 *
 * Workflow:
 *  1. Install @capacitor/core + platform packages
 *  2. Write capacitor.config.ts from template
 *  3. npx cap add android / ios
 *  4. npx cap sync (copies web dist to native project)
 *  5. gradlew assembleRelease (Android) / xcodebuild (iOS)
 */
export class CapacitorBuilder {
  async build(opts: CapacitorBuildOptions): Promise<CapacitorBuildResult> {
    const { projectDir, appName, appId, version, targets, onLog } = opts;
    const artifacts: CapacitorBuildResult["artifacts"] = [];

    try {
      // ── Step 1: Install Capacitor dependencies ─────────────────
      onLog("[capacitor] Installing Capacitor packages…");
      await this.installCapacitor(projectDir, targets, onLog);

      // ── Step 2: Write capacitor.config.ts ─────────────────────
      await this.writeConfig(projectDir, { appName, appId, version });
      onLog("[capacitor] Config written");

      // ── Step 3: Add platforms + sync ──────────────────────────
      for (const target of targets) {
        onLog(`[capacitor] Adding platform: ${target}`);
        await this.addPlatform(projectDir, target, onLog);

        onLog(`[capacitor] Syncing web build to ${target}`);
        await this.syncPlatform(projectDir, onLog);
      }

      // ── Step 4: Build each platform ────────────────────────────
      for (const target of targets) {
        onLog(`[capacitor] Building ${target}…`);

        if (target === "android") {
          const apkPath = await this.buildAndroid(projectDir, onLog);
          if (apkPath) artifacts.push({ platform: "android", path: apkPath });
        }

        if (target === "ios") {
          if (process.platform !== "darwin") {
            onLog("[capacitor] iOS build skipped — requires macOS");
            continue;
          }
          const ipaPath = await this.buildIos(projectDir, appName, onLog);
          if (ipaPath) artifacts.push({ platform: "ios", path: ipaPath });
        }
      }

      onLog(`[capacitor] Done — ${artifacts.length} artifact(s) produced`);
      return { success: true, artifacts };
    } catch (err) {
      const error = (err as Error).message;
      onLog(`[capacitor] ERROR: ${error}`);
      return { success: false, artifacts, error };
    }
  }

  private async installCapacitor(
    projectDir: string,
    targets: Array<"android" | "ios">,
    onLog: (l: string) => void
  ): Promise<void> {
    const packages = [
      "@capacitor/core",
      "@capacitor/cli",
      ...targets.map((t) => `@capacitor/${t}`),
    ];

    const { stdout } = await execFileAsync(
      "npm",
      ["install", "--save", ...packages],
      { cwd: projectDir }
    );
    stdout.split("\n").filter(Boolean).forEach(onLog);
  }

  private async writeConfig(
    projectDir: string,
    opts: { appName: string; appId: string; version: string }
  ): Promise<void> {
    const config = `import { CapacitorConfig } from '@capacitor/cli';

const config: CapacitorConfig = {
  appId: '${opts.appId}',
  appName: '${opts.appName}',
  webDir: 'dist',
  server: {
    // Point to the local backend when running on device via USB tunnel
    // Change to your device's IP when testing on physical device
    url: 'http://127.0.0.1:3001',
    cleartext: true,
  },
  android: {
    buildOptions: {
      releaseType: 'APK',
    },
  },
  plugins: {
    CapacitorHttp: {
      enabled: true,
    },
    CapacitorCookies: {
      enabled: true,
    },
    SplashScreen: {
      launchShowDuration: 1500,
      backgroundColor: '#0a0a0f',
      showSpinner: false,
    },
  },
};

export default config;
`;
    await fs.writeFile(path.join(projectDir, "capacitor.config.ts"), config, "utf-8");
  }

  private async addPlatform(
    projectDir: string,
    platform: string,
    onLog: (l: string) => void
  ): Promise<void> {
    // Skip if platform dir already exists
    const platformDir = path.join(projectDir, platform);
    const exists = await fs.access(platformDir).then(() => true).catch(() => false);
    if (exists) {
      onLog(`[capacitor] ${platform}/ already exists — skipping add`);
      return;
    }

    const capBin = path.join(projectDir, "node_modules", ".bin", "cap");
    const { stdout } = await execFileAsync(capBin, ["add", platform], { cwd: projectDir });
    stdout.split("\n").filter(Boolean).forEach(onLog);
  }

  private async syncPlatform(projectDir: string, onLog: (l: string) => void): Promise<void> {
    const capBin = path.join(projectDir, "node_modules", ".bin", "cap");
    const { stdout } = await execFileAsync(capBin, ["sync"], { cwd: projectDir });
    stdout.split("\n").filter(Boolean).forEach(onLog);
  }

  private async buildAndroid(
    projectDir: string,
    onLog: (l: string) => void
  ): Promise<string | undefined> {
    const gradlewPath = path.join(projectDir, "android", "gradlew");
    await execFileAsync("chmod", ["+x", gradlewPath]).catch(() => {});

    const { stdout } = await execFileAsync(
      gradlewPath,
      ["assembleRelease", "--no-daemon"],
      {
        cwd: path.join(projectDir, "android"),
        env: { ...process.env, JAVA_OPTS: "-Xmx2g" },
        maxBuffer: 50 * 1024 * 1024,
      }
    );
    stdout.split("\n").filter(Boolean).forEach(onLog);

    // Find the APK
    const apkDir = path.join(projectDir, "android", "app", "build", "outputs", "apk", "release");
    const files = await fs.readdir(apkDir).catch(() => []) as any as string[];
    const apk = files.find((f) => f.endsWith(".apk"));
    return apk ? path.join(apkDir, apk) : undefined;
  }

  private async buildIos(
    projectDir: string,
    appName: string,
    onLog: (l: string) => void
  ): Promise<string | undefined> {
    // Install CocoaPods deps
    onLog("[capacitor] Installing CocoaPods…");
    await execFileAsync("pod", ["install", "--repo-update"], {
      cwd: path.join(projectDir, "ios", "App"),
    });

    // Archive with xcodebuild
    const archivePath = path.join(projectDir, "ios", `${appName}.xcarchive`);
    await execFileAsync(
      "xcodebuild",
      [
        "archive",
        "-workspace", `ios/App/App.xcworkspace`,
        "-scheme", "App",
        "-configuration", "Release",
        "-archivePath", archivePath,
        "CODE_SIGNING_ALLOWED=NO",
      ],
      { cwd: projectDir, maxBuffer: 50 * 1024 * 1024 }
    );

    onLog("[capacitor] iOS archive complete");

    // Export IPA
    const exportPath = path.join(projectDir, "ios", "export");
    const exportPlist = path.join(projectDir, "ios", "ExportOptions.plist");
    await fs.writeFile(exportPlist, EXPORT_OPTIONS_PLIST, "utf-8");

    await execFileAsync("xcodebuild", [
      "-exportArchive",
      "-archivePath", archivePath,
      "-exportPath", exportPath,
      "-exportOptionsPlist", exportPlist,
    ], { cwd: projectDir });

    const files = await fs.readdir(exportPath).catch(() => []) as any as string[];
    const ipa = files.find((f) => f.endsWith(".ipa"));
    return ipa ? path.join(exportPath, ipa) : undefined;
  }
}

const EXPORT_OPTIONS_PLIST = `<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
  <key>method</key>
  <string>development</string>
  <key>compileBitcode</key>
  <false/>
</dict>
</plist>`;
