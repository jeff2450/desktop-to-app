import { describe, it, expect } from "vitest";
import { SupabaseQueryTransformer } from "../supabase/SupabaseQueryTransformer.js";

const transformer = new SupabaseQueryTransformer();

const ctx = {
  sourcePath: "src/components/DataTable.tsx",
  outputPath: "src/components/DataTable.tsx",
  projectRoot: "/fake/project",
};

// ─── canTransform ─────────────────────────────────────────────────────────────

describe("SupabaseQueryTransformer.canTransform", () => {
  it("returns true for files importing @supabase/supabase-js", () => {
    expect(
      transformer.canTransform(`import { createClient } from '@supabase/supabase-js';`)
    ).toBe(true);
  });

  it("returns true for files containing supabase.from(", () => {
    expect(transformer.canTransform(`const { data } = await supabase.from('users').select()`)).toBe(true);
  });

  it("returns false for unrelated files", () => {
    expect(transformer.canTransform(`import React from 'react'; export default function App() {}`)).toBe(false);
  });
});

// ─── SELECT rewrite ───────────────────────────────────────────────────────────

describe("SupabaseQueryTransformer — SELECT", () => {
  it("rewrites a basic select() call", async () => {
    const input = `
import { supabase } from '@/lib/supabase';
const { data, error } = await supabase.from('users').select('*');
`;
    const result = await transformer.transform(input, ctx);

    expect(result.success).toBe(true);
    expect(result.transformedContent).toContain("localApi.from('users').select()");
    expect(result.transformedContent).not.toContain("supabase.from('users')");
    expect(result.changes.some((c: string) => c.includes("SELECT"))).toBe(true);
  });

  it("rewrites a select().eq() chain", async () => {
    const input = `await supabase.from('posts').select('*').eq('author_id', userId);`;
    const result = await transformer.transform(input, ctx);

    expect(result.success).toBe(true);
    expect(result.transformedContent).toContain("localApi.from('posts').select().eq('author_id', userId)");
  });

  it("rewrites a select().single() call", async () => {
    const input = `const { data } = await supabase.from('profiles').select('*').single();`;
    const result = await transformer.transform(input, ctx);

    expect(result.success).toBe(true);
    expect(result.transformedContent).toContain("localApi.from('profiles').select().single()");
  });
});

// ─── INSERT rewrite ───────────────────────────────────────────────────────────

describe("SupabaseQueryTransformer — INSERT", () => {
  it("rewrites an insert() call", async () => {
    const input = `await supabase.from('todos').insert({ title: 'Buy milk', done: false });`;
    const result = await transformer.transform(input, ctx);

    expect(result.success).toBe(true);
    expect(result.transformedContent).toContain("localApi.from('todos').insert(");
    expect(result.transformedContent).not.toContain("supabase.from('todos')");
    expect(result.changes.some((c: string) => c.includes("INSERT"))).toBe(true);
  });
});

// ─── UPDATE rewrite ───────────────────────────────────────────────────────────

describe("SupabaseQueryTransformer — UPDATE", () => {
  it("rewrites an update().eq() call", async () => {
    const input = `await supabase.from('todos').update({ done: true }).eq('id', todoId);`;
    const result = await transformer.transform(input, ctx);

    expect(result.success).toBe(true);
    expect(result.transformedContent).toContain("localApi.from('todos').update(");
    expect(result.transformedContent).toContain(".eq('id', todoId)");
    expect(result.changes.some((c: string) => c.includes("UPDATE"))).toBe(true);
  });
});

// ─── DELETE rewrite ───────────────────────────────────────────────────────────

describe("SupabaseQueryTransformer — DELETE", () => {
  it("rewrites a delete().eq() call", async () => {
    const input = `await supabase.from('todos').delete().eq('id', todoId);`;
    const result = await transformer.transform(input, ctx);

    expect(result.success).toBe(true);
    expect(result.transformedContent).toContain("localApi.from('todos').delete().eq('id', todoId)");
    expect(result.changes.some((c: string) => c.includes("DELETE"))).toBe(true);
  });
});

// ─── UPSERT rewrite ───────────────────────────────────────────────────────────

describe("SupabaseQueryTransformer — UPSERT", () => {
  it("rewrites an upsert() call", async () => {
    const input = `await supabase.from('profiles').upsert({ id: userId, name: 'Alice' });`;
    const result = await transformer.transform(input, ctx);

    expect(result.success).toBe(true);
    expect(result.transformedContent).toContain("localApi.from('profiles').upsert(");
    expect(result.changes.some((c: string) => c.includes("UPSERT"))).toBe(true);
  });
});

// ─── Import / env rewrite ─────────────────────────────────────────────────────

describe("SupabaseQueryTransformer — imports and env vars", () => {
  it("adds localApi import and removes supabase import", async () => {
    const input = `
import { createClient } from '@supabase/supabase-js';
const supabase = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_ANON_KEY);
const { data } = await supabase.from('users').select('*');
`;
    const result = await transformer.transform(input, ctx);

    expect(result.success).toBe(true);
    expect(result.transformedContent).toContain("@/lib/localApi");
    expect(result.transformedContent).not.toContain("@supabase/supabase-js");
  });

  it("removes Supabase env var references", async () => {
    // Must include a supabase.from() call so canTransform() returns true
    const input = `
const url = import.meta.env.VITE_SUPABASE_URL;
const key = import.meta.env.VITE_SUPABASE_ANON_KEY;
const { data } = await supabase.from('users').select('*');
`;
    const result = await transformer.transform(input, ctx);

    expect(result.success).toBe(true);
    expect(result.transformedContent).not.toContain("VITE_SUPABASE_URL");
    expect(result.transformedContent).not.toContain("VITE_SUPABASE_ANON_KEY");
    expect(result.transformedContent).toContain("undefined /* removed by WebToApp */");
  });
});

// ─── Low confidence / warnings ────────────────────────────────────────────────

describe("SupabaseQueryTransformer — confidence and warnings", () => {
  it("flags remaining supabase. references and lowers confidence", async () => {
    // Include supabase.from() so canTransform() returns true, then use rpc() which can't be auto-rewritten
    const input = `
const { data } = await supabase.from('users').select('*');
const { data: d2 } = await supabase.rpc('my_function', { param: 1 });
const { data: d3 } = await supabase.rpc('another_fn', { x: 2 });
const { data: d4 } = await supabase.rpc('third_fn', { y: 3 });
`;
    const result = await transformer.transform(input, ctx);

    expect(result.success).toBe(true);
    expect(result.confidence).toBeLessThan(0.9);
    expect(result.warnings.some((w: string) => w.includes("remaining"))).toBe(true);
  });

  it("does not modify a file that cannot be transformed", async () => {
    const input = `export default function PlainComponent() { return <div>Hello</div>; }`;
    const result = await transformer.transform(input, ctx);

    expect(result.success).toBe(true);
    expect(result.confidence).toBe(1.0);
    expect(result.changes).toHaveLength(0);
    expect(result.transformedContent).toBe(input);
  });
});
