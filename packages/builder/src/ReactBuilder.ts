import { execSync, spawn } from "node:child_process";
import path from "node:path";
import fs from "node:fs/promises";

export interface ReactBuildOptions {
  projectDir: string;
  bundler: "vite" | "webpack" | "next" | "unknown";
  verbose?: boolean;
  onLog?: (line: string) => void;
}

export interface ReactBuildResult {
  success: boolean;
  distDir: string;
  durationMs: number;
  error?: string;
}

/**
 * Runs the frontend build (Vite / CRA / Next) in the output project directory.
 * Produces the static dist/ folder that Electron will serve in production.
 */
export class ReactBuilder {
  async build(options: ReactBuildOptions): Promise<ReactBuildResult> {
    const { projectDir, bundler, verbose, onLog } = options;
    const start = Date.now();

    const log = (line: string): void => {
      onLog?.(line);
      if (verbose) console.log(`[ReactBuilder] ${line}`);
    };

    try {
      // Ensure dependencies are installed in the output project
      log("Installing dependencies…");
      await this.runInstall(projectDir, log);

      // Determine build command
      const buildCmd = this.getBuildCommand(projectDir, bundler);
      log(`Running: ${buildCmd}`);
      await this.runBuild(projectDir, buildCmd, log);

      const distDir = await this.resolveDistDir(projectDir, bundler);
      log(`Build complete → ${distDir}`);

      return { success: true, distDir, durationMs: Date.now() - start };
    } catch (err) {
      const error = err instanceof Error ? err.message : String(err);
      return { success: false, distDir: "", durationMs: Date.now() - start, error };
    }
  }

  private getBuildCommand(projectDir: string, bundler: string): string {
    // Read package.json scripts to find the right build command
    try {
      const pkg = JSON.parse(
        require("node:fs").readFileSync(path.join(projectDir, "package.json"), "utf-8")
      ) as { scripts?: Record<string, string> };

      const scripts = pkg.scripts ?? {};
      if ("build" in scripts) return "npm run build";
    } catch { /* fall through */ }

    switch (bundler) {
      case "next": return "npx next build";
      case "vite": return "npx vite build";
      default: return "npm run build";
    }
  }

  private async runInstall(projectDir: string, log: (l: string) => void): Promise<void> {
    return new Promise((resolve, reject) => {
      const usesPnpm = require("node:fs").existsSync(
        path.join(projectDir, "pnpm-lock.yaml")
      );
      const cmd = usesPnpm ? "pnpm" : "npm";
      const args = usesPnpm ? ["install", "--frozen-lockfile"] : ["install", "--legacy-peer-deps"];

      const proc = spawn(cmd, args, { cwd: projectDir, shell: true });
      proc.stdout?.on("data", (d: Buffer) => log(d.toString().trim()));
      proc.stderr?.on("data", (d: Buffer) => log(d.toString().trim()));
      proc.on("close", (code) => {
        code === 0 ? resolve() : reject(new Error(`Install failed with code ${code}`));
      });
    });
  }

  private async runBuild(
    projectDir: string,
    buildCmd: string,
    log: (l: string) => void
  ): Promise<void> {
    return new Promise((resolve, reject) => {
      const proc = spawn(buildCmd, [], {
        cwd: projectDir,
        shell: true,
        env: { ...process.env, NODE_ENV: "production" },
      });
      proc.stdout?.on("data", (d: Buffer) => log(d.toString().trim()));
      proc.stderr?.on("data", (d: Buffer) => log(d.toString().trim()));
      proc.on("close", (code) => {
        code === 0 ? resolve() : reject(new Error(`Build failed with code ${code}`));
      });
    });
  }

  private async resolveDistDir(
    projectDir: string,
    bundler: string
  ): Promise<string> {
    const candidates =
      bundler === "next"
        ? [".next", "out"]
        : ["dist", "build", "out"];

    for (const candidate of candidates) {
      const full = path.join(projectDir, candidate);
      if (await fs.access(full).then(() => true).catch(() => false)) {
        return full;
      }
    }

    return path.join(projectDir, "dist");
  }
}
