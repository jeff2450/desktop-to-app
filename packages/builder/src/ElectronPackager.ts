import path from "node:path";
import fs from "node:fs/promises";
import { exec } from "node:child_process";
import { promisify } from "node:util";

const execAsync = promisify(exec);

function cmd(command: string): string {
  return process.platform === "win32" ? `cmd /c ${command}` : command;
}

export interface PackageOptions {
  projectDir: string;
  targets: Array<"windows" | "linux" | "mac">;
  outputDir: string;
  appName: string;
  version: string;
  onLog?: (line: string) => void;
}

export interface PackageResult {
  success: boolean;
  installerPaths: string[];
  error?: string;
  durationMs: number;
}

/**
 * Wraps electron-builder to produce platform installers.
 * Uses npx for cross-platform compatibility (avoids .cmd path issues on Windows).
 */
export class ElectronPackager {
  async package(opts: PackageOptions): Promise<PackageResult> {
    const start = Date.now();
    const log = opts.onLog ?? console.log;

    log(`[packager] Starting electron-builder for ${opts.appName} v${opts.version}`);
    log(`[packager] Targets: ${opts.targets.join(", ")}`);

    try {
      const targetFlags = this.buildTargetFlags(opts.targets);

      // Run electron-builder via npx — works on Windows, Linux, macOS
      log("[packager] Running electron-builder...");
      const buildCmd = cmd(`npx electron-builder ${targetFlags.join(" ")}`);

      const { stdout, stderr } = await execAsync(buildCmd, {
        cwd: opts.projectDir,
        env: {
          ...process.env,
          CSC_IDENTITY_AUTO_DISCOVERY: "false",
        },
        maxBuffer: 200 * 1024 * 1024,
      });

      if (stdout) stdout.split("\n").forEach(log);
      if (stderr) stderr.split("\n").filter(Boolean).forEach((l) => log(`[packager] ${l}`));

      // Find produced installers
      const installerPaths = await this.findInstallers(
        path.join(opts.projectDir, "release")
      );

      log(`[packager] Done. ${installerPaths.length} installer(s) produced.`);
      installerPaths.forEach((p) => log(`  → ${p}`));

      return { success: true, installerPaths, durationMs: Date.now() - start };
    } catch (err) {
      const error = err instanceof Error ? err.message : String(err);
      log(`[packager] ERROR: ${error}`);
      return { success: false, installerPaths: [], error, durationMs: Date.now() - start };
    }
  }

  private buildTargetFlags(targets: PackageOptions["targets"]): string[] {
    const flags: string[] = [];
    if (targets.includes("windows")) flags.push("--win");
    if (targets.includes("linux"))   flags.push("--linux");
    if (targets.includes("mac"))     flags.push("--mac");
    return flags;
  }

  private async findInstallers(releaseDir: string): Promise<string[]> {
    const exts = [".exe", ".AppImage", ".deb", ".dmg", ".snap"];
    const found: string[] = [];

    let names: string[];
    try {
      names = await fs.readdir(releaseDir);
    } catch {
      return [];
    }

    for (const name of names) {
      if (exts.some((ext) => name.endsWith(ext))) {
        found.push(path.join(releaseDir, name));
      }
    }

    return found;
  }
}
