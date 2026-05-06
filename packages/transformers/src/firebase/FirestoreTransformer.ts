import type { SourceFile } from "ts-morph";
import { BaseTransformer, type TransformContext, type TransformResult } from "../base/BaseTransformer.js";

/**
 * Rewrites Firebase Firestore calls to the local REST API.
 *
 * Firebase → localApi mapping:
 *   getDoc(doc(db, 'col', id))           → GET  /api/col/:id
 *   getDocs(collection(db, 'col'))        → GET  /api/col
 *   getDocs(query(col, where(...)))       → GET  /api/col?field=value
 *   addDoc(collection(db, 'col'), data)   → POST /api/col
 *   setDoc(doc(db, 'col', id), data)      → PUT  /api/col/:id
 *   updateDoc(doc(db, 'col', id), data)   → PUT  /api/col/:id
 *   deleteDoc(doc(db, 'col', id))         → DELETE /api/col/:id
 *   onSnapshot(...)                       → SSE subscribe
 */
export class FirestoreTransformer extends BaseTransformer {
  canTransform(content: string): boolean {
    return (
      content.includes("getFirestore") ||
      content.includes("collection(") ||
      content.includes("getDoc(") ||
      content.includes("getDocs(") ||
      content.includes("addDoc(") ||
      content.includes("setDoc(") ||
      content.includes("updateDoc(") ||
      content.includes("deleteDoc(")
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

    // ── Remove Firebase imports ────────────────────────────────────
    text = text.replace(
      /import\s*\{[^}]+\}\s*from\s*['"]firebase\/firestore['"];?\n?/g,
      ""
    );
    text = text.replace(
      /import\s*\{[^}]+\}\s*from\s*['"]firebase\/app['"];?\n?/g,
      ""
    );
    text = text.replace(
      /import\s*\{[^}]+\}\s*from\s*['"]firebase\/auth['"];?\n?/g,
      ""
    );

    // Add localApi import at top
    if (!text.includes("localApi")) {
      text = `import { localApi } from '@/lib/localApi';\n` + text;
      changes.push("Added localApi import");
    }

    // ── Remove Firebase init references ───────────────────────────
    text = text.replace(/const\s+db\s*=\s*getFirestore\([^)]*\);?\n?/g, "");
    text = text.replace(/const\s+app\s*=\s*initializeApp\([^)]*\);?\n?/g, "");
    changes.push("Removed Firebase initialisation");

    // ── getDoc ────────────────────────────────────────────────────
    // const snap = await getDoc(doc(db, 'users', id))
    // → const snap = await localApi.from('users').eq('id', id).single()
    text = text.replace(
      /await\s+getDoc\s*\(\s*doc\s*\(\s*\w+\s*,\s*['"`](\w+)['"`]\s*,\s*([^)]+)\)\s*\)/g,
      (_m, col: string, id: string) => {
        changes.push(`Rewrote getDoc() on '${col}'`);
        return `await localApi.from('${col}').eq('id', ${id.trim()}).single()`;
      }
    );

    // ── getDocs(collection) ───────────────────────────────────────
    text = text.replace(
      /await\s+getDocs\s*\(\s*collection\s*\(\s*\w+\s*,\s*['"`](\w+)['"`]\s*\)\s*\)/g,
      (_m, col: string) => {
        changes.push(`Rewrote getDocs(collection()) on '${col}'`);
        return `await localApi.from('${col}').select()`;
      }
    );

    // ── getDocs(query with where) ─────────────────────────────────
    // getDocs(query(collection(db, 'col'), where('field', '==', val)))
    text = text.replace(
      /await\s+getDocs\s*\(\s*query\s*\(\s*collection\s*\(\s*\w+\s*,\s*['"`](\w+)['"`]\s*\)\s*,\s*where\s*\(\s*['"`](\w+)['"`]\s*,\s*['"`]===['"`]\s*,\s*([^)]+)\)\s*\)\s*\)/g,
      (_m, col: string, field: string, val: string) => {
        changes.push(`Rewrote getDocs(query(where())) on '${col}'`);
        return `await localApi.from('${col}').eq('${field}', ${val.trim()}).select()`;
      }
    );

    // ── addDoc ────────────────────────────────────────────────────
    text = text.replace(
      /await\s+addDoc\s*\(\s*collection\s*\(\s*\w+\s*,\s*['"`](\w+)['"`]\s*\)\s*,\s*([^)]+)\)/g,
      (_m, col: string, data: string) => {
        changes.push(`Rewrote addDoc() on '${col}'`);
        return `await localApi.from('${col}').insert(${data.trim()})`;
      }
    );

    // ── setDoc ────────────────────────────────────────────────────
    text = text.replace(
      /await\s+setDoc\s*\(\s*doc\s*\(\s*\w+\s*,\s*['"`](\w+)['"`]\s*,\s*([^,)]+)\)\s*,\s*([^)]+)\)/g,
      (_m, col: string, id: string, data: string) => {
        changes.push(`Rewrote setDoc() on '${col}'`);
        return `await localApi.from('${col}').upsert({ id: ${id.trim()}, ...${data.trim()} })`;
      }
    );

    // ── updateDoc ─────────────────────────────────────────────────
    text = text.replace(
      /await\s+updateDoc\s*\(\s*doc\s*\(\s*\w+\s*,\s*['"`](\w+)['"`]\s*,\s*([^,)]+)\)\s*,\s*([^)]+)\)/g,
      (_m, col: string, id: string, data: string) => {
        changes.push(`Rewrote updateDoc() on '${col}'`);
        return `await localApi.from('${col}').eq('id', ${id.trim()}).update(${data.trim()})`;
      }
    );

    // ── deleteDoc ─────────────────────────────────────────────────
    text = text.replace(
      /await\s+deleteDoc\s*\(\s*doc\s*\(\s*\w+\s*,\s*['"`](\w+)['"`]\s*,\s*([^)]+)\)\s*\)/g,
      (_m, col: string, id: string) => {
        changes.push(`Rewrote deleteDoc() on '${col}'`);
        return `await localApi.from('${col}').eq('id', ${id.trim()}).delete()`;
      }
    );

    // ── onSnapshot → SSE ──────────────────────────────────────────
    const hasSnapshot = text.includes("onSnapshot(");
    if (hasSnapshot) {
      text = text.replace(
        /onSnapshot\s*\(\s*(?:collection|doc)\s*\(\s*\w+\s*,\s*['"`](\w+)['"`][^)]*\)\s*,\s*(\w+)\s*\)/g,
        (_m, col: string, cb: string) => {
          changes.push(`Rewrote onSnapshot() on '${col}' → SSE`);
          return `localApi.subscribe('${col}', ${cb})`;
        }
      );
    }

    // ── Warn on remaining Firebase refs ───────────────────────────
    const remaining = (text.match(/\bfirebase\b|\bFirestore\b|\bgetFirestore\b/g) ?? []).length;
    if (remaining > 0) {
      warnings.push(`${remaining} remaining Firebase reference(s) — manual review needed`);
      confidence -= Math.min(remaining * 0.05, 0.25);
    }

    // ── Rewrite .data() calls on snapshots ────────────────────────
    // Firestore: snap.data() → localApi returns { data: row }
    text = text.replace(/(\w+)\.data\(\)/g, (_m, snap: string) => {
      if (snap === "snap" || snap === "snapshot" || snap === "docSnap") {
        changes.push("Rewrote .data() access pattern");
        return `${snap}.data`;
      }
      return _m;
    });

    // ── Rewrite .docs.map() ───────────────────────────────────────
    text = text.replace(/(\w+)\.docs\.map\(/g, (_m, snap: string) => {
      changes.push("Rewrote .docs.map() → .data.map()");
      return `${snap}.data.map(`;
    });

    if (changes.length > 0) sourceFile.replaceWithText(text);

    return { changes, warnings, confidence: Math.max(confidence, 0.4) };
  }
}
