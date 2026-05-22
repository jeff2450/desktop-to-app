import path from "node:path";
import ora from "ora";
import chalk from "chalk";
import { ConversionPipeline } from "@webtoapp/core";
import { loadConfig, ConfigError } from "../utils/configLoader.js";

export interface ConvertOptions {
  config?: string;
  output?: string;
  target?: string[];
  verbose?: boolean;
  dryRun?: boolean;
  cleanLogs?: boolean;
}

/**
 * webtoapp convert
 *
 * Runs the full conversion pipeline:
 *   detect → plan → transform → scaffold → install → build → package
 *
 * Streams live log output to the terminal with spinners and progress indicators.
 */
export async function convertCommand(options: ConvertOptions): Promise<void> {
  console.log(chalk.bold.cyan("\n  WebToApp — Web to Desktop Converter\n"));

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

  // Apply CLI overrides
  if (options.output)  config = { ...config, output: path.resolve(options.output) };
  if (options.verbose) config = { ...config, verbose: true };
  if (options.dryRun) config = { ...config, dryRun: true };
  if (options.cleanLogs) config = { ...config, cleanLogs: true };
  if (options.target?.length) {
    config = {
      ...config,
      targets: options.target as Array<"windows" | "linux" | "mac" | "android" | "ios">,
    };
  }

  // ── Print conversion plan ──────────────────────────────────────
  console.log(`  ${chalk.dim("App:")}     ${chalk.white(config.name)} v${config.version}`);
  console.log(`  ${chalk.dim("Source:")}  ${chalk.white(config.source)}`);
  console.log(`  ${chalk.dim("Output:")}  ${chalk.white(config.output ?? "(auto)")}`);
  console.log(`  ${chalk.dim("Targets:")} ${chalk.white(config.targets.join(", "))}\n`);

  if (options.dryRun) {
    console.log(chalk.yellow("  Dry run — no files will be written.\n"));
  }

  // ── Spinner + live logs ────────────────────────────────────────
  const spinner = ora({ spinner: "dots", color: "cyan" }).start("Detecting project stack...");

  const stageLabels: Record<string, string> = {
    "01-detect":   "Detecting project stack",
    "02-plan":     "Planning migration",
    "03-transform":"Transforming source files",
    "04-scaffold": "Scaffolding Electron & backend",
    "05-install":  "Installing dependencies",
    "06-build":    "Building with Vite",
    "07-package":  "Packaging installer",
    "07b-mobile":  "Building mobile apps (Capacitor)",
  };

  const pipeline = new ConversionPipeline(config, {
    onLog: ({ level, message, stage }) => {
      if (stage && stageLabels[stage]) {
        spinner.text = stageLabels[stage];
      }
      if (config.verbose || level === "error" || level === "warn") {
        const prefix =
          level === "error" ? chalk.red("  ✖")
          : level === "warn"  ? chalk.yellow("  ⚠")
          : chalk.dim("    ");
        spinner.stop();
        console.log(`${prefix} ${chalk.dim(message)}`);
        spinner.start();
      }
    },
  });

  const startTime = Date.now();
  const result = await pipeline.run();
  const elapsed = ((Date.now() - startTime) / 1000).toFixed(1);

  spinner.stop();

  // ── Results ────────────────────────────────────────────────────
  if (result.status === "success") {
    console.log(chalk.green(`\n  ✔ Conversion complete in ${elapsed}s\n`));

    if (result.installerPath) {
      console.log(
        `  ${chalk.bold("Installer:")} ${chalk.cyan(result.installerPath)}\n`
      );
    }

    // Print stage summary
    console.log(chalk.dim("  Stage summary:"));
    for (const stage of result.stages) {
      const icon =
        stage.status === "done"    ? chalk.green("✔")
        : stage.status === "skipped" ? chalk.dim("–")
        : chalk.yellow("?");
      const dur = stage.durationMs ? chalk.dim(` (${stage.durationMs}ms)`) : "";
      console.log(`    ${icon} ${stage.name}${dur}`);
    }

    // Detection summary
    if (result.detectionResult) {
      const d = result.detectionResult;
      console.log(chalk.dim("\n  Detection summary:"));
      console.log(`    Framework: ${d.framework}`);
      console.log(`    Backend:   ${d.backend}`);
      console.log(`    Auth:      ${d.auth}`);
      console.log(`    Tables:    ${d.tables.join(", ") || "none"}`);
    }

    console.log();
  } else {
    console.error(chalk.red(`\n  ✖ Conversion failed after ${elapsed}s`));
    if (result.error) {
      console.error(chalk.red(`  Error: ${result.error}`));
    }

    // Show failed stages
    const failed = result.stages.filter((s) => s.status === "failed");
    for (const s of failed) {
      console.error(chalk.red(`  ✖ Stage '${s.name}': ${s.error}`));
    }

    console.log();
    process.exit(1);
  }
}
