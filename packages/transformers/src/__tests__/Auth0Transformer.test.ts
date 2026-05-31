import { describe, it, expect } from "vitest";
import { Auth0Transformer } from "../auth/Auth0Transformer.js";

const transformer = new Auth0Transformer();

const ctx = {
  sourcePath: "src/components/LoginButton.tsx",
  outputPath: "src/components/LoginButton.tsx",
  projectRoot: "/fake/project",
};

// ─── canTransform ──────────────────────────────────────────────────────────────

describe("Auth0Transformer.canTransform", () => {
  it("returns true for Auth0 imports", () => {
    expect(transformer.canTransform(`import { useAuth0 } from "@auth0/auth0-react";`)).toBe(true);
  });

  it("returns true for Auth0 provider", () => {
    expect(transformer.canTransform(`<Auth0Provider domain="foo" clientId="bar">`)).toBe(true);
  });

  it("returns false for unrelated content", () => {
    expect(transformer.canTransform(`const x = 1;`)).toBe(false);
  });
});

// ─── Hooks and destructuring ───────────────────────────────────────────────────

describe("Auth0Transformer — hooks and destructuring", () => {
  it("rewrites useAuth0 to useLocalAuth", async () => {
    const input = `
      import { useAuth0 } from "@auth0/auth0-react";
      const { isAuthenticated, user, loginWithRedirect, logout, isLoading } = useAuth0();
    `;
    const result = await transformer.transform(input, ctx);

    expect(result.success).toBe(true);
    expect(result.transformedContent).toContain("useLocalAuth");
    expect(result.transformedContent).not.toContain("@auth0/auth0-react");
    expect(result.transformedContent).toContain("isSignedIn");
    expect(result.transformedContent).toContain("isLoaded");
    expect(result.transformedContent).toContain("signIn");
    expect(result.transformedContent).toContain("signOut");
  });

  it("renames loginWithPopup to signIn in destructuring", async () => {
    const input = `
      import { useAuth0 } from "@auth0/auth0-react";
      const { loginWithPopup } = useAuth0();
    `;
    const result = await transformer.transform(input, ctx);
    expect(result.success).toBe(true);
    expect(result.transformedContent).toContain("signIn");
    expect(result.transformedContent).not.toContain("loginWithPopup");
  });

  it("renames getAccessTokenSilently to getToken in destructuring", async () => {
    const input = `
      import { useAuth0 } from "@auth0/auth0-react";
      const { getAccessTokenSilently } = useAuth0();
    `;
    const result = await transformer.transform(input, ctx);
    expect(result.success).toBe(true);
    expect(result.transformedContent).toContain("getToken");
    expect(result.transformedContent).not.toContain("getAccessTokenSilently");
  });
});

// ─── Methods and providers ────────────────────────────────────────────────────

describe("Auth0Transformer — methods and providers", () => {
  it("removes Auth0Provider wrapper", async () => {
    const input = `
      <Auth0Provider>
        <App />
      </Auth0Provider>
    `;
    const result = await transformer.transform(input, ctx);

    expect(result.success).toBe(true);
    expect(result.transformedContent).toContain("{/* Auth0Provider removed by WebToApp */}");
    expect(result.transformedContent).toContain("<App />");
  });

  it("replaces top-level loginWithRedirect with localApi", async () => {
    const input = `
      <button onClick={() => loginWithRedirect()}>Login</button>
    `;
    const result = await transformer.transform(input, ctx);

    expect(result.success).toBe(true);
    expect(result.transformedContent).toContain("localApi.auth.signIn()");
  });

  it("replaces top-level loginWithPopup with localApi", async () => {
    const input = `
      import { useAuth0 } from "@auth0/auth0-react";
      const handleLogin = () => loginWithPopup();
    `;
    const result = await transformer.transform(input, ctx);
    expect(result.success).toBe(true);
    expect(result.transformedContent).toContain("localApi.auth.signIn()");
    expect(result.transformedContent).not.toContain("loginWithPopup");
  });

  it("replaces top-level logout with localApi", async () => {
    const input = `
      import { useAuth0 } from "@auth0/auth0-react";
      <button onClick={() => logout()}>Logout</button>
    `;
    const result = await transformer.transform(input, ctx);

    expect(result.success).toBe(true);
    expect(result.transformedContent).toContain("localApi.auth.signOut()");
  });

  it("replaces getAccessTokenSilently", async () => {
    const input = `
      const token = await getAccessTokenSilently();
    `;
    const result = await transformer.transform(input, ctx);

    expect(result.success).toBe(true);
    expect(result.transformedContent).toContain("await localApi.auth.getToken()");
  });

  it("unwraps withAuthenticationRequired", async () => {
    const input = `
      export default withAuthenticationRequired(Profile);
    `;
    const result = await transformer.transform(input, ctx);

    expect(result.success).toBe(true);
    expect(result.transformedContent).toContain("export default Profile;");
    expect(result.warnings.length).toBeGreaterThan(0);
  });

  it("unwraps withAuthenticationRequired with options object", async () => {
    const input = `
      import { useAuth0 } from "@auth0/auth0-react";
      export default withAuthenticationRequired(Dashboard, { returnTo: '/dashboard' });
    `;
    const result = await transformer.transform(input, ctx);
    expect(result.success).toBe(true);
    expect(result.transformedContent).toContain("Dashboard");
    expect(result.transformedContent).not.toContain("withAuthenticationRequired");
    expect(result.warnings.some((w) => w.includes("route-level auth guard"))).toBe(true);
  });

  it("removes withAuth0 HOC wrapper", async () => {
    const input = `
      import { useAuth0 } from "@auth0/auth0-react";
      export default withAuth0(UserProfile);
    `;
    const result = await transformer.transform(input, ctx);
    expect(result.success).toBe(true);
    expect(result.transformedContent).toContain("UserProfile");
    expect(result.transformedContent).not.toContain("withAuth0");
  });
});

// ─── User object mapping ───────────────────────────────────────────────────────

describe("Auth0Transformer — user object mapping", () => {
  it("maps user.sub to user.id", async () => {
    const input = `import { useAuth0 } from "@auth0/auth0-react";\nconst id = user?.sub;`;
    const result = await transformer.transform(input, ctx);
    expect(result.transformedContent).toContain("user?.id");
  });

  it("maps user.nickname to user.name", async () => {
    const input = `import { useAuth0 } from "@auth0/auth0-react";\nconst name = user.nickname;`;
    const result = await transformer.transform(input, ctx);
    expect(result.transformedContent).toContain("user?.name");
  });

  it("replaces user.picture with null", async () => {
    const input = `import { useAuth0 } from "@auth0/auth0-react";\nconst pic = user?.picture;`;
    const result = await transformer.transform(input, ctx);
    expect(result.transformedContent).toContain("null /* avatar not available locally */");
  });

  it("replaces user.email_verified with true", async () => {
    const input = `import { useAuth0 } from "@auth0/auth0-react";\nconst verified = user.email_verified;`;
    const result = await transformer.transform(input, ctx);
    expect(result.transformedContent).toContain("true");
    expect(result.transformedContent).not.toContain("email_verified");
  });
});

// ─── Standalone isAuthenticated ───────────────────────────────────────────────

describe("Auth0Transformer — standalone property renames", () => {
  it("renames standalone isAuthenticated to isSignedIn", async () => {
    const input = `
      import { useAuth0 } from "@auth0/auth0-react";
      if (isAuthenticated) { doSomething(); }
    `;
    const result = await transformer.transform(input, ctx);
    expect(result.success).toBe(true);
    expect(result.transformedContent).toContain("isSignedIn");
    expect(result.transformedContent).not.toContain("isAuthenticated");
  });
});

// ─── Full component fixture ───────────────────────────────────────────────────

describe("Auth0Transformer — full component fixture", () => {
  it("transforms a complete Auth0-gated application shell", async () => {
    const input = `
      import React from 'react';
      import { Auth0Provider, useAuth0, withAuthenticationRequired } from '@auth0/auth0-react';
      import App from './App';

      function AppShell() {
        const { isAuthenticated, isLoading, user, loginWithRedirect, logout, getAccessTokenSilently } = useAuth0();

        if (isLoading) return <div>Loading...</div>;

        if (!isAuthenticated) {
          return <button onClick={() => loginWithRedirect()}>Sign In</button>;
        }

        const handleSignOut = async () => {
          await logout({ returnTo: window.location.origin });
        };

        const handleApiCall = async () => {
          const token = await getAccessTokenSilently();
          return fetch('/api/data', { headers: { Authorization: \`Bearer \${token}\` } });
        };

        return (
          <div>
            <span>{user?.nickname}</span>
            <span>{user?.sub}</span>
            <button onClick={handleSignOut}>Sign Out</button>
          </div>
        );
      }

      const ProtectedPage = withAuthenticationRequired(AppShell);

      export default function Root() {
        return (
          <Auth0Provider domain="example.auth0.com" clientId="abc123">
            <ProtectedPage />
          </Auth0Provider>
        );
      }
    `;
    const result = await transformer.transform(input, ctx);

    expect(result.success).toBe(true);
    // Imports
    expect(result.transformedContent).not.toContain("@auth0/auth0-react");
    expect(result.transformedContent).toContain("useLocalAuth");
    // Hook
    expect(result.transformedContent).not.toContain("useAuth0");
    // Destructuring renames
    expect(result.transformedContent).toContain("isSignedIn");
    expect(result.transformedContent).toContain("isLoaded");
    expect(result.transformedContent).toContain("signIn");
    // Method calls
    expect(result.transformedContent).toContain("localApi.auth.signOut()");
    expect(result.transformedContent).toContain("localApi.auth.getToken()");
    // Provider removed
    expect(result.transformedContent).toContain("Auth0Provider removed by WebToApp");
    expect(result.transformedContent).not.toContain("</Auth0Provider>");
    // HOC unwrapped
    expect(result.transformedContent).not.toContain("withAuthenticationRequired");
    // User fields
    expect(result.transformedContent).toContain("user?.name");
    expect(result.transformedContent).toContain("user?.id");
    // Warnings for withAuthenticationRequired
    expect(result.warnings.some((w) => w.includes("route-level auth guard"))).toBe(true);
  });
});
