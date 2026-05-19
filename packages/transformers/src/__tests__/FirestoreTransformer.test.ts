import { describe, it, expect } from "vitest";
import { FirestoreTransformer } from "../firebase/FirestoreTransformer.js";

const transformer = new FirestoreTransformer();

const ctx = {
  sourcePath: "src/db.ts",
  outputPath: "src/db.ts",
  projectRoot: "/fake/project",
};

describe("FirestoreTransformer.canTransform", () => {
  it("returns true for Firestore references", () => {
    expect(transformer.canTransform(`import { getFirestore } from "firebase/firestore";`)).toBe(true);
    expect(transformer.canTransform(`await getDoc(doc(db, 'users', id));`)).toBe(true);
  });

  it("returns false for unrelated content", () => {
    expect(transformer.canTransform(`const x = 1;`)).toBe(false);
  });
});

describe("FirestoreTransformer — document operations", () => {
  it("rewrites getDoc", async () => {
    const input = `const snap = await getDoc(doc(db, 'users', id));`;
    const result = await transformer.transform(input, ctx);
    expect(result.success).toBe(true);
    expect(result.transformedContent).toContain("await localApi.from('users').eq('id', id).single()");
  });

  it("rewrites setDoc", async () => {
    const input = `await setDoc(doc(db, 'posts', postId), data);`;
    const result = await transformer.transform(input, ctx);
    expect(result.success).toBe(true);
    expect(result.transformedContent).toContain("await localApi.from('posts').upsert({ id: postId, ...data })");
  });

  it("rewrites updateDoc", async () => {
    const input = `await updateDoc(doc(db, 'posts', postId), { title: 'New' });`;
    const result = await transformer.transform(input, ctx);
    expect(result.success).toBe(true);
    expect(result.transformedContent).toContain("await localApi.from('posts').eq('id', postId).update({ title: 'New' })");
  });

  it("rewrites deleteDoc", async () => {
    const input = `await deleteDoc(doc(db, 'posts', postId));`;
    const result = await transformer.transform(input, ctx);
    expect(result.success).toBe(true);
    expect(result.transformedContent).toContain("await localApi.from('posts').eq('id', postId).delete()");
  });
});

describe("FirestoreTransformer — collections and queries", () => {
  it("rewrites getDocs for a collection", async () => {
    const input = `const snaps = await getDocs(collection(db, 'users'));`;
    const result = await transformer.transform(input, ctx);
    expect(result.success).toBe(true);
    expect(result.transformedContent).toContain("await localApi.from('users').select()");
  });

  it("rewrites getDocs with query and where", async () => {
    const input = `const snaps = await getDocs(query(collection(db, 'users'), where('status', '==', 'active')));`;
    const result = await transformer.transform(input, ctx);
    expect(result.success).toBe(true);
    expect(result.transformedContent).toContain("await localApi.from('users').eq('status', 'active').select()");
  });

  it("rewrites addDoc", async () => {
    const input = `await addDoc(collection(db, 'users'), userData);`;
    const result = await transformer.transform(input, ctx);
    expect(result.success).toBe(true);
    expect(result.transformedContent).toContain("await localApi.from('users').insert(userData)");
  });
});

describe("FirestoreTransformer — data extraction", () => {
  it("rewrites snap.data()", async () => {
    const input = `const snap = await getDoc(doc(db, 'users', id));\nconst data = snap.data();`;
    const result = await transformer.transform(input, ctx);
    expect(result.transformedContent).toContain("snap.data;");
  });

  it("rewrites snap.docs.map", async () => {
    const input = `const snaps = await getDocs(collection(db, 'users'));\nconst users = snaps.docs.map(doc => doc.data());`;
    const result = await transformer.transform(input, ctx);
    expect(result.transformedContent).toContain("snaps.data.map(");
  });
});

describe("FirestoreTransformer — realtime", () => {
  it("rewrites onSnapshot", async () => {
    const input = `onSnapshot(collection(db, 'users'), handleUpdate);`;
    const result = await transformer.transform(input, ctx);
    expect(result.transformedContent).toContain("localApi.subscribe('users', handleUpdate)");
  });
});

describe("FirestoreTransformer — imports and setup", () => {
  it("removes initialization and adds localApi", async () => {
    const input = `
      import { getFirestore } from "firebase/firestore";
      import { initializeApp } from "firebase/app";
      const app = initializeApp(config);
      const db = getFirestore(app);
      await getDoc(doc(db, 'users', id));
    `;
    const result = await transformer.transform(input, ctx);
    expect(result.transformedContent).toContain("import { localApi }");
    expect(result.transformedContent).not.toContain("getFirestore");
    expect(result.transformedContent).not.toContain("initializeApp");
  });
});
