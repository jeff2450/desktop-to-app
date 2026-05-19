import { describe, it, expect } from "vitest";
import { SupabaseRealtimeTransformer } from "../supabase/SupabaseRealtimeTransformer.js";

const transformer = new SupabaseRealtimeTransformer();

const ctx = {
  sourcePath: "src/hooks/useRealtimeMessages.ts",
  outputPath: "src/hooks/useRealtimeMessages.ts",
  projectRoot: "/fake/project",
};

// ─── canTransform ─────────────────────────────────────────────────────────────

describe("SupabaseRealtimeTransformer.canTransform", () => {
  it("returns true when .channel() and subscribe are both present", () => {
    expect(
      transformer.canTransform(
        `supabase.channel('room1').on('postgres_changes', {}, cb).subscribe()`
      )
    ).toBe(true);
  });

  it("returns false when only .channel() is present (no subscribe)", () => {
    expect(transformer.canTransform(`supabase.channel('room1')`)).toBe(false);
  });

  it("returns false for unrelated content", () => {
    expect(transformer.canTransform(`const x = 1;`)).toBe(false);
  });
});

// ─── postgres_changes channel rewrite ─────────────────────────────────────────

describe("SupabaseRealtimeTransformer — postgres_changes channel", () => {
  it("rewrites a standard multi-line channel chain to localApi.subscribe()", async () => {
    const input = `
supabase
  .channel('room1')
  .on('postgres_changes', { event: '*', schema: 'public', table: 'messages' }, handleUpdate)
  .subscribe()
`;
    const result = await transformer.transform(input, ctx);

    expect(result.success).toBe(true);
    expect(result.transformedContent).toContain("localApi.subscribe('messages', handleUpdate)");
    expect(result.transformedContent).not.toContain("supabase.channel");
    expect(result.changes.some((c) => c.includes("messages"))).toBe(true);
  });

  it("adds localApi import when not already present", async () => {
    const input = `
supabase
  .channel('alerts')
  .on('postgres_changes', { event: 'INSERT', schema: 'public', table: 'notifications' }, onAlert)
  .subscribe()
`;
    const result = await transformer.transform(input, ctx);

    expect(result.success).toBe(true);
    expect(result.transformedContent).toContain("import { localApi }");
    expect(result.transformedContent).toContain("@/lib/localApi");
  });

  it("does not add a duplicate localApi import when already present", async () => {
    const input = `
import { localApi } from '@/lib/localApi';
supabase
  .channel('room2')
  .on('postgres_changes', { event: '*', schema: 'public', table: 'orders' }, cb)
  .subscribe()
`;
    const result = await transformer.transform(input, ctx);

    expect(result.success).toBe(true);
    const count = (result.transformedContent?.match(/import { localApi }/g) ?? []).length;
    expect(count).toBe(1);
  });
});

// ─── removeChannel / unsubscribe cleanup ──────────────────────────────────────

describe("SupabaseRealtimeTransformer — removeChannel", () => {
  it("rewrites supabase.removeChannel() to localApi.unsubscribe()", async () => {
    const input = `
supabase
  .channel('room1')
  .on('postgres_changes', { event: '*', schema: 'public', table: 'items' }, cb)
  .subscribe()
supabase.removeChannel(myChannel);
`;
    const result = await transformer.transform(input, ctx);

    expect(result.success).toBe(true);
    expect(result.transformedContent).toContain("localApi.unsubscribe()");
    expect(result.transformedContent).not.toContain("supabase.removeChannel");
  });
});

// ─── broadcast channel ────────────────────────────────────────────────────────

describe("SupabaseRealtimeTransformer — broadcast channels", () => {
  it("replaces broadcast channel with a comment and emits a warning", async () => {
    const input = `
supabase
  .channel('cursor-positions')
  .on('broadcast', { event: 'cursor' }, handleCursor)
  .subscribe()
`;
    const result = await transformer.transform(input, ctx);

    expect(result.success).toBe(true);
    expect(result.transformedContent).toContain("WebToApp: broadcast channel removed");
    expect(result.warnings.length).toBeGreaterThan(0);
    expect(result.warnings[0]).toContain("broadcast");
  });
});

// ─── Presence channel warning ─────────────────────────────────────────────────

describe("SupabaseRealtimeTransformer — presence", () => {
  it("emits a warning when .track() is detected and lowers confidence", async () => {
    const input = `
supabase
  .channel('presence-room')
  .on('postgres_changes', { event: '*', schema: 'public', table: 'users' }, cb)
  .subscribe()
channel.track({ online_at: new Date() });
`;
    const result = await transformer.transform(input, ctx);

    expect(result.success).toBe(true);
    expect(result.warnings.some((w) => w.toLowerCase().includes("presence"))).toBe(true);
    expect(result.confidence).toBeLessThan(0.9);
  });
});

// ─── Edge cases ───────────────────────────────────────────────────────────────

describe("SupabaseRealtimeTransformer — edge cases", () => {
  it("handles an empty string without throwing", async () => {
    const result = await transformer.transform("", ctx);
    expect(result).toBeDefined();
    expect(typeof result.success).toBe("boolean");
  });

  it("handles a file with no realtime calls gracefully", async () => {
    const input = `const x = 1;\nconsole.log(x);\n`;
    const result = await transformer.transform(input, ctx);
    expect(result).toBeDefined();
    expect(result.success).toBe(true);
  });

  it("returns a valid TransformResult shape", async () => {
    const input = `
supabase
  .channel('test')
  .on('postgres_changes', { event: '*', schema: 'public', table: 'test' }, cb)
  .subscribe()
`;
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
