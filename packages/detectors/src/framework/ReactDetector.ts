import path from "node:path";
import fs from "node:fs/promises";

export interface FrameworkDetection {
  framework: "react" | "vue" | "svelte" | "angular" | "unknown";
  bundler: "vite" | "webpack" | "next" | "unknown";
  confidence: number;
  warnings: string[];
}

/**
 * Detects React projects and identifies which bundler/meta-framework is in use.
 * Supports: React + Vite, CRA (react-scripts), and Next.js.
 */
export class ReactDetector {
  async detect(
    sourceDir: string,
    deps: Record<string, string>,
    devDeps: Record<string, string>
  ): Promise<FrameworkDetection | null> {
    const all = { ...deps, ...devDeps };

    const hasReact = "react" in all;
    const hasReactDom = "react-dom" in all;

    if (!hasReact || !hasReactDom) return null;

    const warnings: string[] = [];
    let confidence = 0.9;
    let bundler: FrameworkDetection["bundler"] = "unknown";

    // ── Next.js ───────────────────────────────────────────────────
    if ("next" in all) {
      bundler = "next";
      // Next.js apps need extra handling — server components, API routes, etc.
      warnings.push(
        "Next.js detected. Server components and API routes will be stripped. " +
          "Only the client-side portion will be converted."
      );
      confidence = 0.75;
    }
    // ── Vite ──────────────────────────────────────────────────────
    else if ("vite" in all || "vite" in devDeps) {
      bundler = "vite";

      // Check for vite.config file
      const hasViteConfig = await this.fileExists(path.join(sourceDir, "vite.config.ts"))
        || await this.fileExists(path.join(sourceDir, "vite.config.js"));

      if (!hasViteConfig) {
        warnings.push("Vite dependency found but no vite.config file detected.");
        confidence = 0.8;
      }
    }
    // ── CRA / Webpack ─────────────────────────────────────────────
    else if ("react-scripts" in all || "webpack" in all) {
      bundler = "webpack";
      warnings.push(
        "CRA / Webpack detected. Consider migrating to Vite for better Electron compatibility."
      );
      confidence = 0.85;
    } else {
      warnings.push("React detected but bundler is unknown. Defaulting to Vite config.");
      bundler = "vite";
      confidence = 0.65;
    }

    // Check React version — v18+ required
    const reactVersion = all["react"] ?? "";
    const majorVersion = parseInt(reactVersion.replace(/[\^~>=]/, ""), 10);
    if (!isNaN(majorVersion) && majorVersion < 18) {
      warnings.push(
        `React ${reactVersion} detected. React 18+ is recommended for Electron compatibility.`
      );
      confidence -= 0.1;
    }

    return {
      framework: "react",
      bundler,
      confidence: Math.max(confidence, 0),
      warnings,
    };
  }

  private async fileExists(p: string): Promise<boolean> {
    return fs.access(p).then(() => true).catch(() => false);
  }
}
