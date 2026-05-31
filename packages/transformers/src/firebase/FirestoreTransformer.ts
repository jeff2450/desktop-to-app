import { SyntaxKind, type SourceFile, type CallExpression, type Node } from "ts-morph";
import { BaseTransformer, type TransformContext, type TransformResult } from "../base/BaseTransformer.js";

/**
 * Rewrites Firebase Firestore calls to the local REST API using AST node
 * traversal via ts-morph. This replaces the previous regex-based approach
 * with a syntax-agnostic, formatting-resilient implementation that correctly
 * handles aliased variable names, multi-line expressions, and nested calls.
 *
 * Firebase → localApi mapping:
 *   getDoc(doc(db, 'col', id))                         → localApi.from('col').eq('id', id).single()
 *   getDocs(collection(db, 'col'))                     → localApi.from('col').select()
 *   getDocs(query(col, where('f','==',v)))             → localApi.from('col').eq('f', v).select()
 *   getDocs(query(col, where(...), limit(n)))          → localApi.from('col').eq(...).limit(n).select()
 *   getDocs(query(col, where(...), orderBy('f','d')))  → localApi.from('col').eq(...).order('f','d').select()
 *   addDoc(collection(db, 'col'), data)                → localApi.from('col').insert(data)
 *   setDoc(doc(db, 'col', id), data)                   → localApi.from('col').upsert({ id, ...data })
 *   updateDoc(doc(db, 'col', id), data)                → localApi.from('col').eq('id', id).update(data)
 *   deleteDoc(doc(db, 'col', id))                      → localApi.from('col').eq('id', id).delete()
 *   onSnapshot(collection(...)/doc(...), callback)     → localApi.subscribe('col', callback)
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
      content.includes("deleteDoc(") ||
      content.includes("onSnapshot(")
    );
  }

  protected async transformSourceFile(
    sourceFile: SourceFile,
    _ctx: TransformContext
  ): Promise<Pick<TransformResult, "changes" | "warnings" | "confidence">> {
    const changes: string[] = [];
    const warnings: string[] = [];
    let confidence = 0.80;

    // ── 1. Remove Firebase imports ────────────────────────────────────────────
    this.removeFirebaseImports(sourceFile, changes);

    // ── 2. Add localApi import ────────────────────────────────────────────────
    this.addImport(sourceFile, "@/lib/localApi", ["localApi"]);
    changes.push("Added localApi import");

    // ── 3. Remove Firebase initialisation statements ──────────────────────────
    this.removeInitialisers(sourceFile, changes);

    // ── 4. Rewrite Firestore CallExpressions (AST traversal) ─────────────────
    this.rewriteFirestoreCalls(sourceFile, changes, warnings);

    // ── 5. Rewrite snapshot data accessors (safe simple tokens) ───────────────
    this.rewriteSnapshotAccessors(sourceFile, changes);

    // ── 6. Warn on any remaining Firebase references ──────────────────────────
    const text = sourceFile.getFullText();
    const remaining = (text.match(/\bfirebase\b|\bFirestore\b|\bgetFirestore\b/g) ?? []).length;
    if (remaining > 0) {
      warnings.push(`${remaining} remaining Firebase reference(s) — manual review needed`);
      confidence -= Math.min(remaining * 0.05, 0.25);
    }

    return { changes, warnings, confidence: Math.max(confidence, 0.4) };
  }

  // ─── Step 1: Remove Firebase imports ────────────────────────────────────────

  private removeFirebaseImports(sourceFile: SourceFile, changes: string[]): void {
    const targets = ["firebase/firestore", "firebase/app", "firebase/auth"];
    for (const specifier of targets) {
      const removed = this.removeImport(sourceFile, specifier);
      if (removed.length > 0) {
        changes.push(`Removed import from '${specifier}'`);
      }
    }
    // Also catch any remaining firebase/* imports not in the explicit list
    sourceFile.getImportDeclarations()
      .filter((d) => d.getModuleSpecifierValue().startsWith("firebase/"))
      .forEach((d) => {
        changes.push(`Removed import from '${d.getModuleSpecifierValue()}'`);
        d.remove();
      });
  }

  // ─── Step 3: Remove getFirestore / initializeApp variable declarations ───────

  private removeInitialisers(sourceFile: SourceFile, changes: string[]): void {
    const INIT_FUNCTIONS = new Set(["getFirestore", "initializeApp", "getApp"]);

    // Collect statements to remove (don't mutate while iterating).
    // Use the specific VariableStatement type so TypeScript knows .remove() exists.
    const toRemove: ReturnType<SourceFile["getVariableStatements"]>[number][] = [];

    sourceFile.getVariableStatements().forEach((stmt) => {
      stmt.getDeclarations().forEach((decl) => {
        const init = decl.getInitializer();
        if (!init) return;
        // Handle: const db = getFirestore(app) and const db = getFirestore()
        if (init.getKind() === SyntaxKind.CallExpression) {
          const callExpr = init as CallExpression;
          const expr = callExpr.getExpression().getText().trim();
          if (INIT_FUNCTIONS.has(expr)) {
            toRemove.push(stmt);
          }
        }
      });
    });

    for (const stmt of toRemove) {
      changes.push(`Removed Firebase initialisation: ${stmt.getText().trim().slice(0, 60)}`);
      stmt.remove();
    }
  }

  // ─── Step 4: Rewrite Firestore CallExpressions ───────────────────────────────

  private rewriteFirestoreCalls(
    sourceFile: SourceFile,
    changes: string[],
    warnings: string[]
  ): void {
    const FIRESTORE_OPS = new Set([
      "getDoc", "getDocs", "addDoc", "setDoc",
      "updateDoc", "deleteDoc", "onSnapshot",
    ]);

    // Collect outer-most Firestore call expressions first (avoid double-walking
    // after replacements invalidate node references). We replace text on the
    // source file after each matched node by calling getFullText() loop style.
    let changed = true;
    while (changed) {
      changed = false;
      const calls = sourceFile
        .getDescendantsOfKind(SyntaxKind.CallExpression)
        .filter((c) => {
          const name = c.getExpression().getText().trim();
          return FIRESTORE_OPS.has(name);
        });

      for (const call of calls) {
        const opName = call.getExpression().getText().trim();
        const replacement = this.buildReplacement(opName, call, warnings);
        if (replacement !== null) {
          changes.push(`Rewrote ${opName}() call`);
          call.replaceWithText(replacement);
          changed = true;
          break; // restart walk — AST nodes are invalidated after mutation
        }
      }
    }
  }

  /**
   * Returns the replacement text for a matched Firestore outer call, or null
   * if it cannot be automatically transformed.
   */
  private buildReplacement(
    opName: string,
    call: CallExpression,
    warnings: string[]
  ): string | null {
    const args = call.getArguments();

    try {
      switch (opName) {
        case "getDoc":
          return this.rewriteGetDoc(args);
        case "getDocs":
          return this.rewriteGetDocs(args, warnings);
        case "addDoc":
          return this.rewriteAddDoc(args);
        case "setDoc":
          return this.rewriteSetDoc(args);
        case "updateDoc":
          return this.rewriteUpdateDoc(args);
        case "deleteDoc":
          return this.rewriteDeleteDoc(args);
        case "onSnapshot":
          return this.rewriteOnSnapshot(args);
        default:
          return null;
      }
    } catch {
      warnings.push(`Could not auto-transform ${opName}() — manual review needed`);
      return null;
    }
  }

  // ─── Individual rewrite methods ──────────────────────────────────────────────

  /**
   * getDoc(doc(db, 'col', id)) → localApi.from('col').eq('id', id).single()
   */
  private rewriteGetDoc(args: Node[]): string | null {
    if (args.length < 1) return null;
    const docRef = this.extractDocRef(args[0]);
    if (!docRef) return null;
    return `localApi.from('${docRef.collection}').eq('id', ${docRef.id}).single()`;
  }

  /**
   * getDocs(collection(db, 'col'))
   *   → localApi.from('col').select()
   * getDocs(query(collection(db, 'col'), where('f','==',v), limit(n), orderBy('f','d')))
   *   → localApi.from('col').eq('f', v).limit(n).order('f', 'd').select()
   */
  private rewriteGetDocs(args: Node[], warnings: string[]): string | null {
    if (args.length < 1) return null;
    const arg = args[0];
    const argText = arg.getText().trim();

    // Simple collection reference
    if (argText.startsWith("collection(")) {
      const col = this.extractCollectionName(arg as CallExpression);
      if (!col) return null;
      return `localApi.from('${col}').select()`;
    }

    // query(collection(...), ...constraints)
    if (argText.startsWith("query(")) {
      return this.rewriteQueryCall(arg as CallExpression, warnings);
    }

    return null;
  }

  /**
   * Parses query(collection(db, 'col'), where(...), limit(...), orderBy(...))
   */
  private rewriteQueryCall(queryCall: CallExpression, warnings: string[]): string | null {
    const queryArgs = queryCall.getArguments();
    if (queryArgs.length < 1) return null;

    const col = this.extractCollectionName(queryArgs[0] as CallExpression);
    if (!col) return null;

    let chain = `localApi.from('${col}')`;

    // Process constraints
    for (let i = 1; i < queryArgs.length; i++) {
      const constraint = queryArgs[i];
      const constraintText = constraint.getText().trim();

      if (constraintText.startsWith("where(")) {
        const whereClause = this.extractWhereClause(constraint as CallExpression);
        if (whereClause) {
          chain += `.eq('${whereClause.field}', ${whereClause.value})`;
        } else {
          warnings.push("Complex where() clause not auto-transformed — manual review needed");
        }
      } else if (constraintText.startsWith("limit(")) {
        const limitArgs = (constraint as CallExpression).getArguments();
        if (limitArgs.length > 0) {
          chain += `.limit(${limitArgs[0].getText().trim()})`;
        }
      } else if (constraintText.startsWith("orderBy(")) {
        const orderArgs = (constraint as CallExpression).getArguments();
        if (orderArgs.length >= 1) {
          const field = orderArgs[0].getText().trim();
          const dir = orderArgs.length >= 2 ? `, ${orderArgs[1].getText().trim()}` : "";
          chain += `.order(${field}${dir})`;
        }
      } else if (constraintText.startsWith("startAfter(") || constraintText.startsWith("startAt(") || constraintText.startsWith("endBefore(") || constraintText.startsWith("endAt(")) {
        warnings.push(`Pagination constraint '${constraintText.split("(")[0]}()' not auto-transformed — manual review needed`);
      }
    }

    chain += `.select()`;
    return chain;
  }

  /**
   * addDoc(collection(db, 'col'), data) → localApi.from('col').insert(data)
   */
  private rewriteAddDoc(args: Node[]): string | null {
    if (args.length < 2) return null;
    const col = this.extractCollectionName(args[0] as CallExpression);
    if (!col) return null;
    const data = args[1].getText().trim();
    return `localApi.from('${col}').insert(${data})`;
  }

  /**
   * setDoc(doc(db, 'col', id), data) → localApi.from('col').upsert({ id: id, ...data })
   */
  private rewriteSetDoc(args: Node[]): string | null {
    if (args.length < 2) return null;
    const docRef = this.extractDocRef(args[0]);
    if (!docRef) return null;
    const data = args[1].getText().trim();
    return `localApi.from('${docRef.collection}').upsert({ id: ${docRef.id}, ...${data} })`;
  }

  /**
   * updateDoc(doc(db, 'col', id), data) → localApi.from('col').eq('id', id).update(data)
   */
  private rewriteUpdateDoc(args: Node[]): string | null {
    if (args.length < 2) return null;
    const docRef = this.extractDocRef(args[0]);
    if (!docRef) return null;
    const data = args[1].getText().trim();
    return `localApi.from('${docRef.collection}').eq('id', ${docRef.id}).update(${data})`;
  }

  /**
   * deleteDoc(doc(db, 'col', id)) → localApi.from('col').eq('id', id).delete()
   */
  private rewriteDeleteDoc(args: Node[]): string | null {
    if (args.length < 1) return null;
    const docRef = this.extractDocRef(args[0]);
    if (!docRef) return null;
    return `localApi.from('${docRef.collection}').eq('id', ${docRef.id}).delete()`;
  }

  /**
   * onSnapshot(collection(db, 'col'), cb) → localApi.subscribe('col', cb)
   * onSnapshot(doc(db, 'col', id), cb)    → localApi.subscribe('col', cb)
   */
  private rewriteOnSnapshot(args: Node[]): string | null {
    if (args.length < 2) return null;
    const refArg = args[0];
    const refText = refArg.getText().trim();
    const cb = args[1].getText().trim();

    let col: string | null = null;
    if (refText.startsWith("collection(")) {
      col = this.extractCollectionName(refArg as CallExpression);
    } else if (refText.startsWith("doc(")) {
      const docRef = this.extractDocRef(refArg);
      col = docRef?.collection ?? null;
    }

    if (!col) return null;
    return `localApi.subscribe('${col}', ${cb})`;
  }

  // ─── AST extraction helpers ──────────────────────────────────────────────────

  /**
   * Extracts the collection name from: collection(db, 'colName')
   * Handles any variable name as the first argument (db alias independence).
   */
  private extractCollectionName(node: Node): string | null {
    if (node.getKind() !== SyntaxKind.CallExpression) return null;
    const call = node as CallExpression;
    const fnName = call.getExpression().getText().trim();
    if (fnName !== "collection") return null;

    const args = call.getArguments();
    if (args.length < 2) return null;

    return this.extractStringLiteral(args[1]);
  }

  /**
   * Extracts collection + id from: doc(db, 'colName', id)
   * Returns null if the pattern doesn't match.
   */
  private extractDocRef(node: Node): { collection: string; id: string } | null {
    if (node.getKind() !== SyntaxKind.CallExpression) return null;
    const call = node as CallExpression;
    const fnName = call.getExpression().getText().trim();
    if (fnName !== "doc") return null;

    const args = call.getArguments();
    if (args.length < 3) return null;

    const collection = this.extractStringLiteral(args[1]);
    if (!collection) return null;

    const id = args[2].getText().trim();
    return { collection, id };
  }

  /**
   * Extracts where clause: where('field', '==', value) → { field, value }
   * Currently only handles equality ('==') — other operators emit a warning.
   */
  private extractWhereClause(
    call: CallExpression
  ): { field: string; value: string } | null {
    const args = call.getArguments();
    if (args.length < 3) return null;

    const field = this.extractStringLiteral(args[0]);
    if (!field) return null;

    const operator = this.extractStringLiteral(args[1]);
    // Only auto-transform equality for now
    if (operator !== "==") return null;

    const value = args[2].getText().trim();
    return { field, value };
  }

  /**
   * Extracts the raw string value from a StringLiteral / TemplateLiteral node,
   * or returns null if the node is not a plain string literal.
   */
  private extractStringLiteral(node: Node): string | null {
    const kind = node.getKind();
    if (
      kind === SyntaxKind.StringLiteral ||
      kind === SyntaxKind.NoSubstitutionTemplateLiteral
    ) {
      // getText() includes the quotes — strip them
      const raw = node.getText();
      return raw.slice(1, -1);
    }
    return null;
  }

  // ─── Step 5: Rewrite snapshot data accessors ─────────────────────────────────

  private rewriteSnapshotAccessors(sourceFile: SourceFile, changes: string[]): void {
    // snap.data() → snap.data  (only for well-known snapshot variable names)
    const SNAP_NAMES = /\b(snap|snapshot|docSnap|docSnapshot)\b/;
    let text = sourceFile.getFullText();
    const dataCallPattern = /\b(snap|snapshot|docSnap|docSnapshot)\.data\(\)/g;
    if (dataCallPattern.test(text)) {
      const replaced = text.replace(dataCallPattern, "$1.data");
      if (replaced !== text) {
        sourceFile.replaceWithText(replaced);
        text = replaced;
        changes.push("Rewrote .data() access pattern → .data");
      }
    }

    // snap.docs.map( → snap.data.map(
    if (text.includes(".docs.map(")) {
      const replaced = text.replace(/(\w+)\.docs\.map\(/g, "$1.data.map(");
      if (replaced !== text) {
        sourceFile.replaceWithText(replaced);
        changes.push("Rewrote .docs.map() → .data.map()");
      }
    }

    // Suppress unused variable warning
    void SNAP_NAMES;
  }
}
