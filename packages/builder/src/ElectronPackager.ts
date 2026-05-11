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
    } catch (err: any) {
      const rawError = err instanceof Error ? err.message : String(err);
      const stdout = err.stdout ? err.stdout.toString() : "";
      const stderr = err.stderr ? err.stderr.toString() : "";

      // Dump the full output to a log file so the user can inspect it
      const logPath = path.join(opts.projectDir, "build-error.log");
      const logContent = [
        `electron-builder failed at ${new Date().toISOString()}`,
        `Command exit code: ${err.code ?? "unknown"}`,
        "",
        "=== STDOUT ===",
        stdout || "(empty)",
        "",
        "=== STDERR ===",
        stderr || "(empty)",
        "",
        "=== ERROR MESSAGE ===",
        rawError,
      ].join("\n");

      await fs.writeFile(logPath, logContent, "utf-8").catch(() => {});

      // Surface a clear, actionable error in the pipeline log
      log(`[packager] ERROR: ${rawError}`);
      log(`[packager] Full build log written to: ${logPath}`);

      // Also print first 60 lines of stderr directly so the key error is visible
      if (stderr) {
        const errLines = stderr.split("\n").filter(Boolean).slice(0, 60);
        errLines.forEach((l: string) => log(`[packager] [stderr] ${l}`));
      }
      if (stdout) {
        const outLines = stdout.split("\n").filter(Boolean).slice(0, 20);
        outLines.forEach((l: string) => log(`[packager] [stdout] ${l}`));
      }

      const error = `${rawError}\n  → Full log: ${logPath}`;
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
