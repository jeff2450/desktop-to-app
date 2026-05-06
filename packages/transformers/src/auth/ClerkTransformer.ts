import type { SourceFile } from "ts-morph";
import { BaseTransformer, type TransformContext, type TransformResult } from "../base/BaseTransformer.js";

/**
 * Rewrites Clerk auth hooks and components to use the local JWT auth session.
 *
 * Clerk → localApi mapping:
 *   useUser()              → useLocalUser() (generated hook)
 *   useAuth()              → useLocalAuth() (generated hook)
 *   useClerk()             → removed / stubbed
 *   <SignedIn>             → conditional render on session
 *   <SignedOut>            → conditional render on !session
 *   <UserButton />         → <LocalUserButton /> (generated component)
 *   <SignIn />             → redirect to /auth/login
 *   <SignUp />             → redirect to /auth/login
 *   ClerkProvider          → removed (wraps with LocalAuthProvider instead)
 */
export class ClerkTransformer extends BaseTransformer {
  canTransform(content: string): boolean {
    return (
      content.includes("@clerk/") ||
      content.includes("useUser()") ||
      content.includes("useAuth()") ||
      content.includes("ClerkProvider") ||
      content.includes("<SignedIn") ||
      content.includes("<SignedOut")
    );
  }

  protected async transformSourceFile(
    sourceFile: SourceFile,
    _ctx: TransformContext
  ): Promise<Pick<TransformResult, "changes" | "warnings" | "confidence">> {
    const changes: string[] = [];
    const warnings: string[] = [];
    let confidence = 0.82;
    let text = sourceFile.getFullText();

    // ── Remove Clerk imports ───────────────────────────────────────
    text = text.replace(
      /import\s*\{[^}]+\}\s*from\s*['"]@clerk\/(?:clerk-react|nextjs|clerk-sdk-node)['"];?\n?/g,
      ""
    );
    changes.push("Removed Clerk imports");

    // ── Add local auth imports ─────────────────────────────────────
    if (!text.includes("useLocalUser") && (text.includes("useUser") || text.includes("useAuth"))) {
      text = `import { useLocalUser, useLocalAuth } from '@/hooks/useLocalAuth';\n` + text;
      changes.push("Added useLocalUser / useLocalAuth imports");
    }
    if (!text.includes("localApi") && text.includes("signOut")) {
      text = `import { localApi } from '@/lib/localApi';\n` + text;
    }

    // ── Hook rewrites ──────────────────────────────────────────────
    // useUser() → useLocalUser()
    text = text.replace(/\buseUser\s*\(\s*\)/g, () => {
      changes.push("Rewrote useUser() → useLocalUser()");
      return "useLocalUser()";
    });

    // useAuth() → useLocalAuth()
    text = text.replace(/\buseAuth\s*\(\s*\)/g, () => {
      changes.push("Rewrote useAuth() → useLocalAuth()");
      return "useLocalAuth()";
    });

    // useClerk() → stubbed
    text = text.replace(/\buseClerk\s*\(\s*\)/g, () => {
      changes.push("Stubbed useClerk()");
      return "{ signOut: () => localApi.auth.signOut() }";
    });

    // ── Destructuring patterns ─────────────────────────────────────
    // const { user } = useUser() → already handled
    // const { isLoaded, isSignedIn, user } = useUser()
    text = text.replace(
      /const\s*\{\s*isLoaded\s*,\s*isSignedIn\s*,\s*user\s*\}\s*=\s*useLocalUser\(\)/g,
      () => {
        changes.push("Rewrote isLoaded/isSignedIn destructuring");
        return "const { isLoaded, isSignedIn, user } = useLocalUser()";
      }
    );

    // const { userId, sessionId, getToken } = useAuth()
    text = text.replace(
      /const\s*\{\s*(?:userId|sessionId|getToken)[^}]*\}\s*=\s*useLocalAuth\(\)/g,
      () => {
        changes.push("Rewrote useAuth destructuring");
        return "const { userId, isSignedIn, getToken } = useLocalAuth()";
      }
    );

    // ── JSX component rewrites ─────────────────────────────────────
    // <ClerkProvider ...> → <> (just remove wrapper)
    text = text.replace(/<ClerkProvider[^>]*>/g, () => {
      changes.push("Removed ClerkProvider wrapper");
      return "{/* ClerkProvider removed by WebToApp */}";
    });
    text = text.replace(/<\/ClerkProvider>/g, "");

    // <SignedIn> → {isSignedIn && (
    text = text.replace(/<SignedIn>/g, () => {
      changes.push("Rewrote <SignedIn> → conditional");
      return "{isSignedIn && (";
    });
    text = text.replace(/<\/SignedIn>/g, ")}");

    // <SignedOut> → {!isSignedIn && (
    text = text.replace(/<SignedOut>/g, () => {
      changes.push("Rewrote <SignedOut> → conditional");
      return "{!isSignedIn && (";
    });
    text = text.replace(/<\/SignedOut>/g, ")}");

    // <UserButton /> → simple sign-out button
    text = text.replace(
      /<UserButton\s*(?:afterSignOutUrl="[^"]*")?\s*\/>/g,
      () => {
        changes.push("Replaced <UserButton /> with local sign-out button");
        return `<button onClick={() => localApi.auth.signOut()} className="text-sm text-gray-400 hover:text-white">Sign out</button>`;
      }
    );

    // <SignIn /> and <SignUp /> → redirect
    text = text.replace(
      /<SignIn\s*[^/]*\/>/g,
      `<a href="/auth/login" className="text-indigo-400">Sign in</a>`
    );
    text = text.replace(
      /<SignUp\s*[^/]*\/>/g,
      `<a href="/auth/login" className="text-indigo-400">Sign up</a>`
    );

    // ── Clerk property name mapping ────────────────────────────────
    // user.firstName → user.name?.split(' ')[0]
    if (text.includes(".firstName")) {
      text = text.replace(/user\.firstName/g, "user?.name?.split(' ')[0]");
      warnings.push("user.firstName mapped to user.name.split()[0] — verify UI output");
      confidence -= 0.05;
    }
    if (text.includes(".lastName")) {
      text = text.replace(/user\.lastName/g, "user?.name?.split(' ').slice(1).join(' ')");
    }
    if (text.includes(".imageUrl")) {
      text = text.replace(/user\.imageUrl/g, "null /* avatar not available locally */");
      warnings.push("user.imageUrl not available in local auth — removed");
    }
    if (text.includes(".emailAddresses")) {
      text = text.replace(/user\.emailAddresses\[0\]\.emailAddress/g, "user?.email");
      text = text.replace(/user\.emailAddresses/g, "[{ emailAddress: user?.email }]");
    }

    // ── Warn on remaining Clerk refs ───────────────────────────────
    const remaining = (text.match(/@clerk\//g) ?? []).length;
    if (remaining > 0) {
      warnings.push(`${remaining} remaining @clerk/ reference(s) — manual review needed`);
      confidence -= remaining * 0.05;
    }

    if (changes.length > 0) sourceFile.replaceWithText(text);
    return { changes, warnings, confidence: Math.max(confidence, 0.5) };
  }
}
