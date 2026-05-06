import { execFile, spawn } from "node:child_process";
import { promisify } from "node:util";
import fs from "node:fs/promises";
import path from "node:path";

const execFileAsync = promisify(execFile);

export interface DockerBuildRunOptions {
  /** Image to run — defaults to DOCKER_BUILDER_IMAGE env var */
  image?: string;
  /** Directory to mount as /workspace/source (read-only) */
  sourceDir: string;
  /** Directory to mount as /workspace/output (writable) */
  outputDir: string;
  /** webtoapp CLI args to pass inside the container */
  cliArgs: string[];
  /** Environment variables to pass into the container */
  env?: Record<string, string>;
  /** Memory limit (default: 4g) */
  memory?: string;
  /** CPU limit (default: 2) */
  cpus?: string;
  /** Timeout in ms (default: 30 min) */
  timeoutMs?: number;
  onLog: (line: string) => void;
}

export interface DockerBuildRunResult {
  success: boolean;
  exitCode: number;
  error?: string;
}

/**
 * DockerBuildRunner — thin wrapper around `docker run` that:
 *  - mounts source/output directories as volumes
 *  - streams stdout/stderr to onLog
 *  - enforces a timeout
 *  - cleans up the container on exit or timeout
 *
 * Used by:
 *  - apps/api/src/workers/conversionWorker.ts (cloud builds)
 *  - packages/builder/src/CrossCompiler.ts    (CLI cross-builds)
 */
export class DockerBuildRunner {
  static readonly DEFAULT_IMAGE =
    process.env["DOCKER_BUILDER_IMAGE"] ?? "webtoapp/builder:latest";

  async run(opts: DockerBuildRunOptions): Promise<DockerBuildRunResult> {
    const {
      image = DockerBuildRunner.DEFAULT_IMAGE,
      sourceDir,
      outputDir,
      cliArgs,
      env = {},
      memory = "4g",
      cpus = "2",
      timeoutMs = 30 * 60 * 1000,
      onLog,
    } = opts;

    const containerName = `webtoapp-build-${Date.now()}`;

    await fs.mkdir(outputDir, { recursive: true });

    const envFlags = Object.entries(env).flatMap(([k, v]) => ["-e", `${k}=${v}`]);

    const args = [
      "run",
      "--rm",
      "--name", containerName,
      "--memory", memory,
      "--cpus", cpus,
      "-v", `${sourceDir}:/workspace/source:ro`,
      "-v", `${outputDir}:/workspace/output`,
      ...envFlags,
      image,
      ...cliArgs,
    ];

    onLog(`[docker] ${image} ${cliArgs.join(" ")}`);

    return new Promise((resolve) => {
      const proc = spawn("docker", args, { stdio: ["ignore", "pipe", "pipe"] });

      proc.stdout.on("data", (chunk: Buffer) => {
        chunk.toString().split("\n").filter(Boolean).forEach((l) => onLog(l));
      });

      proc.stderr.on("data", (chunk: Buffer) => {
        chunk.toString().split("\n").filter(Boolean).forEach((l) => onLog(`[stderr] ${l}`));
      });

      const timeout = setTimeout(() => {
        onLog(`[docker] Timeout after ${timeoutMs / 60_000}min — killing container`);
        execFileAsync("docker", ["rm", "-f", containerName]).catch(() => {});
        proc.kill("SIGKILL");
        resolve({ success: false, exitCode: -1, error: "Build timed out" });
      }, timeoutMs);

      proc.on("close", (code) => {
        clearTimeout(timeout);
        const exitCode = code ?? -1;
        resolve({
          success: exitCode === 0,
          exitCode,
          error: exitCode !== 0 ? `Container exited with code ${exitCode}` : undefined,
        });
      });

      proc.on("error", (err) => {
        clearTimeout(timeout);
        resolve({ success: false, exitCode: -1, error: err.message });
      });
    });
  }

  /** Check whether Docker daemon is running and accessible. */
  static async isAvailable(): Promise<boolean> {
    return execFileAsync("docker", ["info"])
      .then(() => true)
      .catch(() => false);
  }

  /** Pull the builder image, logging progress. */
  static async pullImage(
    image: string,
    onLog: (l: string) => void
  ): Promise<void> {
    onLog(`[docker] Pulling ${image}…`);
    const proc = spawn("docker", ["pull", image], { stdio: ["ignore", "pipe", "pipe"] });
    proc.stdout.on("data", (c: Buffer) => c.toString().split("\n").filter(Boolean).forEach(onLog));
    proc.stderr.on("data", (c: Buffer) => c.toString().split("\n").filter(Boolean).forEach(onLog));
    await new Promise<void>((resolve, reject) => {
      proc.on("close", (code) => (code === 0 ? resolve() : reject(new Error(`docker pull exited ${code}`))));
    });
    onLog(`[docker] Image ready: ${image}`);
  }

  /** Build the Linux builder image from the monorepo root. */
  static async buildImage(
    repoRoot: string,
    tag: string,
    onLog: (l: string) => void
  ): Promise<void> {
    onLog(`[docker] Building builder image: ${tag}`);
    const proc = spawn(
      "docker",
      ["build", "-f", "infra/docker/Dockerfile.builder-linux", "-t", tag, "."],
      { cwd: repoRoot, stdio: ["ignore", "pipe", "pipe"] }
    );
    proc.stdout.on("data", (c: Buffer) => c.toString().split("\n").filter(Boolean).forEach(onLog));
    proc.stderr.on("data", (c: Buffer) => c.toString().split("\n").filter(Boolean).forEach(onLog));
    await new Promise<void>((resolve, reject) => {
      proc.on("close", (code) => (code === 0 ? resolve() : reject(new Error(`docker build exited ${code}`))));
    });
    onLog(`[docker] Image built: ${tag}`);
  }
}
