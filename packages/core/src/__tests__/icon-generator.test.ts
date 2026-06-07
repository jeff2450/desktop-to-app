import { describe, it, expect, beforeEach, afterEach } from "vitest";
import * as path from "node:path";
import * as fs from "node:fs/promises";
import * as os from "node:os";
import { generateIcons } from "../utils/icon-generator.js";

// A tiny 1x1 PNG base64 string
const TINY_PNG_BASE64 = "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==";

describe("Icon Generator — Android Adaptive Icons", () => {
  let tmpDir: string;
  let srcPath: string;
  let outDir: string;

  beforeEach(async () => {
    tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), "webtoapp-icongen-"));
    srcPath = path.join(tmpDir, "icon.png");
    outDir = path.join(tmpDir, "out");

    // Write the tiny 1x1 PNG
    await fs.writeFile(srcPath, Buffer.from(TINY_PNG_BASE64, "base64"));
  });

  afterEach(async () => {
    await fs.rm(tmpDir, { recursive: true, force: true });
  });

  it("generates Android launcher, round, and adaptive foreground icons", async () => {
    const result = await generateIcons(srcPath, outDir, {
      android: true,
      windowsIco: false,
      mac: false,
      iconGrid: false,
    });

    expect(result.files.length).toBeGreaterThan(0);

    const androidDir = path.join(outDir, "android");

    // Expected files and legacy sizes
    const expected = [
      { file: "mipmap-mdpi/ic_launcher.png", size: 48 },
      { file: "mipmap-mdpi/ic_launcher_round.png", size: 48 },
      { file: "mipmap-mdpi/ic_launcher_foreground.png", size: 108 },

      { file: "mipmap-hdpi/ic_launcher.png", size: 72 },
      { file: "mipmap-hdpi/ic_launcher_round.png", size: 72 },
      { file: "mipmap-hdpi/ic_launcher_foreground.png", size: 162 },

      { file: "mipmap-xhdpi/ic_launcher.png", size: 96 },
      { file: "mipmap-xhdpi/ic_launcher_round.png", size: 96 },
      { file: "mipmap-xhdpi/ic_launcher_foreground.png", size: 216 },

      { file: "mipmap-xxhdpi/ic_launcher.png", size: 144 },
      { file: "mipmap-xxhdpi/ic_launcher_round.png", size: 144 },
      { file: "mipmap-xxhdpi/ic_launcher_foreground.png", size: 324 },

      { file: "mipmap-xxxhdpi/ic_launcher.png", size: 192 },
      { file: "mipmap-xxxhdpi/ic_launcher_round.png", size: 192 },
      { file: "mipmap-xxxhdpi/ic_launcher_foreground.png", size: 432 },
    ];

    for (const item of expected) {
      const absPath = path.join(androidDir, item.file);
      const exists = await fs.stat(absPath).then(s => s.isFile()).catch(() => false);
      expect(exists).toBe(true);
    }
  });
});
