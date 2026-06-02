import fs from "node:fs/promises";

export interface SupabaseAuthDetection {
  found: boolean;
  usesSessionHook: boolean;   // useSession / useSupabaseClient
  usesAuthStateChange: boolean;
  usesSignIn: boolean;
  usesSignUp: boolean;
  usesSignOut: boolean;
  usesOAuth: boolean;
  usesOtp: boolean;
  affectedFiles: string[];
  warnings: string[];
}

const PATTERNS = {
  sessionHook: /use(?:Session|SupabaseClient|User)\s*\(/g,
  authStateChange: /onAuthStateChange\s*\(/g,
  signIn: /signIn(?:WithPassword|WithOAuth|WithOtp|WithMagicLink)?\s*\(/g,
  signUp: /signUp\s*\(/g,
  signOut: /signOut\s*\(/g,
  oauth: /signInWithOAuth\s*\(/g,
  otp: /signInWithOtp\s*\(/g,
};

/**
 * Detects Supabase Auth-specific usage patterns (sign-in, sign-up, session hooks).
 */
export class SupabaseAuthDetector {
  async detect(
    sourceDir: string,
    allSourceFiles: string[]
  ): Promise<SupabaseAuthDetection> {
    let usesSessionHook = false;
    let usesAuthStateChange = false;
    let usesSignIn = false;
    let usesSignUp = false;
    let usesSignOut = false;
    let usesOAuth = false;
    let usesOtp = false;
    const affectedFiles: string[] = [];
    const warnings: string[] = [];

    for (const filePath of allSourceFiles) {
      let content: string;
      try {
        content = await fs.readFile(filePath, "utf-8");
      } catch {
        continue;
      }

      if (!content.includes("supabase") && !content.includes("auth")) continue;

      let fileHasAuth = false;

      if (PATTERNS.sessionHook.test(content)) { usesSessionHook = true; fileHasAuth = true; }
      if (PATTERNS.authStateChange.test(content)) { usesAuthStateChange = true; fileHasAuth = true; }
      if (PATTERNS.signIn.test(content)) { usesSignIn = true; fileHasAuth = true; }
      if (PATTERNS.signUp.test(content)) { usesSignUp = true; fileHasAuth = true; }
      if (PATTERNS.signOut.test(content)) { usesSignOut = true; fileHasAuth = true; }
      if (PATTERNS.oauth.test(content)) { usesOAuth = true; fileHasAuth = true; }
      if (PATTERNS.otp.test(content)) { usesOtp = true; fileHasAuth = true; }

      // Reset lastIndex after each test
      for (const re of Object.values(PATTERNS)) re.lastIndex = 0;

      if (fileHasAuth) affectedFiles.push(filePath);
    }

    const found = affectedFiles.length > 0;

    if (usesOAuth) {
      warnings.push(
        "OAuth (social login) detected. This will be replaced with local email/password auth. " +
          "Social login may require additional desktop OAuth configuration."
      );
    }

    if (usesOtp) {
      warnings.push(
        "Magic link / OTP auth detected. This will be replaced with local password auth."
      );
    }

    return {
      found,
      usesSessionHook,
      usesAuthStateChange,
      usesSignIn,
      usesSignUp,
      usesSignOut,
      usesOAuth,
      usesOtp,
      affectedFiles,
      warnings,
    };
  }
}
