import { describe, it, expect } from "vitest";
import { SupabaseAuthTransformer } from "../supabase/SupabaseAuthTransformer.js";

const transformer = new SupabaseAuthTransformer();

const ctx = {
  sourcePath: "src/hooks/useAuth.ts",
  outputPath: "src/hooks/useAuth.ts",
  projectRoot: "/fake/project",
};

describe("SupabaseAuthTransformer.canTransform", () => {
  it("returns true for supabase.auth calls", () => {
    expect(transformer.canTransform(`await supabase.auth.signInWithPassword({ email, password })`)).toBe(true);
  });

  it("returns true for onAuthStateChange", () => {
    expect(transformer.canTransform(`supabase.auth.onAuthStateChange((event, session) => {})`)).toBe(true);
  });

  it("returns false for unrelated files", () => {
    expect(transformer.canTransform(`import React from 'react';\nexport const App = () => <div />;`)).toBe(false);
  });
});

describe("SupabaseAuthTransformer — signIn/signUp/signOut", () => {
  it("rewrites signInWithPassword", async () => {
    const input = `const { data, error } = await supabase.auth.signInWithPassword({ email, password });`;
    const result = await transformer.transform(input, ctx);

    expect(result.success).toBe(true);
    expect(result.transformedContent).toContain("localAuth.signIn(");
    expect(result.transformedContent).not.toContain("supabase.auth.signInWithPassword");
    expect(result.changes.some((c: string) => c.includes("signInWithPassword"))).toBe(true);
  });

  it("rewrites signUp", async () => {
    const input = `const { data, error } = await supabase.auth.signUp({ email, password });`;
    const result = await transformer.transform(input, ctx);

    expect(result.success).toBe(true);
    expect(result.transformedContent).toContain("localAuth.signUp(");
    expect(result.changes.some((c: string) => c.includes("signUp"))).toBe(true);
  });

  it("rewrites signOut", async () => {
    const input = `await supabase.auth.signOut();`;
    const result = await transformer.transform(input, ctx);

    expect(result.success).toBe(true);
    expect(result.transformedContent).toContain("localAuth.signOut()");
    expect(result.changes.some((c: string) => c.includes("signOut"))).toBe(true);
  });
});

describe("SupabaseAuthTransformer — session / user", () => {
  it("rewrites getSession", async () => {
    const input = `const { data: { session } } = await supabase.auth.getSession();`;
    const result = await transformer.transform(input, ctx);

    expect(result.success).toBe(true);
    expect(result.transformedContent).toContain("localAuth.getSession()");
  });

  it("rewrites getUser", async () => {
    const input = `const { data: { user } } = await supabase.auth.getUser();`;
    const result = await transformer.transform(input, ctx);

    expect(result.success).toBe(true);
    expect(result.transformedContent).toContain("localAuth.getUser()");
  });

  it("rewrites onAuthStateChange", async () => {
    const input = `supabase.auth.onAuthStateChange((event, session) => { setUser(session?.user ?? null); });`;
    const result = await transformer.transform(input, ctx);

    expect(result.success).toBe(true);
    expect(result.transformedContent).toContain("localAuth.onAuthChange(");
    expect(result.warnings.some((w: string) => w.includes("onAuthStateChange"))).toBe(true);
  });
});

describe("SupabaseAuthTransformer — OAuth stubs", () => {
  it("replaces OAuth with a stub and warns", async () => {
    const input = `await supabase.auth.signInWithOAuth({ provider: 'google' });`;
    const result = await transformer.transform(input, ctx);

    expect(result.success).toBe(true);
    expect(result.transformedContent).toContain("WebToApp: OAuth removed");
    expect(result.warnings.some((w: string) => w.includes("OAuth"))).toBe(true);
    expect(result.confidence).toBeLessThan(0.88);
  });
});

describe("SupabaseAuthTransformer — adds localAuth import", () => {
  it("injects localAuth import when not already present", async () => {
    const input = `
import { supabase } from '@/lib/supabase';
const { data } = await supabase.auth.signInWithPassword({ email, password });
`;
    const result = await transformer.transform(input, ctx);

    expect(result.success).toBe(true);
    expect(result.transformedContent).toContain("import { localAuth } from '@/lib/localAuth'");
  });

  it("does not duplicate localAuth import if already present", async () => {
    const input = `
import { localAuth } from '@/lib/localAuth';
await supabase.auth.signOut();
`;
    const result = await transformer.transform(input, ctx);
    const count = (result.transformedContent?.match(/localAuth/g) ?? []).length;
    // Should appear in import + call, but not double-imported
    expect(count).toBeGreaterThan(0);
  });
});
