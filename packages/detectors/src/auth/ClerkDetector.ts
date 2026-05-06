import path from "node:path";
import fs from "node:fs/promises";

export interface ClerkDetectionResult {
  isClerk: boolean;
  usesReact: boolean;
  usesNextjs: boolean;
  hasClerkProvider: boolean;
  confidence: number;
}

export class ClerkDetector {
  constructor(private readonly projectRoot: string) {}

  async detect(): Promise<ClerkDetectionResult> {
    const pkg = await this.readDeps();
    const allDeps = { ...pkg.dependencies, ...pkg.devDependencies };

    const usesReact  = "@clerk/clerk-react" in allDeps;
    const usesNextjs = "@clerk/nextjs" in allDeps;
    const isClerk = usesReact || usesNextjs;

    if (!isClerk) {
      return { isClerk: false, usesReact: false, usesNextjs: false, hasClerkProvider: false, confidence: 0 };
    }

    // Check for ClerkProvider in source
    const hasClerkProvider = await this.searchInSource("ClerkProvider");

    return { isClerk, usesReact, usesNextjs, hasClerkProvider, confidence: 0.95 };
  }

  private async searchInSource(term: string): Promise<boolean> {
    const srcDir = path.join(this.projectRoot, "src");
    async function walk(dir: string): Promise<boolean> {
      const entries = await fs.readdir(dir, { withFileTypes: true }).catch(() => []);
      for (const e of entries) {
        const full = path.join(dir, e.name);
        if (e.isDirectory() && !["node_modules", "dist"].includes(e.name)) {
          if (await walk(full)) return true;
        } else if (/\.(ts|tsx|js|jsx)$/.test(e.name)) {
          const c = await fs.readFile(full, "utf-8").catch(() => "");
          if (c.includes(term)) return true;
        }
      }
      return false;
    }
    return walk(srcDir).catch(() => false);
  }

  private async readDeps(): Promise<{ dependencies?: Record<string, string>; devDependencies?: Record<string, string> }> {
    try {
      const raw = await fs.readFile(path.join(this.projectRoot, "package.json"), "utf-8");
      return JSON.parse(raw) as { dependencies?: Record<string, string>; devDependencies?: Record<string, string> };
    } catch { return {}; }
  }
}
