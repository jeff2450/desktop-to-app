import path from "node:path";
import fs from "node:fs/promises";
import os from "node:os";
import readline from "node:readline/promises";
import chalk from "chalk";

const API_BASE = process.env["WEBTOAPP_API_URL"] ?? "https://api.webtoapp.dev";
const CREDENTIALS_PATH = path.join(os.homedir(), ".webtoapp", "credentials.json");

export interface LoginOptions {
  token?: string; // pass API token directly (for CI)
}

export interface StoredCredentials {
  token: string;
  email?: string;
  expiresAt?: string;
}

/**
 * webtoapp login
 *
 * Authenticates the user with the WebToApp SaaS platform and stores
 * the API token in ~/.webtoapp/credentials.json.
 *
 * In CI environments, pass --token <API_TOKEN> to skip interactive login.
 */
export async function loginCommand(options: LoginOptions): Promise<void> {
  console.log(chalk.bold.cyan("\n  WebToApp — Login\n"));

  let token: string;
  let email: string | undefined;

  if (options.token) {
    // CI mode — verify the supplied token
    token = options.token;
    console.log(chalk.dim("  Verifying token..."));
  } else {
    // Interactive mode
    console.log(`  ${chalk.dim("Log in at")} ${chalk.cyan("https://webtoapp.dev/account/tokens")}`);
    console.log(chalk.dim("  then paste your API token below.\n"));

    const rl = readline.createInterface({
      input: process.stdin,
      output: process.stdout,
    });

    try {
      token = (await rl.question("  API Token: ")).trim();
    } finally {
      rl.close();
    }

    if (!token) {
      console.error(chalk.red("  ✖ No token provided."));
      process.exit(1);
    }
  }

  // Verify token against the API
  const spinner = startSpinner("Verifying token...");
  try {
    const res = await fetch(`${API_BASE}/api/users/me`, {
      headers: { Authorization: `Bearer ${token}` },
    });

    stopSpinner(spinner);

    if (!res.ok) {
      const body = (await res.json().catch(() => ({}))) as { error?: string };
      console.error(chalk.red(`  ✖ Authentication failed: ${body.error ?? `HTTP ${res.status}`}`));
      process.exit(1);
    }

    const user = (await res.json()) as { email?: string; plan?: string };
    email = user.email;

    // Store credentials
    const credentials: StoredCredentials = {
      token,
      email,
      expiresAt: new Date(Date.now() + 90 * 24 * 60 * 60 * 1000).toISOString(), // 90 days
    };

    await fs.mkdir(path.dirname(CREDENTIALS_PATH), { recursive: true });
    await fs.writeFile(CREDENTIALS_PATH, JSON.stringify(credentials, null, 2) + "\n", {
      mode: 0o600, // owner read/write only
    });

    console.log(chalk.green(`\n  ✔ Logged in as ${email ?? "unknown"}`));
    if (user.plan) console.log(`  ${chalk.dim("Plan:")} ${user.plan}`);
    console.log(chalk.dim(`  Credentials saved to ${CREDENTIALS_PATH}\n`));
  } catch (err) {
    stopSpinner(spinner);
    if ((err as NodeJS.ErrnoException).code === "ECONNREFUSED") {
      console.error(chalk.red("  ✖ Could not connect to WebToApp API. Check your internet connection."));
    } else {
      console.error(chalk.red(`  ✖ ${(err as Error).message}`));
    }
    process.exit(1);
  }
}

/**
 * Load stored credentials — used by other commands that need auth.
 * Returns null if the user is not logged in.
 */
export async function loadCredentials(): Promise<StoredCredentials | null> {
  try {
    const raw = await fs.readFile(CREDENTIALS_PATH, "utf-8");
    const creds = JSON.parse(raw) as StoredCredentials;

    // Check expiry
    if (creds.expiresAt && new Date(creds.expiresAt) < new Date()) {
      return null;
    }

    return creds;
  } catch {
    return null;
  }
}

/**
 * webtoapp logout — removes stored credentials.
 */
export async function logoutCommand(): Promise<void> {
  try {
    await fs.rm(CREDENTIALS_PATH, { force: true });
    console.log(chalk.green("\n  ✔ Logged out successfully.\n"));
  } catch {
    console.log(chalk.dim("\n  Not logged in.\n"));
  }
}

// ── Tiny spinner (no external dep needed here) ─────────────────────────────

function startSpinner(text: string): ReturnType<typeof setInterval> {
  const frames = ["⠋", "⠙", "⠹", "⠸", "⠼", "⠴", "⠦", "⠧", "⠇", "⠏"];
  let i = 0;
  process.stdout.write(`  ${frames[0]} ${text}`);
  return setInterval(() => {
    process.stdout.write(`\r  ${frames[i++ % frames.length]} ${text}`);
  }, 80);
}

function stopSpinner(id: ReturnType<typeof setInterval>): void {
  clearInterval(id);
  process.stdout.write("\r\x1b[K"); // clear line
}
