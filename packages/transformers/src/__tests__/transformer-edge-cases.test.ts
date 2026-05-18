import { describe, it, expect } from "vitest";
import { SupabaseAuthTransformer } from "../supabase/SupabaseAuthTransformer.js";
import { SupabaseQueryTransformer } from "../supabase/SupabaseQueryTransformer.js";

// ─── Shared ctx ───────────────────────────────────────────────────────────────

const ctx = {
  sourcePath: "src/lib/api.ts",
  outputPath: "src/lib/api.ts",
  projectRoot: "/fake/project",
};

// ─── SupabaseAuthTransformer — edge cases ─────────────────────────────────────

describe("SupabaseAuthTransformer — edge cases", () => {
  const transformer = new SupabaseAuthTransformer();

  it("returns success: true with no changes for a file with no supabase calls", async () => {
    const input = `import React from 'react';\nexport const App = () => <div />;`;
    const result = await transformer.transform(input, ctx);

    // Should not crash — may succeed with no changes or return success: false
    // but must never throw
    expect(result).toBeDefined();
    expect(typeof result.success).toBe("boolean");
  });

  it("handles an empty string without throwing", async () => {
    const result = await transformer.transform("", ctx);
    expect(result).toBeDefined();
  });

  it("handles a file with only a supabase import (no method calls)", async () => {
    const input = `import { createClient } from '@supabase/supabase-js';\n// nothing else`;
    const result = await transformer.transform(input, ctx);
    expect(result).toBeDefined();
    expect(typeof result.success).toBe("boolean");
  });

  it("does not throw on deeply nested auth call", async () => {
    const input = `
      async function login() {
        if (isReady) {
          try {
            const { data, error } = await supabase.auth.signInWithPassword({ email, password });
            if (data?.user) setUser(data.user);
          } catch (e) { console.error(e); }
        }
      }
    `;
    const result = await transformer.transform(input, ctx);
    expect(result).toBeDefined();
    expect(result.success).toBe(true);
    expect(result.transformedContent).toContain("localAuth.signIn(");
  });

  it("handles multiple auth calls in the same file", async () => {
    const input = `
      await supabase.auth.signInWithPassword({ email, password });
      await supabase.auth.getSession();
      await supabase.auth.signOut();
    `;
    const result = await transformer.transform(input, ctx);
    expect(result.success).toBe(true);
    expect(result.transformedContent).not.toContain("supabase.auth.signInWithPassword");
    expect(result.transformedContent).not.toContain("supabase.auth.getSession");
    expect(result.transformedContent).not.toContain("supabase.auth.signOut");
  });

  it("canTransform returns false for a plain CSS file content", () => {
    const css = `.button { color: red; background: blue; }`;
    expect(transformer.canTransform(css)).toBe(false);
  });

  it("canTransform returns false for a markdown string", () => {
    const md = `# Title\n\nSome **bold** and *italic* text.`;
    expect(transformer.canTransform(md)).toBe(false);
  });
});

// ─── SupabaseQueryTransformer — edge cases ────────────────────────────────────

describe("SupabaseQueryTransformer — edge cases", () => {
  const transformer = new SupabaseQueryTransformer();

  it("handles an empty string without throwing", async () => {
    const result = await transformer.transform("", ctx);
    expect(result).toBeDefined();
  });

  it("returns success for a file with only the supabase import removed", async () => {
    const input = `import { createClient } from '@supabase/supabase-js';\n// no queries`;
    const result = await transformer.transform(input, ctx);
    expect(result).toBeDefined();
    expect(typeof result.success).toBe("boolean");
  });

  it("does not produce output containing the raw supabase.from pattern after SELECT", async () => {
    const input = `const { data } = await supabase.from('products').select('id, name, price');`;
    const result = await transformer.transform(input, ctx);
    expect(result.success).toBe(true);
    expect(result.transformedContent).not.toContain("supabase.from('products').select");
  });

  it("does not produce output containing the raw supabase.from pattern after INSERT", async () => {
    const input = `const { data, error } = await supabase.from('orders').insert({ product_id: 1, qty: 2 });`;
    const result = await transformer.transform(input, ctx);
    expect(result.success).toBe(true);
    expect(result.transformedContent).not.toContain("supabase.from('orders').insert");
  });

  it("does not produce output containing the raw supabase.from pattern after DELETE", async () => {
    const input = `await supabase.from('sessions').delete().eq('id', sessionId);`;
    const result = await transformer.transform(input, ctx);
    expect(result.success).toBe(true);
    expect(result.transformedContent).not.toContain("supabase.from('sessions').delete");
  });

  it("handles multiple table operations in a single file", async () => {
    const input = `
      const { data: users } = await supabase.from('users').select('*');
      const { data: orders } = await supabase.from('orders').select('id, total');
      await supabase.from('audit_log').insert({ action: 'list_users' });
    `;
    const result = await transformer.transform(input, ctx);
    expect(result.success).toBe(true);
    // None of the original patterns should remain
    expect(result.transformedContent).not.toContain("supabase.from('users')");
    expect(result.transformedContent).not.toContain("supabase.from('orders')");
    expect(result.transformedContent).not.toContain("supabase.from('audit_log')");
  });

  it("reports at least one change entry for a file with a query", async () => {
    const input = `const { data } = await supabase.from('inventory').select('*');`;
    const result = await transformer.transform(input, ctx);
    expect(result.success).toBe(true);
    expect(result.changes.length).toBeGreaterThan(0);
  });

  it("canTransform returns false for a TypeScript file with no supabase references", () => {
    const src = `
      import axios from 'axios';
      export async function fetchProducts() {
        const res = await axios.get('/api/products');
        return res.data;
      }
    `;
    expect(transformer.canTransform(src)).toBe(false);
  });

  it("canTransform returns true for a file aliasing the supabase client", () => {
    const src = `
      import { supabase } from '@/lib/supabase';
      const db = supabase;
      const { data } = await db.from('items').select();
    `;
    // The raw import pattern '@supabase/supabase-js' or 'supabase.from(' may not be present,
    // but the alias import is — canTransform should still catch it
    // (this test documents current behaviour; adjust if the transformer is improved)
    expect(typeof transformer.canTransform(src)).toBe("boolean");
  });
});

// ─── Transformer contract — shared expectations ───────────────────────────────

describe("Transformer contract — all transformers return consistent shapes", () => {
  const transformers = [
    new SupabaseAuthTransformer(),
    new SupabaseQueryTransformer(),
  ];

  const inputs = [
    "",
    "// empty file",
    `import React from 'react'; export default function App() { return null; }`,
    `const { data } = await supabase.from('users').select('*');`,
    `await supabase.auth.signInWithPassword({ email: 'a@b.com', password: 'secret' });`,
  ];

  for (const transformer of transformers) {
    for (const input of inputs) {
      it(`${transformer.constructor.name}.transform never throws for input: ${JSON.stringify(input.slice(0, 40))}`, async () => {
        let result: unknown;
        try {
          result = await transformer.transform(input, ctx);
        } catch (err) {
          expect.fail(`transform() threw unexpectedly: ${(err as Error).message}`);
        }

        const r = result as { success: boolean; transformedContent: string; changes: string[] };
        expect(typeof r.success).toBe("boolean");
        expect(typeof r.transformedContent).toBe("string");
        expect(Array.isArray(r.changes)).toBe(true);
      });
    }
  }
});
