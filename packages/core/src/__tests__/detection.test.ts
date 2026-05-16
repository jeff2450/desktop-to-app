import { describe, it, expect, beforeEach, afterEach } from "vitest";
import * as path from "node:path";
import * as fs from "node:fs/promises";
import * as os from "node:os";

/**
 * Unit tests for the Stage 01 detection helpers.
 *
 * Because runDetectStage() reads from disk, we set up temporary
 * project fixtures in a temp directory and test the exported helpers
 * via the public types.
 *
 * We test the most important inner functions by running the full
 * detection stage against fixture projects.
 */

// Helpers to create fixture source projects
async function createFixture(
  tmpDir: string,
  files: Record<string, string>
): Promise<void> {
  for (const [rel, content] of Object.entries(files)) {
    const abs = path.join(tmpDir, rel);
    await fs.mkdir(path.dirname(abs), { recursive: true });
    await fs.writeFile(abs, content, "utf-8");
  }
}

// ─── Framework detection ───────────────────────────────────────────────────────

describe("Detection — framework + bundler via package.json", () => {
  let tmpDir: string;

  beforeEach(async () => {
    tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), "webtoapp-detect-"));
  });

  afterEach(async () => {
    await fs.rm(tmpDir, { recursive: true, force: true });
  });

  it("detects React + Vite + Supabase stack", async () => {
    await createFixture(tmpDir, {
      "package.json": JSON.stringify({
        dependencies: {
          react: "^18.0.0",
          "@supabase/supabase-js": "^2.0.0",
        },
        devDependencies: { vite: "^5.0.0" },
      }),
      "index.html": "<!DOCTYPE html><html><body><div id='root'></div></body></html>",
      "src/App.tsx": `import { supabase } from '@/lib/supabase';`,
    });

    // Dynamic import to avoid module caching issues
    const { runDetectStage } = await import("../pipeline/stages/01-detect.js");
    const { PipelineContext } = await import("../pipeline/PipelineContext.js");

    const ctx = new PipelineContext({
      config: {
        name: "Test",
        version: "1.0.0",
        source: tmpDir,
        targets: ["windows"],
        mode: "offline",
        appId: "com.test.app",
        backend: { type: "auto", port: 3001 },
        auth: { type: "local" },
        database: { type: "sqlite" },
      },
      sourceDir: tmpDir,
      outputDir: path.join(tmpDir, "out"),
      workDir: tmpDir,
    });

    await runDetectStage(ctx);

    expect(ctx.detection?.framework).toBe("react");
    expect(ctx.detection?.bundler).toBe("vite");
    expect(ctx.detection?.backend).toBe("supabase");
    expect(ctx.detection?.auth).toBe("supabase");
    expect(ctx.detection?.confidence).toBeGreaterThan(0.5);
  });

  it("detects Vue framework", async () => {
    await createFixture(tmpDir, {
      "package.json": JSON.stringify({
        dependencies: { vue: "^3.0.0" },
        devDependencies: { vite: "^5.0.0" },
      }),
      "index.html": "<html><body></body></html>",
      "src/App.vue": `<template><div>Hello</div></template>`,
    });

    const { runDetectStage } = await import("../pipeline/stages/01-detect.js");
    const { PipelineContext } = await import("../pipeline/PipelineContext.js");

    const ctx = new PipelineContext({
      config: {
        name: "Test",
        version: "1.0.0",
        source: tmpDir,
        targets: ["linux"],
        mode: "online",
        appId: "com.test.vue",
        backend: { type: "none" },
        auth: { type: "none" },
        database: { type: "none" },
      },
      sourceDir: tmpDir,
      outputDir: path.join(tmpDir, "out"),
      workDir: tmpDir,
    });

    await runDetectStage(ctx);
    expect(ctx.detection?.framework).toBe("vue");
  });

  it("warns on low confidence when no framework is detected", async () => {
    await createFixture(tmpDir, {
      "package.json": JSON.stringify({ dependencies: {} }),
      "index.html": "<html></html>",
      "src/index.js": "console.log('hello');",
    });

    const { runDetectStage } = await import("../pipeline/stages/01-detect.js");
    const { PipelineContext } = await import("../pipeline/PipelineContext.js");

    const ctx = new PipelineContext({
      config: {
        name: "Test",
        version: "1.0.0",
        source: tmpDir,
        targets: ["windows"],
        mode: "offline",
        appId: "com.test.plain",
        backend: { type: "auto" },
        auth: { type: "local" },
        database: { type: "sqlite" },
      },
      sourceDir: tmpDir,
      outputDir: path.join(tmpDir, "out"),
      workDir: tmpDir,
    });

    await runDetectStage(ctx);
    expect(ctx.detection?.warnings.some((w) => w.includes("framework"))).toBe(true);
  });
});

// ─── Table detection ──────────────────────────────────────────────────────────

describe("Detection — table extraction", () => {
  let tmpDir: string;

  beforeEach(async () => {
    tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), "webtoapp-tables-"));
  });

  afterEach(async () => {
    await fs.rm(tmpDir, { recursive: true, force: true });
  });

  it("extracts tables from .from() scanning (Strategy 3 fallback)", async () => {
    await createFixture(tmpDir, {
      "package.json": JSON.stringify({
        dependencies: {
          react: "^18",
          "@supabase/supabase-js": "^2",
        },
        devDependencies: { vite: "^5" },
      }),
      "index.html": "<html><body></body></html>",
      "src/api/patients.ts": `
        import { supabase } from '@/lib/supabase';
        export const getPatients = () => supabase.from('patients').select('*');
        export const getAppointments = () => supabase.from('appointments').select('*');
      `,
    });

    const { runDetectStage } = await import("../pipeline/stages/01-detect.js");
    const { PipelineContext } = await import("../pipeline/PipelineContext.js");

    const ctx = new PipelineContext({
      config: {
        name: "Test",
        version: "1.0.0",
        source: tmpDir,
        targets: ["windows"],
        mode: "offline",
        appId: "com.test.clinic",
        backend: { type: "auto" },
        auth: { type: "local" },
        database: { type: "sqlite" },
      },
      sourceDir: tmpDir,
      outputDir: path.join(tmpDir, "out"),
      workDir: tmpDir,
    });

    await runDetectStage(ctx);

    expect(ctx.detection?.tables).toContain("patients");
    expect(ctx.detection?.tables).toContain("appointments");
    // Should not contain internal Supabase names
    expect(ctx.detection?.tables).not.toContain("auth");
    expect(ctx.detection?.tables).not.toContain("storage");
  });

  it("extracts tables from SQL migration files (Strategy 1)", async () => {
    await createFixture(tmpDir, {
      "package.json": JSON.stringify({
        dependencies: { react: "^18", "@supabase/supabase-js": "^2" },
        devDependencies: { vite: "^5" },
      }),
      "index.html": "<html></html>",
      "src/App.tsx": "export default function App() {}",
      "supabase/migrations/001_init.sql": `
        CREATE TABLE IF NOT EXISTS products (id UUID PRIMARY KEY, name TEXT NOT NULL);
        CREATE TABLE IF NOT EXISTS orders (id UUID PRIMARY KEY, product_id UUID);
      `,
    });

    const { runDetectStage } = await import("../pipeline/stages/01-detect.js");
    const { PipelineContext } = await import("../pipeline/PipelineContext.js");

    const ctx = new PipelineContext({
      config: {
        name: "Test",
        version: "1.0.0",
        source: tmpDir,
        targets: ["windows"],
        mode: "offline",
        appId: "com.test.shop",
        backend: { type: "auto" },
        auth: { type: "local" },
        database: { type: "sqlite" },
      },
      sourceDir: tmpDir,
      outputDir: path.join(tmpDir, "out"),
      workDir: tmpDir,
    });

    await runDetectStage(ctx);

    expect(ctx.detection?.tables).toContain("products");
    expect(ctx.detection?.tables).toContain("orders");
  });
});

// ─── Icon detection ───────────────────────────────────────────────────────────

describe("Detection — icon auto-detection", () => {
  it("detects public/icon.png", async () => {
    const tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), "webtoapp-icon-"));
    try {
      await createFixture(tmpDir, {
        "package.json": JSON.stringify({ dependencies: { react: "^18" }, devDependencies: { vite: "^5" } }),
        "index.html": "<html></html>",
        "src/App.tsx": "export default function App() {}",
        "public/icon.png": "fake-png-data",
      });

      const { runDetectStage } = await import("../pipeline/stages/01-detect.js");
      const { PipelineContext } = await import("../pipeline/PipelineContext.js");

      const ctx = new PipelineContext({
        config: {
          name: "Test",
          version: "1.0.0",
          source: tmpDir,
          targets: ["windows"],
          mode: "offline",
          appId: "com.test.icon",
          backend: { type: "auto" },
          auth: { type: "local" },
          database: { type: "sqlite" },
        },
        sourceDir: tmpDir,
        outputDir: path.join(tmpDir, "out"),
        workDir: tmpDir,
      });

      await runDetectStage(ctx);
      expect(ctx.detection?.iconPath).toBe("public/icon.png");
    } finally {
      await fs.rm(tmpDir, { recursive: true, force: true });
    }
  });
});
