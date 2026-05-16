import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { transformFile } from "../index.js";
import * as path from "node:path";
import * as fs from "node:fs/promises";
import * as os from "node:os";

let tmpDir: string;

beforeAll(async () => {
  tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), "transformfile-test-"));
});

afterAll(async () => {
  await fs.rm(tmpDir, { recursive: true, force: true });
});

async function writeTmp(relPath: string, content: string): Promise<string> {
  const abs = path.join(tmpDir, relPath);
  await fs.mkdir(path.dirname(abs), { recursive: true });
  await fs.writeFile(abs, content, "utf-8");
  return abs;
}

/**
 * Integration tests for transformFile() — the main entrypoint used by Stage 03.
 * These tests exercise the transformer dispatch table and ensure the
 * correct transformer is selected for each type.
 */

const projectRoot = tmpDir;

describe("transformFile — supabase-query", () => {
  it("successfully transforms a file with SELECT", async () => {
    const absPath = await writeTmp("DataTable.tsx",
      `import { supabase } from '@/lib/supabase';
const { data } = await supabase.from('users').select('*');
`
    );
    const result = await transformFile({
      sourcePath: absPath,
      outputPath: absPath,
      transformerType: "supabase-query",
      projectRoot,
    });
    expect(result.success).toBe(true);
    expect(result.transformedContent).toContain("localApi.from('users')");
  });

  it("returns success=false for unknown transformer type", async () => {
    const absPath = await writeTmp("unknown.ts", `export const x = 1;`);
    const result = await transformFile({
      sourcePath: absPath,
      outputPath: absPath,
      // @ts-expect-error intentional invalid type for test
      transformerType: "not-a-real-transformer",
      projectRoot,
    });
    expect(result.success).toBe(false);
    expect(result.error).toContain("Unknown transformer type");
  });
});

describe("transformFile — supabase-auth", () => {
  it("dispatches correctly for supabase-auth type", async () => {
    const absPath = await writeTmp("useAuth.ts", `export const placeholder = true;`);
    const result = await transformFile({
      sourcePath: absPath,
      outputPath: absPath,
      transformerType: "supabase-auth",
      projectRoot,
    });
    expect(result.success).toBe(true);
    // No supabase auth content → canTransform returns false → passes through unchanged
    expect(result.confidence).toBe(1.0);
  });
});

describe("transformFile — firebase-firestore", () => {
  it("dispatches correctly for firebase-firestore type", async () => {
    const absPath = await writeTmp("db.ts", `export const placeholder = true;`);
    const result = await transformFile({
      sourcePath: absPath,
      outputPath: absPath,
      transformerType: "firebase-firestore",
      projectRoot,
    });
    expect(result.success).toBe(true);
  });
});

describe("transformFile — clerk-auth", () => {
  it("dispatches correctly for clerk-auth type", async () => {
    const absPath = await writeTmp("middleware.ts", `export const placeholder = true;`);
    const result = await transformFile({
      sourcePath: absPath,
      outputPath: absPath,
      transformerType: "clerk-auth",
      projectRoot,
    });
    expect(result.success).toBe(true);
  });
});

describe("transformFile — auth0", () => {
  it("dispatches correctly for auth0 type", async () => {
    const absPath = await writeTmp("provider.tsx", `export const placeholder = true;`);
    const result = await transformFile({
      sourcePath: absPath,
      outputPath: absPath,
      transformerType: "auth0",
      projectRoot,
    });
    expect(result.success).toBe(true);
  });
});
