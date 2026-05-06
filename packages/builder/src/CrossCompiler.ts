import { exec } from "node:child_process";
import { promisify } from "node:util";

const execAsync = promisify(exec);

function cmd(command: string): string {
  return process.platform === "win32" ? `cmd /c ${command}` : command;
}

export interface CrossCompileOptions {
  projectDir: string;
  targets: Array<"windows" | "linux" | "mac">;
  version: string;
  appName: string;
  onLog: (line: string) => void;
}

export interface CrossCompileResult {
  success: boolean;
  artifacts: Array<{ target: string; path: string; sizeBytes?: number }>;
  errors: string[];
}

/**
 * Cross-platform build orchestrator.
 * Uses npx for all binary invocations — works on Windows, Linux, macOS.
 */
export class CrossCompiler {
  async compile(opts: CrossCompileOptions): Promise<CrossCompileResult> {
    const { projectDir, targets, appName, version, onLog } = opts;
    const artifacts: CrossCompileResult["artifacts"] = [];
    const errors: string[] = [];

    onLog(`[cross] Building ${appName} v${version} for: ${targets.join(", ")}`);
    onLog(`[cross] Host platform: ${process.platform}`);

    const capabilities = await this.detectCapabilities();
    onLog(`[cross] Wine available: ${capabilities.wine}`);
    onLog(`[cross] Docker available: ${capabilities.docker}`);

    for (const target of targets) {
      onLog(`[cross] Building for ${target}...`);
      try {
        await this.buildTarget(target, projectDir, capabilities, onLog);
        onLog(`[cross] ✓ ${target} build complete`);
      } catch (err) {
        const msg = `${target} build failed: ${(err as Error).message}`;
        errors.push(msg);
        onLog(`[cross] ✗ ${msg}`);
      }
    }

    return { success: errors.length === 0, artifacts, errors };
  }

  private async buildTarget(
    target: "windows" | "linux" | "mac",
    projectDir: string,
    caps: { wine: boolean; docker: boolean },
    onLog: (l: string) => void
  ): Promise<void> {
    // macOS builds require macOS host
    if (target === "mac" && process.platform !== "darwin") {
      if (caps.docker) {
        onLog(`[cross] macOS build requires macOS — delegating to Docker`);
        await this.buildInDocker(target, projectDir, onLog);
        return;
      }
      onLog(`[cross] Skipping macOS build — requires macOS host`);
      return;
    }

    const flagMap: Record<string, string> = {
      windows: "--win",
      linux:   "--linux",
      mac:     "--mac",
    };

    const flag = flagMap[target] ?? "";
    const buildCmd = cmd(`npx electron-builder ${flag}`);

    const { stdout, stderr } = await execAsync(buildCmd, {
      cwd: projectDir,
      env: { ...process.env, CSC_IDENTITY_AUTO_DISCOVERY: "false" },
      maxBuffer: 200 * 1024 * 1024,
    });

    if (stdout) stdout.split("\n").filter(Boolean).forEach(onLog);
    if (stderr) stderr.split("\n").filter(Boolean).forEach((l) => onLog(`  ${l}`));
  }

  private async buildInDocker(
    target: string,
    projectDir: string,
    onLog: (l: string) => void
  ): Promise<void> {
    const image = process.env["DOCKER_BUILDER_IMAGE"] ?? "webtoapp/builder:latest";
    onLog(`[cross] Docker build for ${target} using ${image}`);

    const { stdout } = await execAsync(
      `docker run --rm -v "${projectDir}:/project" -w /project --memory 4g --cpus 2 ${image} npx electron-builder --${target}`,
      { maxBuffer: 200 * 1024 * 1024 }
    );
    stdout.split("\n").filter(Boolean).forEach(onLog);
  }

  private async detectCapabilities(): Promise<{ wine: boolean; docker: boolean }> {
    const [wine, docker] = await Promise.all([
      execAsync("wine --version").then(() => true).catch(() => false),
      execAsync("docker info").then(() => true).catch(() => false),
    ]);
    return { wine, docker };
  }
}
