import path from "node:path";
import fs from "node:fs/promises";

export interface FirebaseDetectionResult {
  isFirebase: boolean;
  usesFirestore: boolean;
  usesAuth: boolean;
  usesStorage: boolean;
  usesRealtime: boolean;
  usesHosting: boolean;
  projectId?: string;
  confidence: number;
}

export class FirebaseDetector {
  constructor(private readonly projectRoot: string) {}

  async detect(): Promise<FirebaseDetectionResult> {
    const pkg = await this.readDeps();
    const allDeps = { ...pkg.dependencies, ...pkg.devDependencies };
    const hasFirebase = "firebase" in allDeps || "@firebase/app" in allDeps;

    if (!hasFirebase) {
      return { isFirebase: false, usesFirestore: false, usesAuth: false, usesStorage: false, usesRealtime: false, usesHosting: false, confidence: 0 };
    }

    const sourceFiles = await this.scanFiles();
    const content = sourceFiles.join("\n");

    const usesFirestore = content.includes("getFirestore") || content.includes("collection(") || content.includes("getDocs(");
    const usesAuth = content.includes("getAuth") || content.includes("signInWithEmailAndPassword");
    const usesStorage = content.includes("getStorage") || content.includes("uploadBytes");
    const usesRealtime = content.includes("getDatabase") || content.includes("onValue(");
    const usesHosting = await this.fileExists(path.join(this.projectRoot, "firebase.json"));

    const projectId = await this.extractProjectId();

    const confidence = 0.9;

    return { isFirebase: true, usesFirestore, usesAuth, usesStorage, usesRealtime, usesHosting, projectId, confidence };
  }

  private async scanFiles(): Promise<string[]> {
    const contents: string[] = [];
    const srcDir = path.join(this.projectRoot, "src");

    async function walk(dir: string): Promise<void> {
      const entries = await fs.readdir(dir, { withFileTypes: true }).catch(() => []);
      for (const e of entries) {
        const full = path.join(dir, e.name);
        if (e.isDirectory() && !["node_modules", "dist", ".next"].includes(e.name)) {
          await walk(full);
        } else if (/\.(ts|tsx|js|jsx)$/.test(e.name)) {
          const c = await fs.readFile(full, "utf-8").catch(() => "");
          contents.push(c);
        }
      }
    }

    await walk(await this.fileExists(srcDir) ? srcDir : this.projectRoot);
    return contents;
  }

  private async extractProjectId(): Promise<string | undefined> {
    const firebaseJson = path.join(this.projectRoot, ".firebaserc");
    try {
      const raw = await fs.readFile(firebaseJson, "utf-8");
      const rc = JSON.parse(raw) as { projects?: { default?: string } };
      return rc.projects?.default;
    } catch { return undefined; }
  }

  private async readDeps(): Promise<{ dependencies?: Record<string, string>; devDependencies?: Record<string, string> }> {
    try {
      const raw = await fs.readFile(path.join(this.projectRoot, "package.json"), "utf-8");
      return JSON.parse(raw) as { dependencies?: Record<string, string>; devDependencies?: Record<string, string> };
    } catch { return {}; }
  }

  private async fileExists(p: string): Promise<boolean> {
    return fs.access(p).then(() => true).catch(() => false);
  }
}
