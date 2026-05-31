import { describe, it, expect, beforeEach } from "vitest";
import path from "node:path";
import os from "node:os";
import fs from "fs-extra";
import { writeCapacitorConfig, patchPackageJsonForMobile } from "../capacitor-config.js";
import type { MobileConfig } from "../types.js";

// ─── Fixtures ─────────────────────────────────────────────────────────────────

const MINIMAL_CONFIG: MobileConfig = {
  appId: "com.example.myapp",
  appName: "My App",
};

const FULL_CONFIG: MobileConfig = {
  appId: "com.example.fullapp",
  appName: "Full App",
  webDir: "build",
  android: {
    minSdkVersion: 24,
    targetSdkVersion: 35,
    buildVariant: "debug",
  },
  ios: {
    deploymentTarget: "14.0",
  },
};

const RELEASE_CONFIG: MobileConfig = {
  appId: "com.example.release",
  appName: "Release App",
  android: {
    buildVariant: "release",
    artifactType: "aab",
    keystorePath: "release.jks",
    keystoreAlias: "upload",
    keystorePassword: "supersecret",
  },
};

// ─── Helpers ──────────────────────────────────────────────────────────────────

async function createTempProject(extraFiles: Record<string, string | object> = {}): Promise<string> {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), "webtoapp-mobile-test-"));

  // Minimal package.json required by patchPackageJsonForMobile
  await fs.writeJson(path.join(dir, "package.json"), {
    name: "my-test-app",
    version: "1.0.0",
    scripts: {},
    dependencies: {},
    devDependencies: {},
  });

  for (const [name, content] of Object.entries(extraFiles)) {
    const filePath = path.join(dir, name);
    await fs.ensureDir(path.dirname(filePath));
    if (typeof content === "string") {
      await fs.writeFile(filePath, content, "utf8");
    } else {
      await fs.writeJson(filePath, content);
    }
  }

  return dir;
}

// ─── writeCapacitorConfig ─────────────────────────────────────────────────────

describe("writeCapacitorConfig", () => {
  let tempDir: string;

  beforeEach(async () => {
    tempDir = await createTempProject();
  });

  it("creates capacitor.config.ts when it doesn't exist", async () => {
    await writeCapacitorConfig(tempDir, MINIMAL_CONFIG);
    const configPath = path.join(tempDir, "capacitor.config.ts");
    expect(await fs.pathExists(configPath)).toBe(true);
  });

  it("includes appId in the generated config", async () => {
    await writeCapacitorConfig(tempDir, MINIMAL_CONFIG);
    const content = await fs.readFile(path.join(tempDir, "capacitor.config.ts"), "utf8");
    expect(content).toContain("com.example.myapp");
  });

  it("includes appName in the generated config", async () => {
    await writeCapacitorConfig(tempDir, MINIMAL_CONFIG);
    const content = await fs.readFile(path.join(tempDir, "capacitor.config.ts"), "utf8");
    expect(content).toContain("My App");
  });

  it("uses 'dist' as default webDir", async () => {
    await writeCapacitorConfig(tempDir, MINIMAL_CONFIG);
    const content = await fs.readFile(path.join(tempDir, "capacitor.config.ts"), "utf8");
    expect(content).toContain("dist");
  });

  it("uses the custom webDir from config", async () => {
    await writeCapacitorConfig(tempDir, FULL_CONFIG);
    const content = await fs.readFile(path.join(tempDir, "capacitor.config.ts"), "utf8");
    expect(content).toContain("build");
  });

  it("includes androidScheme: 'https' for security", async () => {
    await writeCapacitorConfig(tempDir, MINIMAL_CONFIG);
    const content = await fs.readFile(path.join(tempDir, "capacitor.config.ts"), "utf8");
    expect(content).toContain("androidScheme");
    expect(content).toContain("https");
  });

  it("includes SplashScreen plugin configuration", async () => {
    await writeCapacitorConfig(tempDir, MINIMAL_CONFIG);
    const content = await fs.readFile(path.join(tempDir, "capacitor.config.ts"), "utf8");
    expect(content).toContain("SplashScreen");
  });

  it("includes release signing config when keystorePath is set", async () => {
    await writeCapacitorConfig(tempDir, RELEASE_CONFIG);
    const content = await fs.readFile(path.join(tempDir, "capacitor.config.ts"), "utf8");
    expect(content).toContain("release.jks");
    expect(content).toContain("AAB");
  });

  it("is idempotent — calling twice patches, not duplicates", async () => {
    await writeCapacitorConfig(tempDir, MINIMAL_CONFIG);
    await writeCapacitorConfig(tempDir, MINIMAL_CONFIG);
    const content = await fs.readFile(path.join(tempDir, "capacitor.config.ts"), "utf8");

    // appId should appear exactly once
    const matches = content.match(/com\.example\.myapp/g) ?? [];
    expect(matches.length).toBe(1);
  });

  it("patches an existing config file with updated appId", async () => {
    // Write an existing config with a different appId
    const existing = `import type { CapacitorConfig } from '@capacitor/cli';
const config: CapacitorConfig = {
  appId: 'com.old.id',
  appName: 'Old Name',
  webDir: 'dist',
};
export default config;
`;
    await fs.writeFile(path.join(tempDir, "capacitor.config.ts"), existing, "utf8");

    await writeCapacitorConfig(tempDir, MINIMAL_CONFIG);
    const content = await fs.readFile(path.join(tempDir, "capacitor.config.ts"), "utf8");

    expect(content).toContain("com.example.myapp");
    expect(content).not.toContain("com.old.id");
  });

  it("generates valid TypeScript (no unbalanced braces)", async () => {
    await writeCapacitorConfig(tempDir, FULL_CONFIG);
    const content = await fs.readFile(path.join(tempDir, "capacitor.config.ts"), "utf8");

    const opens = (content.match(/\{/g) ?? []).length;
    const closes = (content.match(/\}/g) ?? []).length;
    expect(opens).toBe(closes);
  });
});

// ─── patchPackageJsonForMobile ────────────────────────────────────────────────

describe("patchPackageJsonForMobile", () => {
  let tempDir: string;

  beforeEach(async () => {
    tempDir = await createTempProject();
  });

  it("adds @capacitor/core to dependencies", async () => {
    await patchPackageJsonForMobile(tempDir);
    const pkg = await fs.readJson(path.join(tempDir, "package.json"));
    expect(pkg.dependencies["@capacitor/core"]).toBeDefined();
  });

  it("adds @capacitor/cli to devDependencies", async () => {
    await patchPackageJsonForMobile(tempDir);
    const pkg = await fs.readJson(path.join(tempDir, "package.json"));
    expect(pkg.devDependencies["@capacitor/cli"]).toBeDefined();
  });

  it("adds @capacitor/android and @capacitor/ios to devDependencies", async () => {
    await patchPackageJsonForMobile(tempDir);
    const pkg = await fs.readJson(path.join(tempDir, "package.json"));
    expect(pkg.devDependencies["@capacitor/android"]).toBeDefined();
    expect(pkg.devDependencies["@capacitor/ios"]).toBeDefined();
  });

  it("adds mobile:sync script", async () => {
    await patchPackageJsonForMobile(tempDir);
    const pkg = await fs.readJson(path.join(tempDir, "package.json"));
    expect(pkg.scripts["mobile:sync"]).toBe("npx cap sync");
  });

  it("adds mobile:build:android script", async () => {
    await patchPackageJsonForMobile(tempDir);
    const pkg = await fs.readJson(path.join(tempDir, "package.json"));
    expect(pkg.scripts["mobile:build:android"]).toContain("assembleDebug");
  });

  it("adds mobile:build:android:release script", async () => {
    await patchPackageJsonForMobile(tempDir);
    const pkg = await fs.readJson(path.join(tempDir, "package.json"));
    expect(pkg.scripts["mobile:build:android:release"]).toContain("AAB");
  });

  it("adds mobile:build:ios script", async () => {
    await patchPackageJsonForMobile(tempDir);
    const pkg = await fs.readJson(path.join(tempDir, "package.json"));
    expect(pkg.scripts["mobile:build:ios"]).toContain("xcodebuild");
  });

  it("is idempotent — calling twice does not duplicate dependencies", async () => {
    await patchPackageJsonForMobile(tempDir);
    await patchPackageJsonForMobile(tempDir);
    const pkg = await fs.readJson(path.join(tempDir, "package.json"));

    // @capacitor/core should appear only once (in dependencies OR devDependencies)
    const inDeps = "@capacitor/core" in (pkg.dependencies ?? {});
    const inDevDeps = "@capacitor/core" in (pkg.devDependencies ?? {});
    // It should be in exactly one place
    expect(Number(inDeps) + Number(inDevDeps)).toBe(1);
  });

  it("does not overwrite existing scripts", async () => {
    // Pre-set a custom mobile:sync script
    const pkgPath = path.join(tempDir, "package.json");
    const existing = await fs.readJson(pkgPath);
    existing.scripts["mobile:sync"] = "my-custom-sync";
    await fs.writeJson(pkgPath, existing);

    await patchPackageJsonForMobile(tempDir);
    const pkg = await fs.readJson(pkgPath);
    expect(pkg.scripts["mobile:sync"]).toBe("my-custom-sync");
  });

  it("preserves existing scripts unrelated to mobile", async () => {
    const pkgPath = path.join(tempDir, "package.json");
    const existing = await fs.readJson(pkgPath);
    existing.scripts["build"] = "vite build";
    existing.scripts["dev"] = "vite";
    await fs.writeJson(pkgPath, existing);

    await patchPackageJsonForMobile(tempDir);
    const pkg = await fs.readJson(pkgPath);
    expect(pkg.scripts["build"]).toBe("vite build");
    expect(pkg.scripts["dev"]).toBe("vite");
  });

  it("preserves existing non-Capacitor dependencies", async () => {
    const pkgPath = path.join(tempDir, "package.json");
    const existing = await fs.readJson(pkgPath);
    existing.dependencies["react"] = "^18.0.0";
    await fs.writeJson(pkgPath, existing);

    await patchPackageJsonForMobile(tempDir);
    const pkg = await fs.readJson(pkgPath);
    expect(pkg.dependencies["react"]).toBe("^18.0.0");
  });
});
