import type { SourceFile } from "ts-morph";
import { BaseTransformer, type TransformContext, type TransformResult } from "../base/BaseTransformer.js";

/**
 * Rewrites Vue 3 (Composition API) and Vue 2 (Options API) files that use
 * cloud backends (Supabase, Firebase) to use the local REST API instead.
 *
 * Vue Composition API patterns handled:
 *   import { createClient } from '@supabase/supabase-js'
 *   const { data } = await supabase.from('table').select()   → GET /api/table
 *   await supabase.from('table').insert(row)                 → POST /api/table
 *   await supabase.from('table').update(data).eq('id', id)   → PUT /api/table/:id
 *   await supabase.from('table').delete().eq('id', id)       → DELETE /api/table/:id
 *   supabase.auth.signInWithPassword(...)                    → localApi.auth.signIn()
 *   supabase.auth.signOut()                                  → localApi.auth.signOut()
 *
 * Vue-specific: handles both <script setup> and Options API style.
 * Also handles .vue SFC files (just the <script> block — template is left untouched
 * since the template uses the same reactive variables, just now backed by localApi).
 */
export class VueTransformer extends BaseTransformer {
  canTransform(content: string): boolean {
    return (
      (content.includes("@supabase/supabase-js") ||
        content.includes("supabase.from(") ||
        content.includes("supabase.auth") ||
        content.includes("firebase/app") ||
        content.includes("getFirestore") ||
        content.includes("collection(") ||
        content.includes("getDoc(") ||
        content.includes("firebase/auth")) &&
      // At least one sign this is Vue (script setup, defineComponent, or .vue imports)
      (content.includes("defineComponent") ||
        content.includes("<script setup") ||
        content.includes("defineProps") ||
        content.includes("defineEmits") ||
        content.includes("ref(") ||
        content.includes("reactive(") ||
        content.includes("onMounted("))
    );
  }

  protected async transformSourceFile(
    sourceFile: SourceFile,
    _ctx: TransformContext
  ): Promise<Pick<TransformResult, "changes" | "warnings" | "confidence">> {
    const changes: string[] = [];
    const warnings: string[] = [];
    let confidence = 0.80;
    let text = sourceFile.getFullText();

    const isVueSFC = text.includes("<template") || text.includes("<script setup");

    // ── Remove Supabase client import / creation ──────────────────
    if (text.includes("@supabase/supabase-js")) {
      text = text.replace(
        /import\s*\{[^}]+\}\s*from\s*['"]@supabase\/supabase-js['"];?\n?/g,
        ""
      );
      changes.push("Removed @supabase/supabase-js import");

      // Remove createClient call
      text = text.replace(
        /(?:const|let|var)\s+\w+\s*=\s*createClient\([^)]*\);?\n?/g,
        ""
      );
      changes.push("Removed createClient() instantiation");

      // Remove supabase.ts / supabaseClient imports
      text = text.replace(
        /import\s+(?:\{[^}]+\}|\w+)\s*from\s*['"](?:\.\.\/)*(?:lib\/supabase|supabaseClient|integrations\/supabase\/client)['"];?\n?/g,
        ""
      );
    }

    // Remove Firebase imports
    if (text.includes("firebase")) {
      text = text.replace(
        /import\s*\{[^}]+\}\s*from\s*['"]firebase\/(?:app|firestore|auth|storage)['"];?\n?/g,
        ""
      );
      text = text.replace(
        /(?:const|let|var)\s+(?:app|db|auth|storage)\s*=\s*(?:initializeApp|getFirestore|getAuth|getStorage)\([^)]*\);?\n?/g,
        ""
      );
      changes.push("Removed Firebase imports and initializations");
    }

    // ── Add localApi import ───────────────────────────────────────
    if (!text.includes("localApi")) {
      // For Vue SFC, insert after <script setup> tag; otherwise at top
      if (isVueSFC && text.includes("<script setup")) {
        text = text.replace(
          /(<script setup[^>]*>)/,
          `$1\nimport { localApi } from '@/lib/localApi';`
        );
      } else if (isVueSFC && text.includes("<script>")) {
        text = text.replace(
          /(<script>)/,
          `$1\nimport { localApi } from '@/lib/localApi';`
        );
      } else {
        text = `import { localApi } from '@/lib/localApi';\n` + text;
      }
      changes.push("Added localApi import");
    }

    // ── Supabase query rewrites ───────────────────────────────────

    // SELECT with eq filter: .select().eq('id', id)
    text = text.replace(
      /await\s+\w+\.from\s*\(\s*['"](\w+)['"]\s*\)\.select\s*\([^)]*\)\.eq\s*\(\s*['"](\w+)['"]\s*,\s*([^)]+)\)/g,
      (_match, table: string, col: string, val: string) => {
        changes.push(`Rewrote filtered select on '${table}' → localApi.get`);
        return `await localApi.get('/api/${table}?${col}='+${val.trim()})`;
      }
    );

    // SELECT: await supabase.from('table').select() → await localApi.get('/api/table')
    text = text.replace(
      /await\s+\w+\.from\s*\(\s*['"](\w+)['"]\s*\)\.select\s*\(\s*(?:'[^']*'|"[^"]*"|`[^`]*`|\*|)\s*\)/g,
      (_match, table: string) => {
        changes.push(`Rewrote supabase.from('${table}').select() → localApi.get('/api/${table}')`);
        return `await localApi.get('/api/${table}')`;
      }
    );

    // INSERT: await supabase.from('table').insert(data)
    text = text.replace(
      /await\s+\w+\.from\s*\(\s*['"](\w+)['"]\s*\)\.insert\s*\(([^)]+)\)/g,
      (_match, table: string, data: string) => {
        changes.push(`Rewrote insert on '${table}' → localApi.post`);
        return `await localApi.post('/api/${table}', ${data.trim()})`;
      }
    );

    // UPDATE: await supabase.from('table').update(data).eq('id', id)
    text = text.replace(
      /await\s+\w+\.from\s*\(\s*['"](\w+)['"]\s*\)\.update\s*\(([^)]+)\)\.eq\s*\(\s*['"]id['"]\s*,\s*([^)]+)\)/g,
      (_match, table: string, data: string, id: string) => {
        changes.push(`Rewrote update on '${table}' → localApi.put`);
        return `await localApi.put('/api/${table}/'+${id.trim()}, ${data.trim()})`;
      }
    );

    // DELETE: await supabase.from('table').delete().eq('id', id)
    text = text.replace(
      /await\s+\w+\.from\s*\(\s*['"](\w+)['"]\s*\)\.delete\s*\(\s*\)\.eq\s*\(\s*['"]id['"]\s*,\s*([^)]+)\)/g,
      (_match, table: string, id: string) => {
        changes.push(`Rewrote delete on '${table}' → localApi.delete`);
        return `await localApi.delete('/api/${table}/'+${id.trim()})`;
      }
    );

    // ── Supabase auth rewrites ────────────────────────────────────
    // signInWithPassword
    text = text.replace(
      /await\s+\w+\.auth\.signInWithPassword\s*\(\s*\{([^}]+)\}\s*\)/g,
      (_match, inner: string) => {
        changes.push("Rewrote supabase.auth.signInWithPassword → localApi.auth.signIn");
        return `await localApi.auth.signIn(${inner.includes("email") ? "{" + inner + "}" : inner.trim()})`;
      }
    );

    // signUp
    text = text.replace(
      /await\s+\w+\.auth\.signUp\s*\(\s*\{([^}]+)\}\s*\)/g,
      (_match, inner: string) => {
        changes.push("Rewrote supabase.auth.signUp → localApi.auth.signUp");
        return `await localApi.auth.signUp({${inner}})`;
      }
    );

    // signOut
    text = text.replace(/await\s+\w+\.auth\.signOut\s*\(\s*\)/g, () => {
      changes.push("Rewrote supabase.auth.signOut → localApi.auth.signOut");
      return "await localApi.auth.signOut()";
    });

    // getUser / getSession
    text = text.replace(/await\s+\w+\.auth\.getUser\s*\(\s*\)/g, () => {
      changes.push("Rewrote auth.getUser → localApi.auth.getUser");
      return "await localApi.auth.getUser()";
    });
    text = text.replace(/await\s+\w+\.auth\.getSession\s*\(\s*\)/g, () => {
      changes.push("Rewrote auth.getSession → localApi.auth.getSession");
      return "await localApi.auth.getSession()";
    });

    // ── Firebase Firestore rewrites (Vue) ─────────────────────────
    // getDocs(collection(db, 'table')) → localApi.get('/api/table')
    text = text.replace(
      /await\s+getDocs\s*\(\s*collection\s*\(\s*\w+\s*,\s*['"](\w+)['"]\s*\)\s*\)/g,
      (_match, table: string) => {
        changes.push(`Rewrote getDocs(collection('${table}')) → localApi.get`);
        return `await localApi.get('/api/${table}')`;
      }
    );

    // getDoc(doc(db, 'table', id)) → localApi.get('/api/table/'+id)
    text = text.replace(
      /await\s+getDoc\s*\(\s*doc\s*\(\s*\w+\s*,\s*['"](\w+)['"]\s*,\s*([^)]+)\s*\)\s*\)/g,
      (_match, table: string, id: string) => {
        changes.push(`Rewrote getDoc(doc('${table}', id)) → localApi.get`);
        return `await localApi.get('/api/${table}/'+${id.trim()})`;
      }
    );

    // addDoc(collection(db, 'table'), data) → localApi.post('/api/table', data)
    text = text.replace(
      /await\s+addDoc\s*\(\s*collection\s*\(\s*\w+\s*,\s*['"](\w+)['"]\s*\)\s*,\s*([^)]+)\s*\)/g,
      (_match, table: string, data: string) => {
        changes.push(`Rewrote addDoc('${table}') → localApi.post`);
        return `await localApi.post('/api/${table}', ${data.trim()})`;
      }
    );

    // deleteDoc(doc(db, 'table', id)) → localApi.delete('/api/table/'+id)
    text = text.replace(
      /await\s+deleteDoc\s*\(\s*doc\s*\(\s*\w+\s*,\s*['"](\w+)['"]\s*,\s*([^)]+)\s*\)\s*\)/g,
      (_match, table: string, id: string) => {
        changes.push(`Rewrote deleteDoc('${table}', id) → localApi.delete`);
        return `await localApi.delete('/api/${table}/'+${id.trim()})`;
      }
    );

    // ── Firebase Auth rewrites (Vue) ──────────────────────────────
    text = text.replace(
      /await\s+signInWithEmailAndPassword\s*\(\s*\w+\s*,\s*([^,]+),\s*([^)]+)\)/g,
      (_m, email: string, password: string) => {
        changes.push("Rewrote signInWithEmailAndPassword → localApi.auth.signIn");
        return `await localApi.auth.signIn({ email: ${email.trim()}, password: ${password.trim()} })`;
      }
    );
    text = text.replace(/await\s+signOut\s*\(\s*\w+\s*\)/g, () => {
      changes.push("Rewrote Firebase signOut → localApi.auth.signOut");
      return "await localApi.auth.signOut()";
    });

    // ── Composable: $supabase usage (Vue plugin pattern) ─────────
    text = text.replace(/\$supabase\.from\s*\(\s*['"](\w+)['"]\s*\)/g, (_m, table: string) => {
      warnings.push(
        `$supabase plugin pattern detected on table '${table}' — converted to localApi. Verify composable setup.`
      );
      confidence -= 0.05;
      return `{ get: () => localApi.get('/api/${table}'), post: (d: unknown) => localApi.post('/api/${table}', d) }`;
    });

    // ── Warn on remaining cloud refs ──────────────────────────────
    const supabaseRefs = (text.match(/supabase\./g) ?? []).length;
    const firebaseRefs = (text.match(/firebase\//g) ?? []).length;
    if (supabaseRefs > 0) {
      warnings.push(`${supabaseRefs} remaining supabase. reference(s) — manual review needed`);
      confidence -= Math.min(supabaseRefs * 0.04, 0.2);
    }
    if (firebaseRefs > 0) {
      warnings.push(`${firebaseRefs} remaining firebase/ reference(s) — manual review needed`);
      confidence -= Math.min(firebaseRefs * 0.04, 0.2);
    }

    if (changes.length > 0) sourceFile.replaceWithText(text);
    return { changes, warnings, confidence: Math.max(confidence, 0.45) };
  }
}
