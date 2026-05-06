import path from "node:path";
import fs from "node:fs/promises";

export interface VueDetection {
  framework: "vue";
  bundler: "vite" | "webpack" | "unknown";
  vueVersion: 2 | 3;
  confidence: number;
  warnings: string[];
}

/**
 * Detects Vue.js 2 and 3 projects.
 */
export class VueDetector {
  async detect(
    sourceDir: string,
    deps: Record<string, string>,
    devDeps: Record<string, string>
  ): Promise<VueDetection | null> {
    const all = { ...deps, ...devDeps };

    if (!("vue" in all)) return null;

    const warnings: string[] = [];
    let confidence = 0.88;

    // ── Vue version ────────────────────────────────────────────────
    const vueVersionStr = all["vue"] ?? "";
    const major = parseInt(vueVersionStr.replace(/[\^~>=]/, ""), 10);
    const vueVersion: 2 | 3 = major === 2 ? 2 : 3;

    if (vueVersion === 2) {
      warnings.push(
        "Vue 2 detected. Vue 2 reached end-of-life in December 2023. " +
          "Conversion is supported but upgrading to Vue 3 is recommended."
      );
      confidence = 0.75;
    }

    // ── Bundler ────────────────────────────────────────────────────
    let bundler: VueDetection["bundler"] = "unknown";

    if ("vite" in all || "@vitejs/plugin-vue" in all) {
      bundler = "vite";
    } else if ("vue-cli-service" in all || "@vue/cli-service" in all || "webpack" in all) {
      bundler = "webpack";
      warnings.push("Vue CLI / Webpack detected. Consider migrating to Vite.");
    } else {
      const hasViteConfig =
        (await this.fileExists(path.join(sourceDir, "vite.config.ts"))) ||
        (await this.fileExists(path.join(sourceDir, "vite.config.js")));
      if (hasViteConfig) bundler = "vite";
    }

    if (bundler === "unknown") {
      warnings.push("Could not determine Vue bundler. Defaulting to Vite configuration.");
      bundler = "vite";
      confidence -= 0.1;
    }

    // ── Nuxt check ─────────────────────────────────────────────────
    if ("nuxt" in all || "@nuxt/core" in all) {
      warnings.push(
        "Nuxt.js detected. Server-side rendering, modules, and Nitro server will be stripped. " +
          "Only the Vue client components will be converted."
      );
      confidence -= 0.15;
    }

    return {
      framework: "vue",
      bundler,
      vueVersion,
      confidence: Math.max(confidence, 0),
      warnings,
    };
  }

  private async fileExists(p: string): Promise<boolean> {
    return fs.access(p).then(() => true).catch(() => false);
  }
}
