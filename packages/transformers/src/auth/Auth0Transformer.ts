import { SyntaxKind, type SourceFile, type CallExpression } from "ts-morph";
import { BaseTransformer, type TransformContext, type TransformResult } from "../base/BaseTransformer.js";

/**
 * Rewrites Auth0 hooks and components to use the local JWT auth session,
 * using AST node traversal via ts-morph.
 *
 * Auth0 → localApi mapping:
 *   useAuth0()                  → useLocalAuth()
 *   isAuthenticated             → isSignedIn
 *   isLoading                   → isLoaded
 *   loginWithRedirect()         → localApi.auth.signIn()
 *   loginWithPopup()            → localApi.auth.signIn()
 *   logout()                    → localApi.auth.signOut()
 *   getAccessTokenSilently()    → localApi.auth.getToken()
 *   <Auth0Provider>             → removed (comment stub left)
 *   withAuthenticationRequired  → unwrapped with route-guard warning
 *   withAuth0                   → removed, use hooks instead
 *   user.sub                    → user?.id
 *   user.nickname               → user?.name
 *   user.picture                → null (with comment)
 *   user.email_verified         → true
 */
export class Auth0Transformer extends BaseTransformer {
  canTransform(content: string): boolean {
    return (
      content.includes("@auth0/auth0-react") ||
      content.includes("useAuth0") ||
      content.includes("Auth0Provider") ||
      content.includes("withAuthenticationRequired") ||
      content.includes("loginWithRedirect") ||
      content.includes("getAccessTokenSilently")
    );
  }

  protected async transformSourceFile(
    sourceFile: SourceFile,
    _ctx: TransformContext
  ): Promise<Pick<TransformResult, "changes" | "warnings" | "confidence">> {
    const changes: string[] = [];
    const warnings: string[] = [];
    let confidence = 0.83;

    // ── 1. Remove Auth0 imports ────────────────────────────────────────────────
    this.removeAuth0Imports(sourceFile, changes);

    // ── 2. Add local auth imports ──────────────────────────────────────────────
    this.addLocalImports(sourceFile, changes);

    // ── 3. Rewrite useAuth0() → useLocalAuth() via AST CallExpression walk ────
    this.rewriteUseAuth0Hook(sourceFile, changes);

    // ── 4. Rename destructured properties from useLocalAuth() ──────────────────
    this.rewriteDestructuring(sourceFile, changes);

    // ── 5. Rewrite standalone isAuthenticated references ──────────────────────
    this.rewriteStandaloneProperties(sourceFile, changes);

    // ── 6. Rewrite Auth0 method calls via AST CallExpression walk ─────────────
    this.rewriteMethodCalls(sourceFile, changes);

    // ── 7. Provider / HOC rewrites (text-level via sourceFile.replaceWithText) ─
    confidence = this.rewriteProviderAndHoc(sourceFile, changes, warnings, confidence);

    // ── 8. User object field mapping ──────────────────────────────────────────
    confidence = this.rewriteUserFields(sourceFile, changes, warnings, confidence);

    // ── 9. Warn on any remaining @auth0/ references ────────────────────────────
    const remaining = (sourceFile.getFullText().match(/@auth0\//g) ?? []).length;
    if (remaining > 0) {
      warnings.push(`${remaining} remaining @auth0/ reference(s) — manual review needed`);
      confidence -= remaining * 0.05;
    }

    return { changes, warnings, confidence: Math.max(confidence, 0.5) };
  }

  // ─── Step 1: Remove Auth0 imports ────────────────────────────────────────────

  private removeAuth0Imports(sourceFile: SourceFile, changes: string[]): void {
    const removed = this.removeImport(sourceFile, "@auth0/auth0-react");
    if (removed.length > 0) {
      changes.push("Removed @auth0/auth0-react imports");
      return;
    }
    // Catch any import whose specifier contains auth0
    sourceFile
      .getImportDeclarations()
      .filter((d) => d.getModuleSpecifierValue().includes("auth0"))
      .forEach((d) => {
        changes.push(`Removed import from '${d.getModuleSpecifierValue()}'`);
        d.remove();
      });
  }

  // ─── Step 2: Add local imports ────────────────────────────────────────────────

  private addLocalImports(sourceFile: SourceFile, changes: string[]): void {
    const text = sourceFile.getFullText();

    if (!text.includes("useLocalAuth")) {
      this.addImport(sourceFile, "@/hooks/useLocalAuth", ["useLocalAuth"]);
      changes.push("Added useLocalAuth import");
    }

    const needsLocalApi =
      text.includes("loginWithRedirect") ||
      text.includes("loginWithPopup") ||
      text.includes("logout") ||
      text.includes("getAccessTokenSilently");

    if (!text.includes("localApi") && needsLocalApi) {
      this.addImport(sourceFile, "@/lib/localApi", ["localApi"]);
      changes.push("Added localApi import");
    }
  }

  // ─── Step 3: useAuth0() → useLocalAuth() ─────────────────────────────────────

  private rewriteUseAuth0Hook(sourceFile: SourceFile, changes: string[]): void {
    let mutated = true;
    while (mutated) {
      mutated = false;
      const calls = sourceFile
        .getDescendantsOfKind(SyntaxKind.CallExpression)
        .filter((c) => c.getExpression().getText().trim() === "useAuth0");

      if (calls.length === 0) break;
      calls[0].replaceWithText("useLocalAuth()");
      changes.push("Rewrote useAuth0() → useLocalAuth()");
      mutated = true;
    }
  }

  // ─── Step 4: Rename destructured properties ────────────────────────────────────

  /** Maps Auth0 property names to local equivalents in destructuring patterns. */
  private static readonly PROP_MAP: Record<string, string> = {
    isAuthenticated: "isSignedIn",
    isLoading: "isLoaded",
    loginWithRedirect: "signIn",
    loginWithPopup: "signIn",
    logout: "signOut",
    getAccessTokenSilently: "getToken",
  };

  private rewriteDestructuring(sourceFile: SourceFile, changes: string[]): void {
    const decls = sourceFile.getDescendantsOfKind(SyntaxKind.VariableDeclaration);

    for (const decl of decls) {
      const initializer = decl.getInitializer();
      if (!initializer || initializer.getKind() !== SyntaxKind.CallExpression) continue;

      const callName = (initializer as CallExpression).getExpression().getText().trim();
      if (callName !== "useLocalAuth") continue;

      const nameNode = decl.getNameNode();
      if (nameNode.getKind() !== SyntaxKind.ObjectBindingPattern) continue;

      const elements = nameNode.getDescendantsOfKind(SyntaxKind.BindingElement);
      let rewrote = false;

      for (const el of elements) {
        const propName = el.getPropertyNameNode();
        const nameId = el.getNameNode();

        if (propName) {
          // Explicit alias: { auth0Name: localAlias }
          const originalText = propName.getText().trim();
          const mapped = Auth0Transformer.PROP_MAP[originalText];
          if (mapped) {
            propName.replaceWithText(mapped);
            rewrote = true;
          }
        } else {
          // No alias — the binding name IS the property name
          const nameText = nameId.getText().trim();
          const mapped = Auth0Transformer.PROP_MAP[nameText];
          if (mapped && mapped !== nameText) {
            nameId.replaceWithText(mapped);
            rewrote = true;
          }
        }
      }

      if (rewrote) {
        changes.push("Rewrote useAuth0 destructuring property names");
      }
    }
  }

  // ─── Step 5: Standalone property renames ─────────────────────────────────────

  private rewriteStandaloneProperties(sourceFile: SourceFile, changes: string[]): void {
    if (sourceFile.getFullText().includes("isAuthenticated")) {
      this.replaceText(sourceFile, /\bisAuthenticated\b/g, "isSignedIn");
      changes.push("Renamed isAuthenticated → isSignedIn");
    }
  }

  // ─── Step 6: Method call rewrites ────────────────────────────────────────────

  /** Maps Auth0 method names to their replacement expression text. */
  private static readonly CALL_MAP: Record<string, string> = {
    loginWithRedirect: "localApi.auth.signIn()",
    loginWithPopup: "localApi.auth.signIn()",
    logout: "localApi.auth.signOut()",
    getAccessTokenSilently: "localApi.auth.getToken()",
  };

  private rewriteMethodCalls(sourceFile: SourceFile, changes: string[]): void {
    let mutated = true;
    while (mutated) {
      mutated = false;
      const calls = sourceFile
        .getDescendantsOfKind(SyntaxKind.CallExpression)
        .filter((c) => c.getExpression().getText().trim() in Auth0Transformer.CALL_MAP);

      if (calls.length === 0) break;

      const call = calls[0];
      const name = call.getExpression().getText().trim();
      const replacement = Auth0Transformer.CALL_MAP[name];
      call.replaceWithText(replacement);
      changes.push(`Rewrote ${name}() → ${replacement}`);
      mutated = true;
    }
  }

  // ─── Step 7: Provider / HOC rewrites ──────────────────────────────────────────

  private rewriteProviderAndHoc(
    sourceFile: SourceFile,
    changes: string[],
    warnings: string[],
    confidence: number
  ): number {
    let text = sourceFile.getFullText();
    let dirty = false;

    // <Auth0Provider ...> open tags (including those with props)
    if (text.includes("<Auth0Provider")) {
      text = text.replace(/<Auth0Provider[^>]*(?:\/??>)/g, "{/* Auth0Provider removed by WebToApp */}");
      text = text.replace(/<\/Auth0Provider>/g, "");
      changes.push("Removed Auth0Provider wrapper");
      dirty = true;
    }

    // withAuthenticationRequired(Component, options?)
    if (text.includes("withAuthenticationRequired")) {
      text = text.replace(
        /withAuthenticationRequired\s*\(\s*(\w+)\s*(?:,\s*\{[^}]*\})?\s*\)/g,
        (_match, componentName: string) => {
          changes.push(`Unwrapped withAuthenticationRequired(${componentName})`);
          warnings.push(
            "withAuthenticationRequired removed — add route-level auth guard in your router instead."
          );
          confidence -= 0.05;
          return componentName;
        }
      );
      dirty = true;
    }

    // withAuth0(Component)
    if (text.includes("withAuth0")) {
      text = text.replace(
        /withAuth0\s*\(\s*(\w+)\s*\)/g,
        (_match, componentName: string) => {
          changes.push(`Removed withAuth0(${componentName})`);
          return componentName;
        }
      );
      dirty = true;
    }

    if (dirty) {
      sourceFile.replaceWithText(text);
    }

    return confidence;
  }

  // ─── Step 8: User field mapping ───────────────────────────────────────────────

  private rewriteUserFields(
    sourceFile: SourceFile,
    changes: string[],
    warnings: string[],
    confidence: number
  ): number {
    const text = sourceFile.getFullText();

    if (text.includes("user.sub") || text.includes("user?.sub")) {
      this.replaceText(sourceFile, /user\?\.sub\b/g, "user?.id");
      this.replaceText(sourceFile, /user\.sub\b/g, "user?.id");
      changes.push("Mapped user.sub → user?.id");
    }

    if (text.includes(".nickname")) {
      this.replaceText(sourceFile, /user\?\.nickname\b/g, "user?.name");
      this.replaceText(sourceFile, /user\.nickname\b/g, "user?.name");
      changes.push("Mapped user.nickname → user?.name");
    }

    if (text.includes("user.picture") || text.includes("user?.picture")) {
      this.replaceText(sourceFile, /user\?\.picture\b/g, "null /* avatar not available locally */");
      this.replaceText(sourceFile, /user\.picture\b/g, "null /* avatar not available locally */");
      warnings.push("user.picture not available in local auth — replaced with null");
      confidence -= 0.03;
    }

    if (text.includes("email_verified")) {
      this.replaceText(sourceFile, /user\?\.email_verified\b/g, "true");
      this.replaceText(sourceFile, /user\.email_verified\b/g, "true");
      changes.push("email_verified always true in local auth");
    }

    return confidence;
  }
}
