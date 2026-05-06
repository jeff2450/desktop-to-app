import path from "node:path";
import fs from "node:fs/promises";
import { exec } from "node:child_process";
import { promisify } from "node:util";

const execAsync = promisify(exec);

export interface NativeDepsOptions {
  projectDir: string;
  electronVersion: string;
  platform: "win32" | "linux" | "darwin";
  arch: "x64" | "arm64";
  onLog?: (line: string) => void;
}

export interface NativeDepsResult {
  success: boolean;
  rebuiltModules: string[];
  error?: string;
}

/** Native modules that need rebuilding for Electron */
const NATIVE_MODULES = ["better-sqlite3", "bcrypt", "sharp", "canvas"];

/**
 * Rebuilds native Node modules against the target Electron ABI.
 * Uses npx for cross-platform compatibility.
 */
export class NativeDepsBuilder {
  async build(opts: NativeDepsOptions): Promise<NativeDepsResult> {
    const log = opts.onLog ?? console.log;
    const rebuiltModules: string[] = [];

    try {
      // Detect which native modules are present
      const presentNative = await this.detectNativeModules(opts.projectDir);
      if (presentNative.length === 0) {
        log("[native-deps] No native modules found — skipping rebuild");
        return { success: true, rebuiltModules: [] };
      }

      log(`[native-deps] Found native modules: ${presentNative.join(", ")}`);
      log(`[native-deps] Rebuilding for Electron ${opts.electronVersion} (${opts.platform}/${opts.arch})...`);

      const cmd = [
        "npx @electron/rebuild",
        `--version ${opts.electronVersion}`,
        `--arch ${opts.arch}`,
        `--only ${presentNative.join(",")}`,
      ].join(" ");

      const { stdout, stderr } = await execAsync(cmd, {
        cwd: opts.projectDir,
        env: {
          ...process.env,
          npm_config_platform: opts.platform,
          npm_config_arch: opts.arch,
        },
      });

      if (stdout) stdout.split("\n").filter(Boolean).forEach((l) => log(`[rebuild] ${l}`));
      if (stderr) stderr.split("\n").filter(Boolean).forEach((l) => log(`[rebuild] ${l}`));

      rebuiltModules.push(...presentNative);
      log(`[native-deps] Rebuild complete`);

      return { success: true, rebuiltModules };
    } catch (err) {
      const error = err instanceof Error ? err.message : String(err);
      log(`[native-deps] ERROR: ${error}`);
      return { success: false, rebuiltModules, error };
    }
  }

  private async detectNativeModules(projectDir: string): Promise<string[]> {
    const present: string[] = [];
    for (const mod of NATIVE_MODULES) {
      try {
        const bindingDir = path.join(projectDir, "node_modules", mod, "build", "Release");
        await fs.access(bindingDir);
        present.push(mod);
      } catch {
        // not installed
      }
    }
    return present;
  }
}
