import path from "node:path";
import fs from "node:fs/promises";
import { execFile } from "node:child_process";
import { promisify } from "node:util";

const execFileAsync = promisify(execFile);

const GITHUB_TOKEN = process.env["GITHUB_TOKEN"];
const MAX_REPO_SIZE_MB = parseInt(process.env["MAX_REPO_SIZE_MB"] ?? "500");
const CLONE_TIMEOUT_MS = parseInt(process.env["CLONE_TIMEOUT_MS"] ?? "120000"); // 2 min

export interface CloneOptions {
  repoUrl: string;
  destDir: string;
  branch?: string;
  onLog?: (line: string) => void;
}

export interface RepoMetadata {
  name: string;
  defaultBranch: string;
  sizeKb: number;
  isPrivate: boolean;
  topics: string[];
  description?: string;
}

/**
 * GitHub service — validates, clones, and inspects source repositories.
 *
 * Supports:
 *  - Public repos (no token needed)
 *  - Private repos (via GITHUB_TOKEN env var)
 *  - Specific branches / tags
 *  - Size limit enforcement (default 500MB)
 */
export class GitHubService {
  /**
   * Clone a GitHub repository into destDir.
   * Uses a shallow clone (depth=1) for speed.
   */
  async cloneRepo(opts: CloneOptions): Promise<void> {
    const { repoUrl, destDir, branch, onLog = console.log } = opts;

    const normalised = this.normaliseUrl(repoUrl);
    onLog(`[github] Cloning ${normalised}`);

    await fs.mkdir(destDir, { recursive: true });

    const args = [
      "clone",
      "--depth", "1",
      "--single-branch",
    ];

    if (branch) {
      args.push("--branch", branch);
    }

    // Inject token for private repos
    const cloneUrl = GITHUB_TOKEN
      ? normalised.replace("https://", `https://${GITHUB_TOKEN}@`)
      : normalised;

    args.push(cloneUrl, destDir);

    await this.runGit(args, onLog);
    onLog(`[github] Clone complete → ${destDir}`);
  }

  /**
   * Fetch repo metadata from the GitHub API without cloning.
   * Used to validate size and check repo exists before queuing.
   */
  async getRepoMetadata(repoUrl: string): Promise<RepoMetadata> {
    const { owner, repo } = this.parseRepoUrl(repoUrl);

    const headers: Record<string, string> = {
      Accept: "application/vnd.github+json",
      "X-GitHub-Api-Version": "2022-11-28",
    };

    if (GITHUB_TOKEN) {
      headers["Authorization"] = `Bearer ${GITHUB_TOKEN}`;
    }

    const res = await fetch(`https://api.github.com/repos/${owner}/${repo}`, { headers });

    if (res.status === 404) {
      throw new Error(`Repository not found: ${repoUrl}. Check the URL and make sure it's public (or add a GITHUB_TOKEN for private repos).`);
    }
    if (res.status === 403) {
      throw new Error("GitHub API rate limit exceeded. Add a GITHUB_TOKEN environment variable.");
    }
    if (!res.ok) {
      throw new Error(`GitHub API error: ${res.status} ${res.statusText}`);
    }

    const data = (await res.json()) as {
      name: string;
      default_branch: string;
      size: number;
      private: boolean;
      topics?: string[];
      description?: string;
    };

    return {
      name: data.name,
      defaultBranch: data.default_branch,
      sizeKb: data.size,
      isPrivate: data.private,
      topics: data.topics ?? [],
      description: data.description ?? undefined,
    };
  }

  /**
   * Validate a repo URL before cloning.
   * Checks: URL format, repo existence, size limit.
   */
  async validateRepo(repoUrl: string): Promise<{ valid: boolean; error?: string; metadata?: RepoMetadata }> {
    try {
      if (!this.isValidGithubUrl(repoUrl)) {
        return { valid: false, error: "Invalid GitHub URL. Expected format: https://github.com/owner/repo" };
      }

      const metadata = await this.getRepoMetadata(repoUrl);

      const sizeMb = metadata.sizeKb / 1024;
      if (sizeMb > MAX_REPO_SIZE_MB) {
        return {
          valid: false,
          error: `Repository is too large (${sizeMb.toFixed(0)}MB). Maximum allowed size is ${MAX_REPO_SIZE_MB}MB.`,
        };
      }

      return { valid: true, metadata };
    } catch (err) {
      return { valid: false, error: (err as Error).message };
    }
  }

  /**
   * Detect the branch a repo should be cloned from.
   * Prefers: explicit branch arg → common defaults (main, master).
   */
  async detectDefaultBranch(repoUrl: string): Promise<string> {
    try {
      const metadata = await this.getRepoMetadata(repoUrl);
      return metadata.defaultBranch;
    } catch {
      return "main";
    }
  }

  // ── Helpers ─────────────────────────────────────────────────────────────────

  private async runGit(args: string[], onLog: (l: string) => void): Promise<void> {
    return new Promise((resolve, reject) => {
      const { spawn } = require("node:child_process") as typeof import("node:child_process");
      const proc = spawn("git", args, { stdio: ["ignore", "pipe", "pipe"] });

      proc.stdout.on("data", (chunk: Buffer) => {
        chunk.toString().split("\n").filter(Boolean).forEach((l) => onLog(`[git] ${l}`));
      });
      proc.stderr.on("data", (chunk: Buffer) => {
        // git writes progress to stderr
        chunk.toString().split("\n").filter(Boolean).forEach((l) => onLog(`[git] ${l}`));
      });

      const timeout = setTimeout(() => {
        proc.kill();
        reject(new Error(`Git clone timed out after ${CLONE_TIMEOUT_MS / 1000}s`));
      }, CLONE_TIMEOUT_MS);

      proc.on("close", (code) => {
        clearTimeout(timeout);
        if (code === 0) resolve();
        else reject(new Error(`git exited with code ${code}`));
      });

      proc.on("error", (err) => {
        clearTimeout(timeout);
        reject(err);
      });
    });
  }

  private normaliseUrl(url: string): string {
    return url.replace(/\.git$/, "").trim();
  }

  private isValidGithubUrl(url: string): boolean {
    return /^https:\/\/github\.com\/[\w.-]+\/[\w.-]+/.test(url);
  }

  private parseRepoUrl(url: string): { owner: string; repo: string } {
    const match = url.match(/github\.com\/([\w.-]+)\/([\w.-]+)/);
    if (!match?.[1] || !match?.[2]) {
      throw new Error(`Cannot parse GitHub URL: ${url}`);
    }
    return { owner: match[1], repo: match[2].replace(/\.git$/, "") };
  }
}

export const githubService = new GitHubService();
