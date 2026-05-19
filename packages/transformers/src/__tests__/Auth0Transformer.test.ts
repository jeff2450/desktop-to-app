import { describe, it, expect } from "vitest";
import { Auth0Transformer } from "../auth/Auth0Transformer.js";

const transformer = new Auth0Transformer();

const ctx = {
  sourcePath: "src/components/LoginButton.tsx",
  outputPath: "src/components/LoginButton.tsx",
  projectRoot: "/fake/project",
};

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
});

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
});

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
});
