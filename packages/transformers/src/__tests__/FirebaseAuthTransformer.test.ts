import { describe, it, expect } from "vitest";
import { FirebaseAuthTransformer } from "../firebase/FirebaseAuthTransformer.js";

const transformer = new FirebaseAuthTransformer();

const ctx = {
  sourcePath: "src/auth.ts",
  outputPath: "src/auth.ts",
  projectRoot: "/fake/project",
};

describe("FirebaseAuthTransformer.canTransform", () => {
  it("returns true for Firebase Auth imports", () => {
    expect(transformer.canTransform(`import { getAuth } from "firebase/auth";`)).toBe(true);
  });

  it("returns true for signInWithEmailAndPassword", () => {
    expect(transformer.canTransform(`await signInWithEmailAndPassword(auth, email, password);`)).toBe(true);
  });

  it("returns false for unrelated content", () => {
    expect(transformer.canTransform(`const x = 1;`)).toBe(false);
  });
});

describe("FirebaseAuthTransformer — methods", () => {
  it("rewrites signInWithEmailAndPassword", async () => {
    const input = `
      import { signInWithEmailAndPassword } from "firebase/auth";
      const user = await signInWithEmailAndPassword(auth, email, password);
    `;
    const result = await transformer.transform(input, ctx);

    expect(result.success).toBe(true);
    expect(result.transformedContent).toContain("await localApi.auth.signInWithPassword({ email: email, password: password })");
    expect(result.transformedContent).not.toContain("firebase/auth");
  });

  it("rewrites createUserWithEmailAndPassword", async () => {
    const input = `
      await createUserWithEmailAndPassword(auth, userEmail, userPass);
    `;
    const result = await transformer.transform(input, ctx);

    expect(result.success).toBe(true);
    expect(result.transformedContent).toContain("await localApi.auth.signUp({ email: userEmail, password: userPass })");
  });

  it("rewrites signOut", async () => {
    const input = `
      import { getAuth } from "firebase/auth";
      await signOut(auth);
    `;
    const result = await transformer.transform(input, ctx);

    expect(result.success).toBe(true);
    expect(result.transformedContent).toContain("await localApi.auth.signOut()");
  });

  it("rewrites onAuthStateChanged", async () => {
    const input = `
      onAuthStateChanged(auth, (user) => {
        console.log(user);
      });
    `;
    const result = await transformer.transform(input, ctx);

    expect(result.success).toBe(true);
    expect(result.transformedContent).toContain("localApi.auth.onAuthStateChange((user) => {");
  });

  it("removes auth initialization", async () => {
    const input = `
      import { getAuth } from "firebase/auth";
      const auth = getAuth(app);
    `;
    const result = await transformer.transform(input, ctx);

    expect(result.success).toBe(true);
    expect(result.transformedContent).not.toContain("getAuth(app)");
  });

  it("warns about currentUser", async () => {
    const input = `
      import { getAuth } from "firebase/auth";
      const u = auth.currentUser;
    `;
    const result = await transformer.transform(input, ctx);

    expect(result.success).toBe(true);
    expect(result.warnings.length).toBeGreaterThan(0);
    expect(result.warnings[0]).toContain("currentUser references detected");
  });
});
