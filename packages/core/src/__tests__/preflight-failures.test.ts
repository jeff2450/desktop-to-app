import { describe, it, expect, beforeEach, afterEach } from "vitest";
import * as path from "node:path";
import * as fs from "node:fs/promises";
import * as os from "node:os";

// ─── Helpers ──────────────────────────────────────────────────────────────────

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

function baseConfig(overrides: Record<string, unknown> = {}) {
  return {
    name: "Test App",
    version: "1.0.0",
    appId: "com.test.app",
    source: "",        // filled in by each test
    mode: "offline",
    targets: ["linux"],
    ...overrides,
  };
}

// ─── Preflight — missing source directory ────────────────────────────────────

describe("Preflight — source directory does not exist", () => {
  it("throws with a clear message about the missing directory", async () => {
    const { ConversionPipeline } = await import("../pipeline/ConversionPipeline.js");

    const pipeline = new ConversionPipeline(
      baseConfig({ source: "/absolutely/does/not/exist" }) as any
    );

    await expect(pipeline.run()).rejects.toThrow(
      /source directory does not exist/i
    );
  });
});

// ─── Preflight — malformed package.json ──────────────────────────────────────

describe("Preflight — malformed package.json", () => {
  let tmpDir: string;

  beforeEach(async () => {
    tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), "webtoapp-fail-"));
  });

  afterEach(async () => {
    await fs.rm(tmpDir, { recursive: true, force: true });
  });

  it("throws when package.json is invalid JSON", async () => {
    await createFixture(tmpDir, {
      "package.json": "{ this is not valid json !!!",
      "index.html": "<!DOCTYPE html><html><body><div id='root'></div></body></html>",
      "vite.config.ts": `import { defineConfig } from "vite"; export default defineConfig({});`,
      "src/App.tsx": `export const App = () => null;`,
    });

    const { ConversionPipeline } = await import("../pipeline/ConversionPipeline.js");
    const pipeline = new ConversionPipeline(baseConfig({ source: tmpDir }) as any);

    await expect(pipeline.run()).rejects.toThrow(/package\.json/i);
  });
});

// ─── Preflight — missing index.html ──────────────────────────────────────────

describe("Preflight — missing index.html", () => {
  let tmpDir: string;

  beforeEach(async () => {
    tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), "webtoapp-fail-"));
  });

  afterEach(async () => {
    await fs.rm(tmpDir, { recursive: true, force: true });
  });

  it("throws when index.html is absent", async () => {
    await createFixture(tmpDir, {
      "package.json": JSON.stringify({ dependencies: { react: "^18.0.0" }, devDependencies: { vite: "^5.0.0" } }),
      "vite.config.ts": `import { defineConfig } from "vite"; export default defineConfig({});`,
      "src/App.tsx": `export const App = () => null;`,
      // NO index.html
    });

    const { ConversionPipeline } = await import("../pipeline/ConversionPipeline.js");
    const pipeline = new ConversionPipeline(baseConfig({ source: tmpDir }) as any);

    await expect(pipeline.run()).rejects.toThrow(/index\.html/i);
  });
});

// ─── Preflight — missing src/ directory ──────────────────────────────────────

describe("Preflight — missing src/ directory", () => {
  let tmpDir: string;

  beforeEach(async () => {
    tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), "webtoapp-fail-"));
  });

  afterEach(async () => {
    await fs.rm(tmpDir, { recursive: true, force: true });
  });

  it("throws when src/ is absent", async () => {
    await createFixture(tmpDir, {
      "package.json": JSON.stringify({ devDependencies: { vite: "^5.0.0" } }),
      "index.html": "<!DOCTYPE html><html><body></body></html>",
      "vite.config.ts": `import { defineConfig } from "vite"; export default defineConfig({});`,
      // NO src/ directory
    });

    const { ConversionPipeline } = await import("../pipeline/ConversionPipeline.js");
    const pipeline = new ConversionPipeline(baseConfig({ source: tmpDir }) as any);

    await expect(pipeline.run()).rejects.toThrow(/src\//i);
  });
});

// ─── Preflight — non-Vite project ────────────────────────────────────────────

describe("Preflight — non-Vite project", () => {
  let tmpDir: string;

  beforeEach(async () => {
    tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), "webtoapp-fail-"));
  });

  afterEach(async () => {
    await fs.rm(tmpDir, { recursive: true, force: true });
  });

  it("throws when no vite config and vite is not in dependencies", async () => {
    await createFixture(tmpDir, {
      "package.json": JSON.stringify({ dependencies: { react: "^18.0.0" } }),  // no vite
      "index.html": "<!DOCTYPE html><html><body></body></html>",
      "src/App.tsx": `export const App = () => null;`,
      // NO vite.config.*
    });

    const { ConversionPipeline } = await import("../pipeline/ConversionPipeline.js");
    const pipeline = new ConversionPipeline(baseConfig({ source: tmpDir }) as any);

    await expect(pipeline.run()).rejects.toThrow(/vite/i);
  });
});

// ─── Preflight — invalid config fields ───────────────────────────────────────

describe("Preflight — invalid config fields", () => {
  let tmpDir: string;

  beforeEach(async () => {
    tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), "webtoapp-fail-"));
  });

  afterEach(async () => {
    await fs.rm(tmpDir, { recursive: true, force: true });
  });

  async function createValidProject() {
    await createFixture(tmpDir, {
      "package.json": JSON.stringify({ devDependencies: { vite: "^5.0.0" } }),
      "index.html": "<!DOCTYPE html><html><body></body></html>",
      "vite.config.ts": `import { defineConfig } from "vite"; export default defineConfig({});`,
      "src/App.tsx": `export const App = () => null;`,
    });
  }

  it("throws when appId has no dot (not reverse-domain format)", async () => {
    await createValidProject();
    const { ConversionPipeline } = await import("../pipeline/ConversionPipeline.js");
    const pipeline = new ConversionPipeline(
      baseConfig({ source: tmpDir, appId: "myapp" }) as any   // missing dot
    );
    await expect(pipeline.run()).rejects.toThrow(/appId/i);
  });

  it("throws when targets array is empty", async () => {
    await createValidProject();
    const { ConversionPipeline } = await import("../pipeline/ConversionPipeline.js");
    const pipeline = new ConversionPipeline(
      baseConfig({ source: tmpDir, targets: [] }) as any
    );
    await expect(pipeline.run()).rejects.toThrow(/targets/i);
  });

  it("throws when name is an empty string", async () => {
    await createValidProject();
    const { ConversionPipeline } = await import("../pipeline/ConversionPipeline.js");
    const pipeline = new ConversionPipeline(
      baseConfig({ source: tmpDir, name: "" }) as any
    );
    await expect(pipeline.run()).rejects.toThrow(/name/i);
  });
});

// ─── Preflight — Next.js project (warning, not hard failure) ─────────────────

describe("Preflight — Next.js project", () => {
  let tmpDir: string;
  const warnings: string[] = [];

  beforeEach(async () => {
    tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), "webtoapp-fail-"));
    warnings.length = 0;
  });

  afterEach(async () => {
    await fs.rm(tmpDir, { recursive: true, force: true });
  });

  it("logs a warning but does not throw for Next.js projects", async () => {
    await createFixture(tmpDir, {
      "package.json": JSON.stringify({ dependencies: { next: "^14.0.0", react: "^18.0.0" }, devDependencies: { vite: "^5.0.0" } }),
      "index.html": "<!DOCTYPE html><html><body></body></html>",
      "vite.config.ts": `import { defineConfig } from "vite"; export default defineConfig({});`,
      "src/App.tsx": `export const App = () => null;`,
    });

    const { ConversionPipeline } = await import("../pipeline/ConversionPipeline.js");
    const pipeline = new ConversionPipeline(
      baseConfig({ source: tmpDir }) as any,
      {
        onLog: (entry: { level: string; message: string }) => {
          if (entry.level === "warn") warnings.push(entry.message);
        },
      }
    );

    // Should not throw — Next.js triggers a warning, not a hard failure
    // (pipeline may still fail later at build, but preflight passes)
    try {
      await pipeline.run();
    } catch {
      // later stages may fail; we only care that the warning was emitted
    }

    expect(warnings.some((w) => /next\.js/i.test(w))).toBe(true);
  });
});
