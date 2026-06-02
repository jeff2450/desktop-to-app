import path from "node:path";
import fs from "node:fs/promises";
import readline from "node:readline/promises";
import chalk from "chalk";

export interface InitOptions {
  yes?: boolean; // skip prompts, use defaults
}

const DEFAULT_CONFIG = {
  mode: "online" as "online",
  name: "My App",
  version: "1.0.0",
  appId: "com.example.myapp",
  source: ".",
  targets: ["windows", "linux"] as Array<"windows" | "linux" | "mac" | "android" | "ios">,
  backend: { type: "auto", port: 3001 },
  auth: { type: "local", defaultAdmin: "admin@app.local" },
  database: { type: "sqlite" },
};

/**
 * webtoapp init
 *
 * Interactively creates a webtoapp.config.json in the current directory.
 * Run with --yes to skip prompts and accept defaults.
 */
export async function initCommand(options: InitOptions): Promise<void> {
  console.log(chalk.bold.cyan("\n  WebToApp — Initialize Project\n"));

  const outputPath = path.join(process.cwd(), "webtoapp.config.json");

  // Check if config already exists
  try {
    await fs.access(outputPath);
    console.log(chalk.yellow(`  webtoapp.config.json already exists at:\n  ${outputPath}`));
    const overwrite = options.yes ? "y" : await prompt("  Overwrite? [y/N] ", "N");
    if (overwrite.toLowerCase() !== "y") {
      console.log(chalk.dim("  Aborted."));
      return;
    }
  } catch {
    // File doesn't exist — continue
  }

  let config: typeof DEFAULT_CONFIG;

  if (options.yes) {
    // Detect project name from package.json if available
    const pkgName = await readPackageName(process.cwd());
    config = {
      ...DEFAULT_CONFIG,
      name: pkgName ?? DEFAULT_CONFIG.name,
    };
  } else {
    config = await promptConfig();
  }

  const json = JSON.stringify(config, null, 2);
  await fs.writeFile(outputPath, json + "\n", "utf-8");

  console.log(chalk.green(`\n  ✔ Created webtoapp.config.json\n`));
  console.log(chalk.dim("  Next steps:"));
  console.log(`    ${chalk.cyan("webtoapp convert")}     — convert your project`);
  console.log(`    ${chalk.cyan("webtoapp convert --verbose")} — see detailed logs\n`);
}

async function promptConfig(): Promise<typeof DEFAULT_CONFIG> {
  const pkgName = await readPackageName(process.cwd());

  const name = await prompt(
    `  App name ${chalk.dim(`[${pkgName ?? DEFAULT_CONFIG.name}]`)}: `,
    pkgName ?? DEFAULT_CONFIG.name
  );

  const version = await prompt(
    `  Version ${chalk.dim(`[${DEFAULT_CONFIG.version}]`)}: `,
    DEFAULT_CONFIG.version
  );

  const appId = await prompt(
    `  App ID (reverse domain) ${chalk.dim(`[${DEFAULT_CONFIG.appId}]`)}: `,
    DEFAULT_CONFIG.appId
  );

  const source = await prompt(
    `  Source directory ${chalk.dim("[.]")}: `,
    "."
  );

  const targetsRaw = await prompt(
    `  Targets (windows, linux, mac, android, ios) ${chalk.dim("[windows,linux]")}: `,
    "windows,linux"
  );
  const targets = targetsRaw
    .split(",")
    .map((t) => t.trim())
    .filter((t) => ["windows", "linux", "mac", "android", "ios"].includes(t)) as Array<"windows" | "linux" | "mac" | "android" | "ios">;

  const backendPort = await prompt(
    `  Local backend port ${chalk.dim("[3001]")}: `,
    "3001"
  );

  const defaultAdmin = await prompt(
    `  Default admin email ${chalk.dim("[admin@app.local]")}: `,
    "admin@app.local"
  );

  const mode: "online" = "online";

  // ── Mobile-specific prompts (only shown when android/ios is in targets) ──
  const wantsAndroid = targets.includes("android");
  const wantsIos     = targets.includes("ios");

  let androidVariant: "debug" | "release" = "debug";
  let iosTeamId: string | undefined;

  if (wantsAndroid) {
    console.log(chalk.dim("\n  Android options:"));
    const variantInput = await prompt(
      `    Build variant (debug/release) ${chalk.dim("[debug]")}: `,
      "debug"
    );
    androidVariant = variantInput === "release" ? "release" : "debug";
  }

  if (wantsIos) {
    console.log(chalk.dim("\n  iOS options:"));
    console.log(chalk.dim("    (iOS builds require macOS + Xcode + CocoaPods)"));
    const teamInput = await prompt(
      `    Apple Development Team ID ${chalk.dim("[leave blank to skip]")}: `,
      ""
    );
    if (teamInput) iosTeamId = teamInput;
  }

  const mobileConfig = (wantsAndroid || wantsIos)
    ? {
        mobile: {
          ...(wantsAndroid && { android: { buildVariant: androidVariant } }),
          ...(wantsIos && iosTeamId && { ios: { developmentTeam: iosTeamId } }),
        },
      }
    : {};

  return {
    name,
    version,
    appId,
    source,
    mode,
    targets: targets.length ? targets : ["windows", "linux"],
    backend: { type: "auto", port: parseInt(backendPort, 10) || 3001 },
    auth: { type: "local", defaultAdmin },
    database: { type: "sqlite" },
    ...mobileConfig,
  };
}

async function prompt(question: string, defaultValue: string): Promise<string> {
  const rl = readline.createInterface({
    input: process.stdin,
    output: process.stdout,
  });
  try {
    const answer = await rl.question(question);
    return answer.trim() || defaultValue;
  } finally {
    rl.close();
  }
}

async function readPackageName(dir: string): Promise<string | null> {
  try {
    const raw = await fs.readFile(path.join(dir, "package.json"), "utf-8");
    const pkg = JSON.parse(raw) as { name?: string };
    return pkg.name
      ? pkg.name
          .replace(/^@[^/]+\//, "") // strip scope
          .replace(/-/g, " ")
          .replace(/\b\w/g, (c) => c.toUpperCase())
      : null;
  } catch {
    return null;
  }
}
