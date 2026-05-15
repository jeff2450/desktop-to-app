import type { SourceFile } from "ts-morph";
import { BaseTransformer, type TransformContext, type TransformResult } from "../base/BaseTransformer.js";

/**
 * Rewrites Auth0 hooks and components to use the local JWT auth session.
 *
 * Auth0 → localApi mapping:
 *   useAuth0()                  → useLocalAuth() (generated hook)
 *   isAuthenticated             → isSignedIn
 *   user                        → user (same shape, subset of fields)
 *   loginWithRedirect()         → localApi.auth.signIn() / navigate to /auth/login
 *   loginWithPopup()            → localApi.auth.signIn()
 *   logout()                    → localApi.auth.signOut()
 *   getAccessTokenSilently()    → localApi.auth.getToken()
 *   Auth0Provider               → removed (wraps with LocalAuthProvider)
 *   withAuthenticationRequired  → replaced with requireAuth HOC stub
 *   withAuth0                   → removed, use hooks instead
 *   <LoginButton />             → <a href="/auth/login">Sign in</a>
 *   <LogoutButton />            → signOut button
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
    let text = sourceFile.getFullText();

    // ── Remove Auth0 imports ──────────────────────────────────────
    text = text.replace(
      /import\s*\{[^}]+\}\s*from\s*['"]@auth0\/auth0-react['"];?\n?/g,
      ""
    );
    changes.push("Removed @auth0/auth0-react imports");

    // ── Add local auth imports ────────────────────────────────────
    if (!text.includes("useLocalAuth")) {
      text = `import { useLocalAuth } from '@/hooks/useLocalAuth';\n` + text;
      changes.push("Added useLocalAuth import");
    }
    if (!text.includes("localApi") && (
      text.includes("loginWithRedirect") ||
      text.includes("logout") ||
      text.includes("getAccessTokenSilently")
    )) {
      text = `import { localApi } from '@/lib/localApi';\n` + text;
      changes.push("Added localApi import");
    }

    // ── Hook: useAuth0() → useLocalAuth() ────────────────────────
    text = text.replace(/\buseAuth0\s*\(\s*\)/g, () => {
      changes.push("Rewrote useAuth0() → useLocalAuth()");
      return "useLocalAuth()";
    });

    // ── Destructuring: map Auth0 property names → local equivalents ──
    // { isAuthenticated, user, loginWithRedirect, logout, isLoading } = useLocalAuth()
    text = text.replace(
      /const\s*\{\s*([^}]+)\s*\}\s*=\s*useLocalAuth\(\)/g,
      (match, inner: string) => {
        let rewritten = inner
          // isAuthenticated → isSignedIn
          .replace(/\bisAuthenticated\b/g, "isSignedIn")
          // isLoading → isLoaded (inverted)
          .replace(/\bisLoading\b/g, "isLoaded")
          // loginWithRedirect → signIn (mapped below as function)
          .replace(/\bloginWithRedirect\b/g, "signIn")
          .replace(/\bloginWithPopup\b/g, "signIn")
          // logout → signOut
          .replace(/\blogout\b/g, "signOut")
          // getAccessTokenSilently → getToken
          .replace(/\bgetAccessTokenSilently\b/g, "getToken");
        changes.push("Rewrote useAuth0 destructuring");
        return `const { ${rewritten} } = useLocalAuth()`;
      }
    );

    // ── Standalone property references ───────────────────────────
    // isAuthenticated → isSignedIn
    if (text.includes("isAuthenticated")) {
      text = text.replace(/\bisAuthenticated\b/g, "isSignedIn");
      changes.push("Renamed isAuthenticated → isSignedIn");
    }

    // ── Method calls: loginWithRedirect/loginWithPopup → navigate ─
    text = text.replace(
      /(?:loginWithRedirect|loginWithPopup)\s*\([^)]*\)/g,
      () => {
        changes.push("Replaced loginWithRedirect/loginWithPopup with signIn");
        return `localApi.auth.signIn()`;
      }
    );

    // ── logout() → localApi.auth.signOut() ───────────────────────
    // Only top-level logout() calls (not part of destructuring already handled)
    text = text.replace(/\blogout\s*\(\s*(?:\{[^}]*\})?\s*\)/g, () => {
      changes.push("Replaced logout() with localApi.auth.signOut()");
      return "localApi.auth.signOut()";
    });

    // ── getAccessTokenSilently() → localApi.auth.getToken() ──────
    text = text.replace(
      /await\s+getAccessTokenSilently\s*\([^)]*\)/g,
      () => {
        changes.push("Replaced getAccessTokenSilently with localApi.auth.getToken()");
        return "await localApi.auth.getToken()";
      }
    );
    text = text.replace(/\bgetAccessTokenSilently\s*\([^)]*\)/g, "localApi.auth.getToken()");

    // ── Auth0Provider → remove wrapper ───────────────────────────
    text = text.replace(
      /<Auth0Provider[^>]*(?:\/?>|>)/g,
      () => {
        changes.push("Removed Auth0Provider wrapper");
        return "{/* Auth0Provider removed by WebToApp */}";
      }
    );
    text = text.replace(/<\/Auth0Provider>/g, "");

    // ── withAuthenticationRequired(Component) → Component directly ─
    // The local app handles auth at the router level via requireAuth middleware
    text = text.replace(
      /withAuthenticationRequired\s*\(\s*(\w+)\s*(?:,\s*\{[^}]*\})?\s*\)/g,
      (_match, componentName: string) => {
        changes.push(`Unwrapped withAuthenticationRequired(${componentName})`);
        warnings.push(
          `withAuthenticationRequired removed — add route-level auth guard in your router instead.`
        );
        confidence -= 0.05;
        return componentName;
      }
    );

    // ── withAuth0 HOC → remove (use hooks instead) ────────────────
    text = text.replace(
      /withAuth0\s*\(\s*(\w+)\s*\)/g,
      (_match, componentName: string) => {
        changes.push(`Removed withAuth0(${componentName})`);
        return componentName;
      }
    );

    // ── Auth0 user property mapping ───────────────────────────────
    // user.sub → user?.id  (Auth0 uses 'sub' for the user ID)
    if (text.includes("user.sub") || text.includes("user?.sub")) {
      text = text.replace(/user\?\.sub\b/g, "user?.id");
      text = text.replace(/user\.sub\b/g, "user?.id");
      changes.push("Mapped user.sub → user.id");
    }
    // user.nickname → user.name
    if (text.includes(".nickname")) {
      text = text.replace(/user\?\.nickname\b/g, "user?.name");
      text = text.replace(/user\.nickname\b/g, "user?.name");
    }
    // user.picture → null (no avatar in local auth)
    if (text.includes("user.picture") || text.includes("user?.picture")) {
      text = text.replace(/user\?\.picture\b/g, "null /* avatar not available locally */");
      text = text.replace(/user\.picture\b/g, "null /* avatar not available locally */");
      warnings.push("user.picture not available in local auth — replaced with null");
      confidence -= 0.03;
    }
    // user.email_verified → true (local users are pre-seeded as verified)
    if (text.includes("email_verified")) {
      text = text.replace(/user\?\.email_verified\b/g, "true");
      text = text.replace(/user\.email_verified\b/g, "true");
      changes.push("email_verified always true in local auth");
    }

    // ── Warn on remaining Auth0 refs ──────────────────────────────
    const remaining = (text.match(/@auth0\//g) ?? []).length;
    if (remaining > 0) {
      warnings.push(`${remaining} remaining @auth0/ reference(s) — manual review needed`);
      confidence -= remaining * 0.05;
    }

    if (changes.length > 0) sourceFile.replaceWithText(text);
    return { changes, warnings, confidence: Math.max(confidence, 0.5) };
  }
}
