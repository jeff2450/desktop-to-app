import { describe, it, expect } from "vitest";
import { VueTransformer } from "../vue/VueTransformer.js";

const transformer = new VueTransformer();

const ctx = {
  sourcePath: "src/components/App.vue",
  outputPath: "src/components/App.vue",
  projectRoot: "/fake/project",
};

describe("VueTransformer.canTransform", () => {
  it("returns true for Supabase in a Vue component", () => {
    expect(transformer.canTransform(`
      <script setup>
      import { supabase } from '../lib/supabase'
      await supabase.from('users').select()
      </script>
    `)).toBe(true);
  });

  it("returns true for Firebase in a Vue component", () => {
    expect(transformer.canTransform(`
      import { getFirestore } from 'firebase/firestore'
      import { defineComponent } from 'vue'
    `)).toBe(true);
  });

  it("returns false for non-Vue files", () => {
    expect(transformer.canTransform(`import { supabase } from '@supabase/supabase-js';`)).toBe(false);
  });
});

describe("VueTransformer — Supabase operations", () => {
  it("rewrites supabase.from().select()", async () => {
    const input = `
      <script setup>
      import { supabase } from '../lib/supabase'
      const { data } = await supabase.from('users').select('*')
      </script>
    `;
    const result = await transformer.transform(input, ctx);
    
    expect(result.success).toBe(true);
    expect(result.transformedContent).toContain("import { localApi }");
    expect(result.transformedContent).toContain("await localApi.get('/api/users')");
  });

  it("rewrites filtered select", async () => {
    const input = `
      <script setup>
      const { data } = await supabase.from('users').select().eq('status', 'active')
      </script>
    `;
    const result = await transformer.transform(input, ctx);
    expect(result.transformedContent).toContain("await localApi.get('/api/users?status='+'active')");
  });

  it("rewrites insert", async () => {
    const input = `
      <script setup>
      await supabase.from('users').insert({ name: 'Test' })
      </script>
    `;
    const result = await transformer.transform(input, ctx);
    expect(result.transformedContent).toContain("await localApi.post('/api/users', { name: 'Test' })");
  });

  it("rewrites update", async () => {
    const input = `
      <script setup>
      await supabase.from('users').update(data).eq('id', id)
      </script>
    `;
    const result = await transformer.transform(input, ctx);
    expect(result.transformedContent).toContain("await localApi.put('/api/users/'+id, data)");
  });

  it("rewrites delete", async () => {
    const input = `
      <script setup>
      await supabase.from('users').delete().eq('id', id)
      </script>
    `;
    const result = await transformer.transform(input, ctx);
    expect(result.transformedContent).toContain("await localApi.delete('/api/users/'+id)");
  });
});

describe("VueTransformer — Supabase auth", () => {
  it("rewrites signInWithPassword", async () => {
    const input = `
      <script setup>
      await supabase.auth.signInWithPassword({ email, password })
      </script>
    `;
    const result = await transformer.transform(input, ctx);
    expect(result.transformedContent).toContain("await localApi.auth.signIn({ email, password })");
  });
});

describe("VueTransformer — Firebase operations", () => {
  it("rewrites getDocs", async () => {
    const input = `
      <script setup>
      import { getDocs, collection } from 'firebase/firestore'
      const snaps = await getDocs(collection(db, 'users'))
      </script>
    `;
    const result = await transformer.transform(input, ctx);
    expect(result.transformedContent).toContain("await localApi.get('/api/users')");
  });

  it("rewrites signInWithEmailAndPassword", async () => {
    const input = `
      <script setup>
      import { signInWithEmailAndPassword } from 'firebase/auth'
      await signInWithEmailAndPassword(auth, email, password)
      </script>
    `;
    const result = await transformer.transform(input, ctx);
    expect(result.transformedContent).toContain("await localApi.auth.signIn({ email: email, password: password })");
  });
});

describe("VueTransformer — imports and setup", () => {
  it("removes Supabase client creation", async () => {
    const input = `
      import { createClient } from '@supabase/supabase-js'
      const supabase = createClient(url, key)
      const data = ref([])
    `;
    const result = await transformer.transform(input, ctx);
    expect(result.transformedContent).not.toContain("@supabase/supabase-js");
    expect(result.transformedContent).not.toContain("createClient(");
  });

  it("warns about $supabase plugin pattern", async () => {
    const input = `
      <script>
      import { defineComponent } from 'vue'
      export default defineComponent({
        async mounted() {
          await this.$supabase.from('users').select()
        }
      })
      </script>
    `;
    const result = await transformer.transform(input, ctx);
    expect(result.warnings.length).toBeGreaterThan(0);
    expect(result.warnings[0]).toContain("$supabase plugin pattern");
  });
});
