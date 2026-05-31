import { describe, it, expect } from "vitest";
import { FirestoreTransformer } from "../firebase/FirestoreTransformer.js";

const transformer = new FirestoreTransformer();

const ctx = {
  sourcePath: "src/db.ts",
  outputPath: "src/db.ts",
  projectRoot: "/fake/project",
};

// ─── canTransform ──────────────────────────────────────────────────────────────

describe("FirestoreTransformer.canTransform", () => {
  it("returns true for Firestore references", () => {
    expect(transformer.canTransform(`import { getFirestore } from "firebase/firestore";`)).toBe(true);
    expect(transformer.canTransform(`await getDoc(doc(db, 'users', id));`)).toBe(true);
  });

  it("returns false for unrelated content", () => {
    expect(transformer.canTransform(`const x = 1;`)).toBe(false);
  });
});

// ─── Document operations ───────────────────────────────────────────────────────

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

  it("rewrites getDoc with multi-line formatting (formatting resilience)", async () => {
    const input = `
      const snap = await getDoc(
        doc(
          db,
          'users',
          userId
        )
      );
    `;
    const result = await transformer.transform(input, ctx);
    expect(result.success).toBe(true);
    expect(result.transformedContent).toContain("localApi.from('users').eq('id', userId).single()");
  });

  it("rewrites getDoc with aliased db variable (variable-name independence)", async () => {
    const input = `const snap = await getDoc(doc(firestore, 'orders', orderId));`;
    const result = await transformer.transform(input, ctx);
    expect(result.success).toBe(true);
    // The aliased variable name 'firestore' should not prevent the rewrite
    expect(result.transformedContent).toContain("localApi.from('orders').eq('id', orderId).single()");
  });
});

// ─── Collections and queries ───────────────────────────────────────────────────

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

  it("rewrites getDocs with query, where + limit compound constraints", async () => {
    const input = `
      const snaps = await getDocs(
        query(
          collection(db, 'posts'),
          where('status', '==', 'published'),
          limit(10)
        )
      );
    `;
    const result = await transformer.transform(input, ctx);
    expect(result.success).toBe(true);
    expect(result.transformedContent).toContain("localApi.from('posts')");
    expect(result.transformedContent).toContain(".eq('status', 'published')");
    expect(result.transformedContent).toContain(".limit(10)");
    expect(result.transformedContent).toContain(".select()");
  });

  it("rewrites getDocs with query, where + orderBy compound constraints", async () => {
    const input = `
      const snaps = await getDocs(
        query(
          collection(db, 'articles'),
          where('published', '==', true),
          orderBy('createdAt', 'desc')
        )
      );
    `;
    const result = await transformer.transform(input, ctx);
    expect(result.success).toBe(true);
    expect(result.transformedContent).toContain("localApi.from('articles')");
    expect(result.transformedContent).toContain(".eq('published', true)");
    expect(result.transformedContent).toContain(".order('createdAt', 'desc')");
    expect(result.transformedContent).toContain(".select()");
  });
});

// ─── Data extraction ───────────────────────────────────────────────────────────

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

// ─── Realtime ──────────────────────────────────────────────────────────────────

describe("FirestoreTransformer — realtime", () => {
  it("rewrites onSnapshot with collection ref", async () => {
    const input = `onSnapshot(collection(db, 'users'), handleUpdate);`;
    const result = await transformer.transform(input, ctx);
    expect(result.transformedContent).toContain("localApi.subscribe('users', handleUpdate)");
  });

  it("rewrites onSnapshot with doc ref", async () => {
    const input = `onSnapshot(doc(db, 'users', userId), handleUpdate);`;
    const result = await transformer.transform(input, ctx);
    expect(result.success).toBe(true);
    expect(result.transformedContent).toContain("localApi.subscribe('users', handleUpdate)");
  });
});

// ─── Imports and setup ────────────────────────────────────────────────────────

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
    expect(result.transformedContent).not.toContain("firebase/firestore");
    expect(result.transformedContent).not.toContain("firebase/app");
  });

  it("removes firebase/auth import alongside firestore", async () => {
    const input = `
      import { getAuth } from "firebase/auth";
      import { getFirestore, collection } from "firebase/firestore";
      const db = getFirestore();
      await getDocs(collection(db, 'items'));
    `;
    const result = await transformer.transform(input, ctx);
    expect(result.transformedContent).not.toContain("firebase/auth");
    expect(result.transformedContent).not.toContain("firebase/firestore");
    expect(result.transformedContent).toContain("localApi");
  });

  it("handles a full realistic component fixture", async () => {
    const input = `
      import { initializeApp } from 'firebase/app';
      import {
        getFirestore,
        collection,
        doc,
        getDoc,
        getDocs,
        addDoc,
        updateDoc,
        deleteDoc,
        query,
        where,
      } from 'firebase/firestore';

      const app = initializeApp({ projectId: 'demo' });
      const db = getFirestore(app);

      export async function getUser(id: string) {
        const snap = await getDoc(doc(db, 'users', id));
        return snap.data();
      }

      export async function listActiveUsers() {
        const snaps = await getDocs(
          query(collection(db, 'users'), where('active', '==', true))
        );
        return snaps.docs.map(d => d.data());
      }

      export async function createUser(data: object) {
        return await addDoc(collection(db, 'users'), data);
      }

      export async function updateUser(id: string, data: object) {
        await updateDoc(doc(db, 'users', id), data);
      }

      export async function deleteUser(id: string) {
        await deleteDoc(doc(db, 'users', id));
      }
    `;
    const result = await transformer.transform(input, ctx);
    expect(result.success).toBe(true);
    // Firebase imports gone
    expect(result.transformedContent).not.toContain("firebase/firestore");
    expect(result.transformedContent).not.toContain("firebase/app");
    expect(result.transformedContent).not.toContain("initializeApp");
    expect(result.transformedContent).not.toContain("getFirestore");
    // localApi present
    expect(result.transformedContent).toContain("import { localApi }");
    // Operations rewritten
    expect(result.transformedContent).toContain("localApi.from('users').eq('id', id).single()");
    expect(result.transformedContent).toContain("localApi.from('users').eq('active', true).select()");
    expect(result.transformedContent).toContain("localApi.from('users').insert(data)");
    expect(result.transformedContent).toContain("localApi.from('users').eq('id', id).update(data)");
    expect(result.transformedContent).toContain("localApi.from('users').eq('id', id).delete()");
    // Snapshot accessor patterns
    expect(result.transformedContent).toContain(".data.map(");
  });
});
