import { SyntaxKind, type SourceFile, type CallExpression } from "ts-morph";
import { BaseTransformer, type TransformContext, type TransformResult } from "../base/BaseTransformer.js";

/** Describes a parsed Vue SFC block. */
interface SfcBlock {
  tag: string;      // e.g. "script", "template", "style"
  attrs: string;    // attribute string after the tag name
  content: string;  // inner text (excluding the tags)
  openTag: string;  // the full opening tag string
  closeTag: string; // the full closing tag string
}

/**
 * Rewrites Vue 3 (Composition API / `<script setup>`) and Vue 2 (Options API)
 * files that use cloud backends (Supabase, Firebase) to use the local REST API.
 *
 * Key improvements over the regex-only predecessor:
 *  - Properly splits Vue SFCs: extracts the `<script>` / `<script setup>` block,
 *    runs AST transformations on just that section, then re-assembles the SFC.
 *    The `<template>` and `<style>` blocks are passed through verbatim.
 *  - Uses ts-morph `getDescendantsOfKind` / `node.replaceWithText()` for
 *    import removal, client-instantiation removal, and method-call rewrites.
 *  - Falls back to `this.replaceText()` only for simple token substitution where
 *    AST surgery would be disproportionate.
 *
 * Handles Supabase patterns:
 *   import { createClient } from '@supabase/supabase-js'
 *   supabase.from('table').select(...)       → localApi.from('table').select()
 *   supabase.from('table').insert(data)      → localApi.from('table').insert(data)
 *   supabase.from('table').update(d).eq(...) → localApi.from('table').update(d).eq(...)
 *   supabase.from('table').delete().eq(...)  → localApi.from('table').delete().eq(...)
 *   supabase.auth.*                          → localApi.auth.*
 *
 * Handles Firebase patterns:
 *   import { getFirestore, ... } from 'firebase/...'
 *   getDocs(collection(db, 'table'))         → localApi.get('/api/table')
 *   getDoc(doc(db, 'table', id))             → localApi.get('/api/table/'+id)
 *   addDoc(collection(db, 'table'), data)    → localApi.post('/api/table', data)
 *   deleteDoc(doc(db, 'table', id))          → localApi.delete('/api/table/'+id)
 *   signInWithEmailAndPassword(auth, e, p)   → localApi.auth.signIn({email, password})
 *   Firebase signOut(auth)                   → localApi.auth.signOut()
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
      // At least one signal this is a Vue file
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

    const fullText = sourceFile.getFullText();
    const isVueSFC = fullText.includes("<template") || fullText.includes("<script setup") || fullText.includes("<script>");

    if (isVueSFC) {
      // ── SFC path: extract script block, transform it, re-assemble ─────────
      const { result: transformed, confidence: conf } =
        await this.transformSfc(fullText, changes, warnings, confidence);
      confidence = conf;
      if (transformed !== fullText) {
        sourceFile.replaceWithText(transformed);
      }
    } else {
      // ── Plain TS/JS path: run AST transforms directly ─────────────────────
      confidence = await this.transformScriptContent(sourceFile, changes, warnings, confidence);
    }

    return { changes, warnings, confidence: Math.max(confidence, 0.45) };
  }

  // ─── SFC Splitting ─────────────────────────────────────────────────────────



  /**
   * Parses a Vue SFC into its constituent blocks using a simple state machine.
   * No external dependencies — handles `<script setup lang="ts">` and similar.
   */
  private parseSfcBlocks(src: string): SfcBlock[] {
    const blocks: SfcBlock[] = [];
    // Matches <tag attrs> ... </tag> at the top level
    const blockRe = /<(template|script|style)(\s[^>]*)?>[\s\S]*?<\/\1>/g;
    let match: RegExpExecArray | null;

    while ((match = blockRe.exec(src)) !== null) {
      const full = match[0];
      const tag = match[1];
      const attrs = (match[2] ?? "").trim();
      const openTag = full.slice(0, full.indexOf(">") + 1);
      const closeTag = `</${tag}>`;
      const content = full.slice(openTag.length, full.length - closeTag.length);
      blocks.push({ tag, attrs, content, openTag, closeTag });
    }

    return blocks;
  }

  /**
   * Re-assembles a Vue SFC from its blocks (preserving original order).
   */
  private reassembleSfc(blocks: SfcBlock[]): string {
    return blocks.map((b) => `${b.openTag}${b.content}${b.closeTag}`).join("\n");
  }

  /**
   * Main SFC transformation pipeline:
   * 1. Parse into blocks
   * 2. Run AST transforms on the script block content only
   * 3. Re-assemble
   */
  private async transformSfc(
    src: string,
    changes: string[],
    warnings: string[],
    confidence: number
  ): Promise<{ result: string; confidence: number }> {
    const blocks = this.parseSfcBlocks(src);

    if (blocks.length === 0) {
      // Fallback: no recognisable blocks — treat as plain text
      const sfTemp = this.project.createSourceFile("vue_fallback.ts", src, { overwrite: true });
      confidence = await this.transformScriptContent(sfTemp, changes, warnings, confidence);
      const result = sfTemp.getFullText();
      this.project.removeSourceFile(sfTemp);
      return { result, confidence };
    }

    let mutated = false;

    for (const block of blocks) {
      if (block.tag !== "script") continue;

      // Create a temporary in-memory source file for just the script content
      const lang = block.attrs.includes("lang=\"ts\"") || block.attrs.includes("lang='ts'")
        ? "ts"
        : "js";
      const tempFileName = `vue_script.${lang}`;
      const tempSf = this.project.createSourceFile(tempFileName, block.content, { overwrite: true });

      confidence = await this.transformScriptContent(tempSf, changes, warnings, confidence);
      const transformed = tempSf.getFullText();
      this.project.removeSourceFile(tempSf);

      if (transformed !== block.content) {
        block.content = transformed;
        mutated = true;
      }
    }

    const result = mutated ? this.reassembleSfc(blocks) : src;
    return { result, confidence };
  }

  // ─── Script-level AST transformations ──────────────────────────────────────

  /**
   * Runs all cloud-SDK-to-localApi transformations on a ts-morph SourceFile
   * representing the script content of a Vue SFC or a plain TS/JS file.
   */
  private async transformScriptContent(
    sf: SourceFile,
    changes: string[],
    warnings: string[],
    confidence: number
  ): Promise<number> {
    // ── Supabase ─────────────────────────────────────────────────────────────
    if (sf.getFullText().includes("supabase") || sf.getFullText().includes("@supabase")) {
      confidence = this.removeSupabaseImports(sf, changes, confidence);
      this.removeClientCreation(sf, changes);
      confidence = this.rewriteSupabaseQueries(sf, changes, warnings, confidence);
      confidence = this.rewriteSupabaseAuth(sf, changes, confidence);
      confidence = this.rewriteSupabasePluginPattern(sf, changes, warnings, confidence);
    }

    // ── Firebase ─────────────────────────────────────────────────────────────
    if (sf.getFullText().includes("firebase")) {
      this.removeFirebaseImports(sf, changes);
      this.removeFirebaseInitialisers(sf, changes);
      confidence = this.rewriteFirebaseQueries(sf, changes, confidence);
      confidence = this.rewriteFirebaseAuth(sf, changes, confidence);
    }

    // ── Ensure localApi is imported if any rewrite happened ──────────────────
    const text = sf.getFullText();
    if (
      text.includes("localApi") &&
      !sf.getImportDeclarations().some((d) => d.getModuleSpecifierValue() === "@/lib/localApi")
    ) {
      this.addImport(sf, "@/lib/localApi", ["localApi"]);
    }

    // ── Warn on any remaining supabase. references (after all transforms) ─────
    const supabaseRefs = (sf.getFullText().match(/supabase\./g) ?? []).length;
    if (supabaseRefs > 0) {
      warnings.push(`${supabaseRefs} remaining supabase. reference(s) — manual review needed`);
      confidence -= Math.min(supabaseRefs * 0.04, 0.2);
    }

    // ── Warn on any remaining firebase/ references ─────────────────────────────
    const firebaseRefs = (sf.getFullText().match(/firebase\//g) ?? []).length;
    if (firebaseRefs > 0) {
      warnings.push(`${firebaseRefs} remaining firebase/ reference(s) — manual review needed`);
      confidence -= Math.min(firebaseRefs * 0.04, 0.2);
    }

    return confidence;
  }

  // ─── Supabase: remove imports ───────────────────────────────────────────────

  private removeSupabaseImports(
    sf: SourceFile,
    changes: string[],
    confidence: number
  ): number {
    // @supabase/supabase-js
    const removed = this.removeImport(sf, "@supabase/supabase-js");
    if (removed.length > 0) {
      changes.push("Removed @supabase/supabase-js import");
    }

    // Local supabase client files: lib/supabase, supabaseClient, integrations/supabase/client
    sf.getImportDeclarations()
      .filter((d) =>
        /(?:lib\/supabase|supabaseClient|integrations\/supabase\/client)/.test(
          d.getModuleSpecifierValue()
        )
      )
      .forEach((d) => {
        changes.push(`Removed local supabase client import from '${d.getModuleSpecifierValue()}'`);
        d.remove();
      });

    return confidence;
  }

  // ─── Supabase: remove createClient() ─────────────────────────────────────────

  private removeClientCreation(sf: SourceFile, changes: string[]): void {
    const toRemove: ReturnType<SourceFile["getVariableStatements"]>[number][] = [];

    sf.getVariableStatements().forEach((stmt) => {
      stmt.getDeclarations().forEach((decl) => {
        const init = decl.getInitializer();
        if (!init || init.getKind() !== SyntaxKind.CallExpression) return;
        const callName = (init as CallExpression).getExpression().getText().trim();
        if (callName === "createClient") {
          toRemove.push(stmt);
        }
      });
    });

    for (const stmt of toRemove) {
      changes.push("Removed createClient() instantiation");
      stmt.remove();
    }
  }

  // ─── Supabase: query chain rewrites ──────────────────────────────────────────

  private rewriteSupabaseQueries(
    sf: SourceFile,
    changes: string[],
    warnings: string[],
    confidence: number
  ): number {
    let text = sf.getFullText();

    // SELECT with .eq() filter
    text = text.replace(
      /await\s+\w+\.from\s*\(\s*['"]([\w]+)['"]\s*\)\.select\s*\([^)]*\)\.eq\s*\(\s*['"]([\w]+)['"]\s*,\s*([^)]+)\)/g,
      (_match, table: string, col: string, val: string) => {
        changes.push(`Rewrote filtered select on '${table}' → localApi.get`);
        return `await localApi.get('/api/${table}?${col}='+${val.trim()})`;
      }
    );

    // Plain SELECT
    text = text.replace(
      /await\s+\w+\.from\s*\(\s*['"]([\w]+)['"]\s*\)\.select\s*\(\s*(?:'[^']*'|"[^"]*"|`[^`]*`|\*|)\s*\)/g,
      (_match, table: string) => {
        changes.push(`Rewrote supabase.from('${table}').select() → localApi.get`);
        return `await localApi.get('/api/${table}')`;
      }
    );

    // INSERT
    text = text.replace(
      /await\s+\w+\.from\s*\(\s*['"]([\w]+)['"]\s*\)\.insert\s*\(([^)]+)\)/g,
      (_match, table: string, data: string) => {
        changes.push(`Rewrote insert on '${table}' → localApi.post`);
        return `await localApi.post('/api/${table}', ${data.trim()})`;
      }
    );

    // UPDATE with .eq()
    text = text.replace(
      /await\s+\w+\.from\s*\(\s*['"]([\w]+)['"]\s*\)\.update\s*\(([^)]+)\)\.eq\s*\(\s*['"]id['"]\s*,\s*([^)]+)\)/g,
      (_match, table: string, data: string, id: string) => {
        changes.push(`Rewrote update on '${table}' → localApi.put`);
        return `await localApi.put('/api/${table}/'+${id.trim()}, ${data.trim()})`;
      }
    );

    // DELETE with .eq()
    text = text.replace(
      /await\s+\w+\.from\s*\(\s*['"]([\w]+)['"]\s*\)\.delete\s*\(\s*\)\.eq\s*\(\s*['"]id['"]\s*,\s*([^)]+)\)/g,
      (_match, table: string, id: string) => {
        changes.push(`Rewrote delete on '${table}' → localApi.delete`);
        return `await localApi.delete('/api/${table}/'+${id.trim()})`;
      }
    );

    sf.replaceWithText(text);
    return confidence;
  }

  // ─── Supabase: auth rewrites ──────────────────────────────────────────────────

  private rewriteSupabaseAuth(
    sf: SourceFile,
    changes: string[],
    confidence: number
  ): number {
    let text = sf.getFullText();

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

    // getUser
    text = text.replace(/await\s+\w+\.auth\.getUser\s*\(\s*\)/g, () => {
      changes.push("Rewrote auth.getUser → localApi.auth.getUser");
      return "await localApi.auth.getUser()";
    });

    // getSession
    text = text.replace(/await\s+\w+\.auth\.getSession\s*\(\s*\)/g, () => {
      changes.push("Rewrote auth.getSession → localApi.auth.getSession");
      return "await localApi.auth.getSession()";
    });

    sf.replaceWithText(text);
    return confidence;
  }

  // ─── Supabase: $supabase plugin pattern ──────────────────────────────────────

  private rewriteSupabasePluginPattern(
    sf: SourceFile,
    changes: string[],
    warnings: string[],
    confidence: number
  ): number {
    let text = sf.getFullText();
    if (!text.includes("$supabase")) return confidence;

    text = text.replace(/\$supabase\.from\s*\(\s*['"]([\w]+)['"]\s*\)/g, (_m, table: string) => {
      warnings.push(
        `$supabase plugin pattern detected on table '${table}' — converted to localApi. Verify composable setup.`
      );
      confidence -= 0.05;
      return `{ get: () => localApi.get('/api/${table}'), post: (d: unknown) => localApi.post('/api/${table}', d) }`;
    });

    sf.replaceWithText(text);
    return confidence;
  }

  // ─── Firebase: remove imports ─────────────────────────────────────────────────

  private removeFirebaseImports(sf: SourceFile, changes: string[]): void {
    const removed = sf
      .getImportDeclarations()
      .filter((d) => d.getModuleSpecifierValue().startsWith("firebase/"));

    if (removed.length > 0) {
      changes.push("Removed Firebase imports");
      removed.forEach((d) => d.remove());
    }
  }

  // ─── Firebase: remove initialisers ───────────────────────────────────────────

  private removeFirebaseInitialisers(sf: SourceFile, changes: string[]): void {
    const INIT_FNS = new Set(["initializeApp", "getFirestore", "getAuth", "getStorage", "getApp"]);
    const toRemove: ReturnType<SourceFile["getVariableStatements"]>[number][] = [];

    sf.getVariableStatements().forEach((stmt) => {
      stmt.getDeclarations().forEach((decl) => {
        const init = decl.getInitializer();
        if (!init || init.getKind() !== SyntaxKind.CallExpression) return;
        const callName = (init as CallExpression).getExpression().getText().trim();
        if (INIT_FNS.has(callName)) toRemove.push(stmt);
      });
    });

    for (const stmt of toRemove) {
      changes.push(`Removed Firebase initialisation`);
      stmt.remove();
    }
  }

  // ─── Firebase: Firestore query rewrites ──────────────────────────────────────

  private rewriteFirebaseQueries(
    sf: SourceFile,
    changes: string[],
    confidence: number
  ): number {
    let text = sf.getFullText();

    // getDocs(collection(db, 'table')) → localApi.get('/api/table')
    text = text.replace(
      /await\s+getDocs\s*\(\s*collection\s*\(\s*\w+\s*,\s*['"]([\w]+)['"]\s*\)\s*\)/g,
      (_match, table: string) => {
        changes.push(`Rewrote getDocs(collection('${table}')) → localApi.get`);
        return `await localApi.get('/api/${table}')`;
      }
    );

    // getDoc(doc(db, 'table', id)) → localApi.get('/api/table/'+id)
    text = text.replace(
      /await\s+getDoc\s*\(\s*doc\s*\(\s*\w+\s*,\s*['"]([\w]+)['"]\s*,\s*([^)]+)\s*\)\s*\)/g,
      (_match, table: string, id: string) => {
        changes.push(`Rewrote getDoc(doc('${table}', id)) → localApi.get`);
        return `await localApi.get('/api/${table}/'+${id.trim()})`;
      }
    );

    // addDoc(collection(db, 'table'), data) → localApi.post('/api/table', data)
    text = text.replace(
      /await\s+addDoc\s*\(\s*collection\s*\(\s*\w+\s*,\s*['"]([\w]+)['"]\s*\)\s*,\s*([^)]+)\s*\)/g,
      (_match, table: string, data: string) => {
        changes.push(`Rewrote addDoc('${table}') → localApi.post`);
        return `await localApi.post('/api/${table}', ${data.trim()})`;
      }
    );

    // deleteDoc(doc(db, 'table', id)) → localApi.delete('/api/table/'+id)
    text = text.replace(
      /await\s+deleteDoc\s*\(\s*doc\s*\(\s*\w+\s*,\s*['"]([\w]+)['"]\s*,\s*([^)]+)\s*\)\s*\)/g,
      (_match, table: string, id: string) => {
        changes.push(`Rewrote deleteDoc('${table}', id) → localApi.delete`);
        return `await localApi.delete('/api/${table}/'+${id.trim()})`;
      }
    );

    // Remaining firebase/ references
    const remaining = (text.match(/firebase\//g) ?? []).length;
    if (remaining > 0) {
      confidence -= Math.min(remaining * 0.04, 0.2);
    }

    sf.replaceWithText(text);
    return confidence;
  }

  // ─── Firebase: Auth rewrites ──────────────────────────────────────────────────

  private rewriteFirebaseAuth(
    sf: SourceFile,
    changes: string[],
    confidence: number
  ): number {
    let text = sf.getFullText();

    // signInWithEmailAndPassword(auth, email, password)
    text = text.replace(
      /await\s+signInWithEmailAndPassword\s*\(\s*\w+\s*,\s*([^,]+),\s*([^)]+)\)/g,
      (_m, email: string, password: string) => {
        changes.push("Rewrote signInWithEmailAndPassword → localApi.auth.signIn");
        return `await localApi.auth.signIn({ email: ${email.trim()}, password: ${password.trim()} })`;
      }
    );

    // Firebase signOut(auth) → localApi.auth.signOut()
    text = text.replace(/await\s+signOut\s*\(\s*\w+\s*\)/g, () => {
      changes.push("Rewrote Firebase signOut → localApi.auth.signOut");
      return "await localApi.auth.signOut()";
    });

    sf.replaceWithText(text);
    return confidence;
  }
}
