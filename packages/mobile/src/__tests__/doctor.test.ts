import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { checkAndroid, checkIos } from "../doctor.js";

// ─── Android doctor ───────────────────────────────────────────────────────────

describe("checkAndroid", () => {
  const savedEnv: Record<string, string | undefined> = {};
  const WATCHED_KEYS = ["ANDROID_HOME", "ANDROID_SDK_ROOT", "JAVA_HOME", "JDK_HOME", "LOCALAPPDATA"];

  beforeEach(() => {
    for (const key of WATCHED_KEYS) {
      savedEnv[key] = process.env[key];
    }
  });

  afterEach(() => {
    for (const key of WATCHED_KEYS) {
      if (savedEnv[key] === undefined) {
        delete process.env[key];
      } else {
        process.env[key] = savedEnv[key];
      }
    }
  });

  it("returns a DoctorResult with correct shape", () => {
    const result = checkAndroid();
    expect(result).toHaveProperty("platform", "android");
    expect(result).toHaveProperty("ready");
    expect(result).toHaveProperty("checks");
    expect(Array.isArray(result.checks)).toBe(true);
  });

  it("every check has name, passed, message, required fields", () => {
    const result = checkAndroid();
    for (const check of result.checks) {
      expect(typeof check.name).toBe("string");
      expect(typeof check.passed).toBe("boolean");
      expect(typeof check.message).toBe("string");
      expect(typeof check.required).toBe("boolean");
    }
  });

  it("includes a Java JDK check (required)", () => {
    const result = checkAndroid();
    const javaCheck = result.checks.find((c) => c.name === "Java JDK");
    expect(javaCheck).toBeDefined();
    expect(javaCheck!.required).toBe(true);
  });

  it("includes a Node.js check (required)", () => {
    const result = checkAndroid();
    const nodeCheck = result.checks.find((c) => c.name === "Node.js");
    expect(nodeCheck).toBeDefined();
    expect(nodeCheck!.required).toBe(true);
  });

  it("includes an ANDROID_HOME / ANDROID_SDK_ROOT check (required)", () => {
    const result = checkAndroid();
    const sdkCheck = result.checks.find(
      (c) => c.name === "ANDROID_HOME / ANDROID_SDK_ROOT"
    );
    expect(sdkCheck).toBeDefined();
    expect(sdkCheck!.required).toBe(true);
  });

  it("marks Gradle check as optional (required: false)", () => {
    const result = checkAndroid();
    const gradleCheck = result.checks.find((c) => c.name === "Gradle");
    expect(gradleCheck).toBeDefined();
    expect(gradleCheck!.required).toBe(false);
  });

  it("ANDROID_HOME check fails and ready:false when SDK env is absent", () => {
    delete process.env["ANDROID_HOME"];
    delete process.env["ANDROID_SDK_ROOT"];
    delete process.env["LOCALAPPDATA"]; // prevent Windows-specific local SDK discovery

    const result = checkAndroid();
    const sdkCheck = result.checks.find(
      (c) => c.name === "ANDROID_HOME / ANDROID_SDK_ROOT"
    );

    expect(sdkCheck).toBeDefined();
    expect(sdkCheck!.passed).toBe(false);
    expect(result.ready).toBe(false);
  });

  it("ready reflects whether all required checks pass", () => {
    const result = checkAndroid();
    const allRequiredPass = result.checks
      .filter((c) => c.required)
      .every((c) => c.passed);
    expect(result.ready).toBe(allRequiredPass);
  });

  it("failed checks always have a non-empty message", () => {
    delete process.env["ANDROID_HOME"];
    delete process.env["ANDROID_SDK_ROOT"];
    delete process.env["LOCALAPPDATA"];

    const result = checkAndroid();
    for (const check of result.checks) {
      if (!check.passed) {
        expect(check.message.length).toBeGreaterThan(0);
      }
    }
  });
});

// ─── iOS doctor ──────────────────────────────────────────────────────────────

describe("checkIos", () => {
  it("returns a DoctorResult with platform: 'ios'", () => {
    const result = checkIos();
    expect(result).toHaveProperty("platform", "ios");
    expect(result).toHaveProperty("ready");
    expect(result).toHaveProperty("checks");
  });

  it("includes a macOS platform check (required)", () => {
    const result = checkIos();
    const macCheck = result.checks.find((c) => c.name === "macOS");
    expect(macCheck).toBeDefined();
    expect(macCheck!.required).toBe(true);
  });

  it("macOS check reflects actual platform", () => {
    const result = checkIos();
    const macCheck = result.checks.find((c) => c.name === "macOS")!;
    expect(macCheck.passed).toBe(process.platform === "darwin");
  });

  it("returns ready:false on non-macOS platforms", () => {
    if (process.platform !== "darwin") {
      const result = checkIos();
      expect(result.ready).toBe(false);
    }
  });

  it("every check has name, passed, message, required fields", () => {
    const result = checkIos();
    for (const check of result.checks) {
      expect(typeof check.name).toBe("string");
      expect(typeof check.passed).toBe("boolean");
      expect(typeof check.message).toBe("string");
      expect(typeof check.required).toBe("boolean");
    }
  });

  it("ready reflects whether all required checks pass", () => {
    const result = checkIos();
    const allRequiredPass = result.checks
      .filter((c) => c.required)
      .every((c) => c.passed);
    expect(result.ready).toBe(allRequiredPass);
  });

  it("failed checks always have a non-empty message", () => {
    const result = checkIos();
    for (const check of result.checks) {
      if (!check.passed) {
        expect(check.message.length).toBeGreaterThan(0);
      }
    }
  });
});
