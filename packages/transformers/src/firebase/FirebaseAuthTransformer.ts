import type { SourceFile } from "ts-morph";
import { BaseTransformer, type TransformContext, type TransformResult } from "../base/BaseTransformer.js";

/**
 * Rewrites Firebase Auth calls to the local JWT auth API.
 *
 *   signInWithEmailAndPassword(auth, email, pass) → localApi.auth.signInWithPassword({email,password})
 *   createUserWithEmailAndPassword(auth, e, p)    → localApi.auth.signUp({email,password})
 *   signOut(auth)                                 → localApi.auth.signOut()
 *   onAuthStateChanged(auth, cb)                  → localApi.auth.onAuthStateChange(cb)
 *   getAuth()                                     → removed
 *   currentUser                                   → (session user from localApi)
 */
export class FirebaseAuthTransformer extends BaseTransformer {
  canTransform(content: string): boolean {
    return (
      content.includes("firebase/auth") ||
      content.includes("signInWithEmailAndPassword") ||
      content.includes("createUserWithEmailAndPassword") ||
      content.includes("onAuthStateChanged") ||
      content.includes("getAuth()")
    );
  }

  protected async transformSourceFile(
    sourceFile: SourceFile,
    _ctx: TransformContext
  ): Promise<Pick<TransformResult, "changes" | "warnings" | "confidence">> {
    const changes: string[] = [];
    const warnings: string[] = [];
    let confidence = 0.85;
    let text = sourceFile.getFullText();

    // Remove Firebase auth import
    text = text.replace(
      /import\s*\{[^}]+\}\s*from\s*['"]firebase\/auth['"];?\n?/g, ""
    );

    // Add localApi import
    if (!text.includes("localApi")) {
      text = `import { localApi } from '@/lib/localApi';\n` + text;
      changes.push("Added localApi import");
    }

    // Remove auth instance
    text = text.replace(/const\s+auth\s*=\s*getAuth\([^)]*\);?\n?/g, "");

    // signInWithEmailAndPassword
    text = text.replace(
      /await\s+signInWithEmailAndPassword\s*\(\s*\w+\s*,\s*([^,]+),\s*([^)]+)\)/g,
      (_m, email: string, pass: string) => {
        changes.push("Rewrote signInWithEmailAndPassword");
        return `await localApi.auth.signInWithPassword({ email: ${email.trim()}, password: ${pass.trim()} })`;
      }
    );

    // createUserWithEmailAndPassword
    text = text.replace(
      /await\s+createUserWithEmailAndPassword\s*\(\s*\w+\s*,\s*([^,]+),\s*([^)]+)\)/g,
      (_m, email: string, pass: string) => {
        changes.push("Rewrote createUserWithEmailAndPassword");
        return `await localApi.auth.signUp({ email: ${email.trim()}, password: ${pass.trim()} })`;
      }
    );

    // signOut
    text = text.replace(
      /await\s+signOut\s*\(\s*\w+\s*\)/g,
      () => { changes.push("Rewrote signOut"); return "await localApi.auth.signOut()"; }
    );

    // onAuthStateChanged
    text = text.replace(
      /onAuthStateChanged\s*\(\s*\w+\s*,\s*([^)]+)\)/g,
      (_m, cb: string) => {
        changes.push("Rewrote onAuthStateChanged → onAuthStateChange");
        return `localApi.auth.onAuthStateChange(${cb.trim()})`;
      }
    );

    // currentUser → handled via session
    if (text.includes(".currentUser")) {
      warnings.push(
        "currentUser references detected — replace with session user from localApi.auth.getSession()"
      );
      confidence -= 0.1;
    }

    // UserCredential → just use the returned user object
    text = text.replace(/UserCredential/g, "{ user: unknown }");

    if (changes.length > 0) sourceFile.replaceWithText(text);
    return { changes, warnings, confidence: Math.max(confidence, 0.5) };
  }
}
