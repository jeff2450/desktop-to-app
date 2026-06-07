import { describe, it, expect, beforeEach, afterEach } from "vitest";
import * as path from "node:path";
import * as fs from "node:fs/promises";
import * as os from "node:os";

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
    mode: "online",
    targets: ["linux"],
    backend: { type: "none" },
    auth: { type: "none" },
    database: { type: "none" },
    ...overrides,
  };
}

describe("Conversion — Live Website URL Wrapper", () => {
  it("passes preflight validation and designs a React iframe plan for a URL source", async () => {
    const { ConversionPipeline } = await import("../pipeline/ConversionPipeline.js");

    const dryRunPipeline = new ConversionPipeline(
      baseConfig({ source: "https://example-wordpress.com", dryRun: true }) as any
    );
    const dryRunRes = await dryRunPipeline.run();

    expect(dryRunRes.status).toBe("success");
    expect(dryRunRes.detectionResult?.isLiveUrl).toBe(true);
    expect(dryRunRes.detectionResult?.liveUrl).toBe("https://example-wordpress.com");
    expect(dryRunRes.detectionResult?.framework).toBe("react");
    expect(dryRunRes.detectionResult?.bundler).toBe("vite");

    // The migration plan should contain our generated iframe wrapper files
    const generatedPaths = dryRunRes.stages
      .find(s => s.name === "02-plan")
      ? dryRunRes.logs.map(l => l.message)
      : [];

    expect(dryRunRes.logs.some(l => l.message.includes("index.html") && l.message.includes("generate"))).toBe(true);
    expect(dryRunRes.logs.some(l => l.message.includes("App.jsx") && l.message.includes("generate"))).toBe(true);
    expect(dryRunRes.logs.some(l => l.message.includes("main.jsx") && l.message.includes("generate"))).toBe(true);
  });
});

describe("Conversion — Local Plain Static Website", () => {
  let tmpDir: string;

  beforeEach(async () => {
    tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), "webtoapp-static-"));
  });

  afterEach(async () => {
    await fs.rm(tmpDir, { recursive: true, force: true });
  });

  it("passes preflight check and generates package.json / vite.config for folder with just index.html", async () => {
    await createFixture(tmpDir, {
      "index.html": "<!DOCTYPE html><html><head><title>My Static Site</title></head><body><h1>Hello World</h1></body></html>",
      "styles.css": "body { color: blue; }",
      "script.js": "console.log('static site loaded');",
    });

    const { ConversionPipeline } = await import("../pipeline/ConversionPipeline.js");
    const pipeline = new ConversionPipeline(
      baseConfig({ source: tmpDir, dryRun: true }) as any
    );

    const res = await pipeline.run();

    expect(res.status).toBe("success");
    expect(res.detectionResult?.isStaticPlain).toBe(true);
    expect(res.detectionResult?.framework).toBe("static");
    expect(res.detectionResult?.bundler).toBe("vite");
    
    // Scanned files should include our static assets
    expect(res.detectionResult?.scannedFiles.some(f => f.endsWith("index.html"))).toBe(true);
    expect(res.detectionResult?.scannedFiles.some(f => f.endsWith("styles.css"))).toBe(true);
    expect(res.detectionResult?.scannedFiles.some(f => f.endsWith("script.js"))).toBe(true);
  });

  it("correctly identifies static plain site and scans root assets when a non-frontend src directory exists", async () => {
    await createFixture(tmpDir, {
      "index.html": "<!DOCTYPE html><html><head><link rel='stylesheet' href='style.css'></head><body><script src='script.js'></script></body></html>",
      "style.css": "body { background: black; }",
      "script.js": "console.log('loaded');",
      "src/main/java/com/example/App.java": "public class App {}",
    });

    const { ConversionPipeline } = await import("../pipeline/ConversionPipeline.js");
    const pipeline = new ConversionPipeline(
      baseConfig({ source: tmpDir, dryRun: true }) as any
    );

    const res = await pipeline.run();

    expect(res.status).toBe("success");
    expect(res.detectionResult?.isStaticPlain).toBe(true);
    expect(res.detectionResult?.framework).toBe("static");
    expect(res.detectionResult?.scannedFiles.some(f => f.endsWith("style.css"))).toBe(true);
    expect(res.detectionResult?.scannedFiles.some(f => f.endsWith("script.js"))).toBe(true);
    expect(res.detectionResult?.scannedFiles.some(f => f.endsWith("App.java"))).toBe(false);
  });
});
