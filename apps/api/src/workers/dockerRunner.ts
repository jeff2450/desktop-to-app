import { execFile, spawn } from "node:child_process";
import { promisify } from "node:util";
import path from "node:path";
import fs from "node:fs/promises";

const execFileAsync = promisify(execFile);

export interface DockerRunOptions {
  conversionId: string;
  sourceDir: string;
  outputDir: string;
  targets: Array<"windows" | "linux" | "mac">;
  configJson: string;
  onLog: (line: string) => void;
}

export interface DockerRunResult {
  success: boolean;
  installerPaths: string[];
  error?: string;
}

const BUILDER_IMAGE = process.env["DOCKER_BUILDER_IMAGE"] ?? "webtoapp/builder:latest";
const DOCKER_TIMEOUT_MS = parseInt(process.env["DOCKER_TIMEOUT_MS"] ?? "1800000"); // 30 min

/**
 * Runs the WebToApp conversion pipeline inside a Docker container.
 *
 * Advantages over running in-process:
 *  - Isolation: each conversion gets a clean filesystem
 *  - Cross-compilation: Linux containers can produce Windows .exe via Wine
 *  - Resource limits: CPU and memory caps prevent runaway builds
 *  - Security: untrusted npm packages can't affect the API process
 *
 * The builder image (infra/docker/Dockerfile.builder-linux) has:
 *  - Node 20, pnpm, Wine, electron-builder pre-installed
 *  - The @webtoapp/cli package baked in
 */
export class DockerRunner {
  async run(opts: DockerRunOptions): Promise<DockerRunResult> {
    const { conversionId, sourceDir, outputDir, targets, configJson, onLog } = opts;

    onLog(`[docker] Starting container for conversion ${conversionId}`);
    onLog(`[docker] Image: ${BUILDER_IMAGE}`);
    onLog(`[docker] Targets: ${targets.join(", ")}`);

    // Write config to a temp file the container can read
    const configPath = path.join(sourceDir, ".webtoapp-config.json");
    await fs.writeFile(configPath, configJson, "utf-8");

    try {
      await this.ensureImageExists(onLog);
      const result = await this.runContainer(opts, configPath, onLog);
      return result;
    } finally {
      // Clean up temp config
      await fs.rm(configPath, { force: true }).catch(() => {});
    }
  }

  private async ensureImageExists(onLog: (l: string) => void): Promise<void> {
    try {
      await execFileAsync("docker", ["image", "inspect", BUILDER_IMAGE]);
    } catch {
      onLog(`[docker] Image not found locally — pulling ${BUILDER_IMAGE}...`);
      await execFileAsync("docker", ["pull", BUILDER_IMAGE]);
      onLog("[docker] Image pulled successfully");
    }
  }

  private runContainer(
    opts: DockerRunOptions,
    configPath: string,
    onLog: (l: string) => void
  ): Promise<DockerRunResult> {
    return new Promise((resolve) => {
      const { conversionId, sourceDir, outputDir, targets } = opts;

      const targetFlags = targets.flatMap((t) => ["--target", t]);

      const args = [
        "run",
        "--rm",
        "--name", `webtoapp-${conversionId}`,

        // Resource limits
        "--memory", "4g",
        "--cpus",   "2",

        // Volume mounts
        "-v", `${sourceDir}:/workspace/source:ro`,
        "-v", `${outputDir}:/workspace/output`,

        // Environment
        "-e", `CONVERSION_ID=${conversionId}`,
        "-e", "NODE_ENV=production",

        // Image + command
        BUILDER_IMAGE,
        "webtoapp", "convert",
        "--config", "/workspace/source/.webtoapp-config.json",
        "--output", "/workspace/output",
        ...targetFlags,
        "--verbose",
      ];

      const proc = spawn("docker", args, { stdio: ["ignore", "pipe", "pipe"] });
      const installerPaths: string[] = [];
      let error: string | undefined;

      proc.stdout.on("data", (chunk: Buffer) => {
        const lines = chunk.toString().split("\n").filter(Boolean);
        for (const line of lines) {
          onLog(`[build] ${line}`);
          // Detect installer output lines
          if (line.includes("→") && (line.endsWith(".exe") || line.endsWith(".AppImage") || line.endsWith(".dmg"))) {
            const match = line.match(/→\s*(.+\.(exe|AppImage|dmg|deb))/);
            if (match?.[1]) installerPaths.push(match[1]);
          }
        }
      });

      proc.stderr.on("data", (chunk: Buffer) => {
        const lines = chunk.toString().split("\n").filter(Boolean);
        for (const line of lines) onLog(`[build:err] ${line}`);
      });

      // Timeout guard
      const timeout = setTimeout(() => {
        proc.kill("SIGKILL");
        execFileAsync("docker", ["rm", "-f", `webtoapp-${conversionId}`]).catch(() => {});
        error = `Build timed out after ${DOCKER_TIMEOUT_MS / 60_000} minutes`;
      }, DOCKER_TIMEOUT_MS);

      proc.on("close", (code) => {
        clearTimeout(timeout);
        if (code === 0) {
          resolve({ success: true, installerPaths });
        } else {
          resolve({
            success: false,
            installerPaths: [],
            error: error ?? `Container exited with code ${code}`,
          });
        }
      });

      proc.on("error", (err) => {
        clearTimeout(timeout);
        resolve({ success: false, installerPaths: [], error: err.message });
      });
    });
  }

  /**
   * Check if Docker is available on the host.
   */
  static async isAvailable(): Promise<boolean> {
    try {
      await execFileAsync("docker", ["info"]);
      return true;
    } catch {
      return false;
    }
  }
}
