import path from "node:path";
import fs from "node:fs/promises";
import { spawn, type ChildProcess } from "node:child_process";
import chalk from "chalk";
import { loadConfig, ConfigError } from "../utils/configLoader.js";

export interface DevOptions {
  config?: string;
  port?: number;
}

/**
 * webtoapp dev
 *
 * Starts a hot-reload development environment for a converted desktop app:
 *
 *  1. Detects the output directory (from webtoapp.config.json)
 *  2. Starts the local Express backend with nodemon (watch: backend/)
 *  3. Starts Vite dev server (watch: src/)
 *  4. Launches Electron pointing to http://localhost:<vitePort>
 *  5. When Vite rebuilds, sends a reload signal to Electron via IPC
 *
 * Prerequisites: `webtoapp convert` must have been run at least once.
 * The output directory must contain electron/main.cjs and backend/server.js.
 */
export async function devCommand(options: DevOptions): Promise<void> {
  console.log(chalk.bold.cyan("\n  WebToApp Dev — Hot-reload desktop development\n"));

  // ── Load config ────────────────────────────────────────────────
  let config: Awaited<ReturnType<typeof loadConfig>>;
  try {
    config = await loadConfig(options.config);
  } catch (err) {
    if (err instanceof ConfigError) {
      console.error(chalk.red(`  ✖ Config error: ${err.message}`));
      process.exit(1);
    }
    throw err;
  }

  const sourceDir = path.resolve(config.source);
  const outputDir = path.resolve(
    config.output ??
    path.join(sourceDir, "..", `${path.basename(sourceDir)}-desktop`)
  );

  // ── Verify output dir exists ───────────────────────────────────
  const outputExists = await fs
    .stat(outputDir)
    .then((s) => s.isDirectory())
    .catch(() => false);

  if (!outputExists) {
    console.error(
      chalk.red(`  ✖ Output directory not found: ${outputDir}`) + "\n" +
      chalk.dim("  Run ") + chalk.cyan("webtoapp convert") + chalk.dim(" first to generate the desktop project.")
    );
    process.exit(1);
  }

  // Verify the electron entry point exists
  const mainCjs = path.join(outputDir, "electron", "main.cjs");
  const mainExists = await fs.access(mainCjs).then(() => true).catch(() => false);
  if (!mainExists) {
    console.error(
      chalk.red(`  ✖ electron/main.cjs not found in ${outputDir}`) + "\n" +
      chalk.dim("  Run ") + chalk.cyan("webtoapp convert") + chalk.dim(" first.")
    );
    process.exit(1);
  }

  const backendPort = config.backend?.port ?? 3001;
  const vitePort = options.port ?? 5173;

  console.log(`  ${chalk.dim("Output:")}   ${chalk.white(outputDir)}`);
  console.log(`  ${chalk.dim("Backend:")}  ${chalk.white(`http://localhost:${backendPort}`)}`);
  console.log(`  ${chalk.dim("Vite:")}     ${chalk.white(`http://localhost:${vitePort}`)}`);
  console.log();

  const processes: ChildProcess[] = [];
  let electronProcess: ChildProcess | null = null;
  let viteReady = false;

  // ── Cleanup on exit ────────────────────────────────────────────
  const cleanup = () => {
    console.log(chalk.dim("\n  Stopping dev processes..."));
    for (const proc of processes) {
      try { proc.kill("SIGTERM"); } catch {}
    }
    process.exit(0);
  };
  process.on("SIGINT", cleanup);
  process.on("SIGTERM", cleanup);

  // ── 1. Start backend with nodemon ─────────────────────────────
  const backendServer = path.join(outputDir, "backend", "server.js");
  const hasBackend = await fs.access(backendServer).then(() => true).catch(() => false);

  if (hasBackend) {
    console.log(chalk.cyan("  ► Starting backend (nodemon)..."));
    const backend = spawnProcess(
      "npx",
      ["nodemon", "--watch", "backend", "--ext", "js,json", "backend/server.js"],
      outputDir,
      { PORT: String(backendPort) }
    );
    processes.push(backend);

    backend.stdout?.on("data", (d: Buffer) =>
      process.stdout.write(chalk.dim(`  [backend] ${d.toString().trimEnd()}\n`))
    );
    backend.stderr?.on("data", (d: Buffer) =>
      process.stderr.write(chalk.yellow(`  [backend] ${d.toString().trimEnd()}\n`))
    );
  } else {
    console.log(chalk.dim("  [backend] No backend/server.js found — skipping"));
  }

  // ── 2. Start Vite dev server ───────────────────────────────────
  console.log(chalk.cyan("  ► Starting Vite dev server..."));

  const vite = spawnProcess(
    "npx",
    ["vite", "--port", String(vitePort), "--host", "127.0.0.1"],
    outputDir,
    {
      VITE_LOCAL_API: "true",
      VITE_API_PORT: String(backendPort),
      NODE_ENV: "development",
    }
  );
  processes.push(vite);

  vite.stdout?.on("data", (d: Buffer) => {
    const line = d.toString().trimEnd();
    process.stdout.write(chalk.dim(`  [vite] ${line}\n`));

    // Detect when Vite is ready
    if (!viteReady && (line.includes("ready in") || line.includes("Local:"))) {
      viteReady = true;
      console.log(chalk.green("\n  ✔ Vite ready — launching Electron...\n"));
      launchElectron();
    }
  });
  vite.stderr?.on("data", (d: Buffer) => {
    const line = d.toString().trimEnd();
    // Filter out non-error Vite output that goes to stderr
    if (line.includes("hmr") || line.includes("HMR") || line.includes("page reload")) {
      // Vite HMR events — tell Electron to reload
      if (electronProcess) {
        try { electronProcess.send?.({ type: "vite-hmr" }); } catch {}
      }
    } else {
      process.stderr.write(chalk.yellow(`  [vite] ${line}\n`));
    }
  });

  // ── 3. Launch Electron ─────────────────────────────────────────
  function launchElectron() {
    if (electronProcess) {
      try { electronProcess.kill(); } catch {}
    }

    const electron = spawnProcess(
      "npx",
      ["electron", "."],
      outputDir,
      {
        NODE_ENV: "development",
        WEBTOAPP_DEV: "true",
        WEBTOAPP_VITE_PORT: String(vitePort),
        WEBTOAPP_BACKEND_PORT: String(backendPort),
        // Tell Electron main to use the Vite dev server URL instead of dist/
        ELECTRON_DEV_URL: `http://localhost:${vitePort}`,
      }
    );

    electronProcess = electron;
    processes.push(electron);

    electron.stdout?.on("data", (d: Buffer) =>
      process.stdout.write(chalk.blue(`  [electron] ${d.toString().trimEnd()}\n`))
    );
    electron.stderr?.on("data", (d: Buffer) => {
      const line = d.toString().trimEnd();
      // Filter Electron's normal GPU/DevTools noise
      if (
        !line.includes("GPU") &&
        !line.includes("DevTools") &&
        !line.includes("Autofill") &&
        line.length > 0
      ) {
        process.stderr.write(chalk.yellow(`  [electron] ${line}\n`));
      }
    });

    electron.on("exit", (code) => {
      if (code !== null && code !== 0) {
        console.log(chalk.dim(`\n  [electron] Exited (code ${code}) — relaunch with Ctrl+R`));
      }
    });
  }

  // ── 4. Wait for processes or timeout ──────────────────────────
  // If Vite doesn't report ready after 30s, launch Electron anyway
  setTimeout(() => {
    if (!viteReady) {
      console.log(chalk.yellow("  ⚠ Vite didn't signal ready — launching Electron anyway"));
      viteReady = true;
      launchElectron();
    }
  }, 30_000);

  // Keep process alive
  await new Promise<never>(() => {});
}

// ── Helpers ────────────────────────────────────────────────────────────────────

function spawnProcess(
  cmd: string,
  args: string[],
  cwd: string,
  env: Record<string, string> = {}
): ChildProcess {
  const isWin = process.platform === "win32";

  return spawn(isWin ? `${cmd}.cmd` : cmd, args, {
    cwd,
    stdio: ["ignore", "pipe", "pipe"],
    env: { ...process.env, ...env },
    shell: isWin,
  });
}
