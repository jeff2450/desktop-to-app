import { Command } from "commander";
import chalk from "chalk";
import { convertCommand } from "./commands/convert.js";
import { initCommand } from "./commands/init.js";
import { loginCommand, logoutCommand } from "./commands/login.js";
import { devCommand } from "./commands/dev.js";

const VERSION = "1.0.0";

const program = new Command();

program
  .name("webtoapp")
  .description(
    chalk.cyan("Convert AI-generated web apps to desktop apps") +
    "\n  Supports: React, Vue • Supabase, Firebase, Clerk • Windows, Linux, macOS"
  )
  .version(VERSION, "-v, --version");

// ── convert ────────────────────────────────────────────────────────────────────
program
  .command("convert")
  .description("Convert the web project to a desktop app")
  .option("-c, --config <path>", "Path to webtoapp.config.json")
  .option("-o, --output <dir>",  "Output directory (overrides config)")
  .option("-t, --target <targets...>", "Build targets: windows, linux, mac")
  .option("--verbose", "Enable verbose logging")
  .option("--dry-run", "Plan conversion without writing files")
  .option("--clean-logs", "Delete the conversion log file after a successful run")
  .action(async (opts) => {
    await convertCommand({
      config:    opts.config,
      output:    opts.output,
      target:    opts.target,
      verbose:   opts.verbose,
      dryRun:    opts.dryRun,
      cleanLogs: opts.cleanLogs,
    });
  });

// ── init ───────────────────────────────────────────────────────────────────────
program
  .command("init")
  .description("Create a webtoapp.config.json in the current directory")
  .option("-y, --yes", "Skip prompts and use defaults")
  .action(async (opts) => {
    await initCommand({ yes: opts.yes });
  });

// ── dev ────────────────────────────────────────────────────────────────────────
program
  .command("dev")
  .description("Start hot-reload dev mode: Vite + backend + Electron together")
  .option("-c, --config <path>", "Path to webtoapp.config.json")
  .option("-p, --port <number>", "Vite dev server port (default: 5173)", parseInt)
  .action(async (opts) => {
    await devCommand({
      config: opts.config,
      port:   opts.port,
    });
  });

// ── login ──────────────────────────────────────────────────────────────────────
program
  .command("login")
  .description("Authenticate with the WebToApp cloud platform")
  .option("--token <token>", "API token (for CI environments)")
  .action(async (opts) => {
    await loginCommand({ token: opts.token });
  });

// ── logout ─────────────────────────────────────────────────────────────────────
program
  .command("logout")
  .description("Remove stored credentials")
  .action(async () => {
    await logoutCommand();
  });

// ── doctor ─────────────────────────────────────────────────────────────────────
program
  .command("doctor")
  .description("Check system dependencies (Node, pnpm, Docker, Wine)")
  .action(async () => {
    const { doctorCommand } = await import("./commands/doctor.js");
    await doctorCommand();
  });

// ── Global error handler ───────────────────────────────────────────────────────
program.exitOverride();

try {
  await program.parseAsync(process.argv);
} catch (err) {
  if ((err as { code?: string }).code === "commander.helpDisplayed") {
    process.exit(0);
  }
  console.error(chalk.red(`\n  ✖ ${(err as Error).message}\n`));
  process.exit(1);
}
