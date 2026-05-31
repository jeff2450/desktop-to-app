import { describe, it, expect } from "vitest";
import { VueTransformer } from "../vue/VueTransformer.js";

const transformer = new VueTransformer();

const ctx = {
  sourcePath: "src/components/App.vue",
  outputPath: "src/components/App.vue",
  projectRoot: "/fake/project",
};

// ─── canTransform ──────────────────────────────────────────────────────────────

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

// ─── Supabase operations ───────────────────────────────────────────────────────

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

// ─── Supabase auth ─────────────────────────────────────────────────────────────

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

// ─── Firebase operations ───────────────────────────────────────────────────────

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

// ─── SFC block preservation ────────────────────────────────────────────────────

describe("VueTransformer — SFC block preservation", () => {
  it("preserves template block verbatim", async () => {
    const input = `<template>
  <div class="app">
    <h1>{{ title }}</h1>
    <ul>
      <li v-for="user in users" :key="user.id">{{ user.name }}</li>
    </ul>
  </div>
</template>
<script setup lang="ts">
import { ref, onMounted } from 'vue'
import { createClient } from '@supabase/supabase-js'
const supabase = createClient(url, key)
const users = ref([])
onMounted(async () => {
  const { data } = await supabase.from('users').select()
  users.value = data
})
</script>
<style scoped>
.app { padding: 1rem; }
</style>`;

    const result = await transformer.transform(input, ctx);
    expect(result.success).toBe(true);

    // Template preserved verbatim
    expect(result.transformedContent).toContain("<h1>{{ title }}</h1>");
    expect(result.transformedContent).toContain("v-for=\"user in users\"");

    // Style preserved verbatim
    expect(result.transformedContent).toContain("<style scoped>");
    expect(result.transformedContent).toContain(".app { padding: 1rem; }");

    // Script transformed
    expect(result.transformedContent).not.toContain("@supabase/supabase-js");
    expect(result.transformedContent).not.toContain("createClient(");
    expect(result.transformedContent).toContain("localApi.get('/api/users')");
  });

  it("inserts localApi import inside <script setup> not at root", async () => {
    const input = `<template><div>{{ data }}</div></template>
<script setup lang="ts">
import { ref } from 'vue'
import { createClient } from '@supabase/supabase-js'
const supabase = createClient(url, key)
const data = ref(null)
async function load() {
  const { data: d } = await supabase.from('products').select()
  data.value = d
}
</script>`;

    const result = await transformer.transform(input, ctx);
    expect(result.success).toBe(true);

    // localApi import should appear inside the <script> block context
    const scriptStart = result.transformedContent!.indexOf("<script");
    const scriptEnd = result.transformedContent!.indexOf("</script>");
    const scriptContent = result.transformedContent!.slice(scriptStart, scriptEnd);
    expect(scriptContent).toContain("import { localApi }");
    expect(scriptContent).toContain("localApi.get('/api/products')");
  });

  it("handles Options API <script> block (no 'setup' attr)", async () => {
    const input = `<template>
  <div>{{ users }}</div>
</template>
<script>
import { defineComponent } from 'vue'
import { getDocs, collection } from 'firebase/firestore'

export default defineComponent({
  data() {
    return { users: [] }
  },
  async created() {
    const snaps = await getDocs(collection(db, 'users'))
    this.users = snaps.docs.map(d => d.data())
  }
})
</script>`;

    const result = await transformer.transform(input, ctx);
    expect(result.success).toBe(true);
    expect(result.transformedContent).toContain("localApi.get('/api/users')");
    expect(result.transformedContent).not.toContain("firebase/firestore");
    // Template still intact
    expect(result.transformedContent).toContain("<div>{{ users }}</div>");
  });

  it("handles mixed Firebase + Supabase in the same Vue SFC", async () => {
    const input = `<template><div></div></template>
<script setup>
import { getDocs, collection } from 'firebase/firestore'
import { createClient } from '@supabase/supabase-js'
const supabase = createClient(url, key)

// Firebase read
const snaps = await getDocs(collection(db, 'posts'))

// Supabase read
const { data: users } = await supabase.from('users').select()
</script>`;

    const result = await transformer.transform(input, ctx);
    expect(result.success).toBe(true);
    expect(result.transformedContent).toContain("localApi.get('/api/posts')");
    expect(result.transformedContent).toContain("localApi.get('/api/users')");
    expect(result.transformedContent).not.toContain("firebase/firestore");
    expect(result.transformedContent).not.toContain("@supabase/supabase-js");
  });
});

// ─── Imports and setup ────────────────────────────────────────────────────────

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
