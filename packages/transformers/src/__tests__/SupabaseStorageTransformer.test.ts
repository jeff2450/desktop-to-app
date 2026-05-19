import { describe, it, expect } from "vitest";
import { SupabaseStorageTransformer } from "../supabase/SupabaseStorageTransformer.js";

const transformer = new SupabaseStorageTransformer();

const ctx = {
  sourcePath: "src/lib/storage.ts",
  outputPath: "src/lib/storage.ts",
  projectRoot: "/fake/project",
};

// ─── canTransform ─────────────────────────────────────────────────────────────

describe("SupabaseStorageTransformer.canTransform", () => {
  it("returns true for supabase.storage references", () => {
    expect(
      transformer.canTransform(`await supabase.storage.from('avatars').upload(path, file);`)
    ).toBe(true);
  });

  it("returns true for .storage.from( pattern", () => {
    expect(
      transformer.canTransform(`supabase.storage.from('bucket').getPublicUrl('img.png')`)
    ).toBe(true);
  });

  it("returns false for unrelated content", () => {
    expect(transformer.canTransform(`const x = 1;`)).toBe(false);
  });
});

// ─── upload ───────────────────────────────────────────────────────────────────

describe("SupabaseStorageTransformer — upload", () => {
  it("rewrites storage.from().upload() to localApi equivalent", async () => {
    const input = `
import { createClient } from '@supabase/supabase-js';
const { data, error } = await supabase.storage.from('avatars').upload('user-1.png', file);
`;
    const result = await transformer.transform(input, ctx);

    expect(result.success).toBe(true);
    expect(result.transformedContent).toContain(
      `await localApi.storage.from('avatars').upload('user-1.png', file)`
    );
    expect(result.transformedContent).not.toContain("supabase.storage.from('avatars').upload");
    expect(result.changes.some((c) => c.includes("upload"))).toBe(true);
  });

  it("removes the @supabase/supabase-js import and adds localApi", async () => {
    const input = `
import { createClient } from '@supabase/supabase-js';
await supabase.storage.from('docs').upload('report.pdf', file);
`;
    const result = await transformer.transform(input, ctx);

    expect(result.success).toBe(true);
    expect(result.transformedContent).not.toContain("@supabase/supabase-js");
    expect(result.transformedContent).toContain("@/lib/localApi");
  });
});

// ─── download ─────────────────────────────────────────────────────────────────

describe("SupabaseStorageTransformer — download", () => {
  it("rewrites storage.from().download() to localApi equivalent", async () => {
    const input = `const { data } = await supabase.storage.from('avatars').download('user-1.png');`;
    const result = await transformer.transform(input, ctx);

    expect(result.success).toBe(true);
    expect(result.transformedContent).toContain(
      `await localApi.storage.from('avatars').download('user-1.png')`
    );
    expect(result.changes.some((c) => c.includes("download"))).toBe(true);
  });
});

// ─── getPublicUrl ─────────────────────────────────────────────────────────────

describe("SupabaseStorageTransformer — getPublicUrl", () => {
  it("rewrites getPublicUrl() (non-async) to localApi equivalent", async () => {
    const input = `const { data } = supabase.storage.from('images').getPublicUrl('photo.jpg');`;
    const result = await transformer.transform(input, ctx);

    expect(result.success).toBe(true);
    expect(result.transformedContent).toContain(
      `localApi.storage.from('images').getPublicUrl('photo.jpg')`
    );
    expect(result.changes.some((c) => c.includes("getPublicUrl"))).toBe(true);
  });
});

// ─── remove ───────────────────────────────────────────────────────────────────

describe("SupabaseStorageTransformer — remove", () => {
  it("rewrites storage.from().remove() to localApi equivalent", async () => {
    const input = `await supabase.storage.from('avatars').remove(['old-avatar.png']);`;
    const result = await transformer.transform(input, ctx);

    expect(result.success).toBe(true);
    expect(result.transformedContent).toContain(
      `await localApi.storage.from('avatars').remove(['old-avatar.png'])`
    );
    expect(result.changes.some((c) => c.includes("remove"))).toBe(true);
  });
});

// ─── list ─────────────────────────────────────────────────────────────────────

describe("SupabaseStorageTransformer — list", () => {
  it("rewrites storage.from().list() to localApi equivalent", async () => {
    const input = `const { data } = await supabase.storage.from('docs').list('reports');`;
    const result = await transformer.transform(input, ctx);

    expect(result.success).toBe(true);
    expect(result.transformedContent).toContain(
      `await localApi.storage.from('docs').list('reports')`
    );
    expect(result.changes.some((c) => c.includes("list"))).toBe(true);
  });

  it("rewrites list() with no folder argument", async () => {
    const input = `const { data } = await supabase.storage.from('bucket').list();`;
    const result = await transformer.transform(input, ctx);

    expect(result.success).toBe(true);
    expect(result.transformedContent).toContain(
      `await localApi.storage.from('bucket').list()`
    );
  });
});

// ─── Multiple operations in one file ─────────────────────────────────────────

describe("SupabaseStorageTransformer — multiple operations", () => {
  it("rewrites multiple storage calls in a single file", async () => {
    const input = `
import { createClient } from '@supabase/supabase-js';
const { data: uploaded } = await supabase.storage.from('avatars').upload('u1.png', file);
const { data: url } = supabase.storage.from('avatars').getPublicUrl('u1.png');
const { data: files } = await supabase.storage.from('avatars').list();
`;
    const result = await transformer.transform(input, ctx);

    expect(result.success).toBe(true);
    expect(result.transformedContent).not.toContain("@supabase/supabase-js");
    expect(result.transformedContent).toContain("localApi.storage.from('avatars').upload");
    expect(result.transformedContent).toContain("localApi.storage.from('avatars').getPublicUrl");
    expect(result.transformedContent).toContain("localApi.storage.from('avatars').list");
    expect(result.changes.length).toBeGreaterThanOrEqual(3);
  });
});

// ─── Warnings for unsupported operations ─────────────────────────────────────

describe("SupabaseStorageTransformer — warnings", () => {
  it("emits a warning for remaining storage references it could not convert", async () => {
    // createSignedUrl is not auto-rewritten — should trigger a warning
    const input = `
const { data } = await supabase.storage.from('private').createSignedUrl('file.pdf', 60);
`;
    const result = await transformer.transform(input, ctx);

    expect(result.success).toBe(true);
    expect(result.warnings.length).toBeGreaterThan(0);
    expect(result.warnings[0]).toMatch(/storage reference|could not be/i);
    expect(result.confidence).toBeLessThan(0.9);
  });
});

// ─── Edge cases ───────────────────────────────────────────────────────────────

describe("SupabaseStorageTransformer — edge cases", () => {
  it("handles an empty string without throwing", async () => {
    const result = await transformer.transform("", ctx);
    expect(result).toBeDefined();
    expect(typeof result.success).toBe("boolean");
  });

  it("returns a valid TransformResult shape", async () => {
    const input = `await supabase.storage.from('bucket').upload('file.txt', data);`;
    const result = await transformer.transform(input, ctx);

    expect(typeof result.success).toBe("boolean");
    expect(typeof result.transformedContent).toBe("string");
    expect(Array.isArray(result.changes)).toBe(true);
    expect(Array.isArray(result.warnings)).toBe(true);
    expect(typeof result.confidence).toBe("number");
    expect(result.confidence).toBeGreaterThanOrEqual(0);
    expect(result.confidence).toBeLessThanOrEqual(1);
  });
});
