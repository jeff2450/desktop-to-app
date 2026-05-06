import { exec } from "node:child_process";
import { promisify } from "node:util";
import chalk from "chalk";

const execAsync = promisify(exec);

interface DependencyCheck {
  name: string;
  command: string;
  versionFlag: string;
  required: boolean;
  minVersion?: string;
  hint: string;
}

const CHECKS: DependencyCheck[] = [
  {
    name: "Node.js",
    command: "node",
    versionFlag: "--version",
    required: true,
    minVersion: "20.0.0",
    hint: "Install from https://nodejs.org (v20 LTS or later)",
  },
  {
    name: "pnpm",
    command: "pnpm",
    versionFlag: "--version",
    required: true,
    minVersion: "9.0.0",
    hint: "Run: npm install -g pnpm",
  },
  {
    name: "Docker",
    command: "docker",
    versionFlag: "--version",
    required: false,
    hint: "Required for cross-platform builds. Install from https://docker.com",
  },
  {
    name: "Wine (Windows builds on Linux)",
    command: "wine",
    versionFlag: "--version",
    required: false,
    hint: "Required to build Windows installers on Linux. Run: sudo apt install wine",
  },
  {
    name: "Git",
    command: "git",
    versionFlag: "--version",
    required: true,
    hint: "Install from https://git-scm.com",
  },
];

/**
 * webtoapp doctor
 *
 * Checks that all system dependencies are installed and at the right version.
 */
export async function doctorCommand(): Promise<void> {
  console.log(chalk.bold.cyan("\n  WebToApp — System Check\n"));

  let allGood = true;
  const results: Array<{ name: string; ok: boolean; version?: string; error?: string }> = [];

  for (const check of CHECKS) {
    try {
      const { stdout } = await execAsync(`${check.command} ${check.versionFlag}`);
      const version = stdout.trim().replace(/^v/, "");

      let versionOk = true;
      if (check.minVersion) {
        versionOk = compareVersions(version, check.minVersion) >= 0;
      }

      results.push({ name: check.name, ok: versionOk, version });

      if (!versionOk) {
        allGood = false;
        console.log(
          `  ${chalk.red("✖")} ${check.name.padEnd(35)} ${chalk.red(`v${version} (need ≥${check.minVersion})`)}`
        );
        console.log(`    ${chalk.dim(check.hint)}`);
      } else {
        console.log(
          `  ${chalk.green("✔")} ${check.name.padEnd(35)} ${chalk.dim(`v${version}`)}`
        );
      }
    } catch {
      results.push({ name: check.name, ok: false, error: "Not found" });

      if (check.required) {
        allGood = false;
        console.log(`  ${chalk.red("✖")} ${check.name.padEnd(35)} ${chalk.red("Not installed")}`);
      } else {
        console.log(`  ${chalk.yellow("–")} ${check.name.padEnd(35)} ${chalk.dim("Not installed (optional)")}`);
      }
      console.log(`    ${chalk.dim(check.hint)}`);
    }
  }

  console.log();

  if (allGood) {
    console.log(chalk.green("  ✔ All required dependencies are installed.\n"));
    console.log(chalk.dim("  Run 'webtoapp init' to set up your project.\n"));
  } else {
    console.log(chalk.red("  ✖ Some required dependencies are missing.\n"));
    console.log(chalk.dim("  Fix the issues above, then run 'webtoapp doctor' again.\n"));
    process.exit(1);
  }
}

function compareVersions(a: string, b: string): number {
  const pa = a.split(".").map(Number);
  const pb = b.split(".").map(Number);
  const len = Math.max(pa.length, pb.length);

  for (let i = 0; i < len; i++) {
    const diff = (pa[i] ?? 0) - (pb[i] ?? 0);
    if (diff !== 0) return diff;
  }
  return 0;
}
