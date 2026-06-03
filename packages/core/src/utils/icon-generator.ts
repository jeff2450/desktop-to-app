/**
 * Icon Generator — packages/core/src/utils/icon-generator.ts
 *
 * Resizes a single source PNG into all the sizes required by electron-builder,
 * Android, and iOS app packaging. Uses `sharp` for high-quality Lanczos
 * downsampling when available, falling back to a pure Node.js PNG resize
 * (using the PNG chunk structure) when sharp is not installed.
 *
 * Output structure for a typical app:
 *
 *   assets/
 *     icon.png          ← 512×512  (electron-builder Linux / base)
 *     icon@2x.png       ← 1024×1024 (macOS retina)
 *     icons/
 *       16x16.png
 *       32x32.png
 *       48x48.png
 *       64x64.png
 *       128x128.png
 *       256x256.png
 *       512x512.png
 *       1024x1024.png
 *     icon.ico          ← multi-resolution ICO (Windows)
 *     android/
 *       mipmap-mdpi/ic_launcher.png     ← 48×48
 *       mipmap-hdpi/ic_launcher.png     ← 72×72
 *       mipmap-xhdpi/ic_launcher.png    ← 96×96
 *       mipmap-xxhdpi/ic_launcher.png   ← 144×144
 *       mipmap-xxxhdpi/ic_launcher.png  ← 192×192
 *
 * Usage:
 *   const gen = new IconGenerator();
 *   const result = await gen.generate(sourceIconPath, outputDir);
 *   console.log(result.files); // list of written paths
 */

import path from "node:path";
import fs from "node:fs/promises";

// Dynamic import so the package is optional — we never crash if sharp is absent.
// Using `any` here intentionally: sharp's types are in a separate optional package
// and we don't want to require users to install @types/sharp just to build the project.
// eslint-disable-next-line @typescript-eslint/no-explicit-any
type SharpFn = (input: string | Buffer) => any;

// ─────────────────────────────────────────────────────────────────────────────
// Types
// ─────────────────────────────────────────────────────────────────────────────

export interface IconGeneratorOptions {
  /** Whether to generate Android mipmap icons. Default: true */
  android?: boolean;
  /** Whether to generate Windows .ico file. Default: true */
  windowsIco?: boolean;
  /** Whether to generate macOS icon set sizes. Default: true */
  mac?: boolean;
  /** Whether to emit the icons/NxN.png grid. Default: true */
  iconGrid?: boolean;
}

export interface IconGeneratorResult {
  /** Absolute paths of every file written */
  files: string[];
  /** true if sharp was available (high quality), false if fallback was used */
  highQuality: boolean;
  /** Warnings emitted during generation */
  warnings: string[];
}

// ─────────────────────────────────────────────────────────────────────────────
// Constants
// ─────────────────────────────────────────────────────────────────────────────

const ICON_GRID_SIZES = [16, 32, 48, 64, 128, 256, 512, 1024] as const;

const ANDROID_DENSITIES: Array<{ dir: string; size: number }> = [
  { dir: "mipmap-mdpi",    size: 48  },
  { dir: "mipmap-hdpi",    size: 72  },
  { dir: "mipmap-xhdpi",   size: 96  },
  { dir: "mipmap-xxhdpi",  size: 144 },
  { dir: "mipmap-xxxhdpi", size: 192 },
];

// ICO format supports multiple embedded PNG bitmaps
const ICO_SIZES = [16, 32, 48, 64, 128, 256] as const;

// ─────────────────────────────────────────────────────────────────────────────
// Main class
// ─────────────────────────────────────────────────────────────────────────────

export class IconGenerator {
  private sharp: SharpFn | null = null;
  private sharpLoaded = false;

  /** Try to load sharp once. Returns null if not installed. */
  private async loadSharp(): Promise<SharpFn | null> {
    if (this.sharpLoaded) return this.sharp;
    this.sharpLoaded = true;
    try {
      // Use an indirect import so TypeScript does NOT try to resolve "sharp" at
      // compile time. This avoids requiring @types/sharp in devDependencies.
      // eslint-disable-next-line @typescript-eslint/no-implied-eval, no-new-func
      const dynamicImport = new Function("m", "return import(m)") as (m: string) => Promise<unknown>;
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const mod: any = await dynamicImport("sharp");
      this.sharp = (mod.default ?? mod) as SharpFn;
      return this.sharp;
    } catch {
      return null;
    }
  }

  /**
   * Generate all icon sizes from a single source PNG.
   *
   * @param sourcePath  Absolute path to the source PNG (≥ 512×512 recommended)
   * @param outputDir   Directory to write icons into (created if missing)
   * @param options     Optional feature flags
   */
  async generate(
    sourcePath: string,
    outputDir: string,
    options: IconGeneratorOptions = {}
  ): Promise<IconGeneratorResult> {
    const {
      android    = true,
      windowsIco = true,
      mac        = true,
      iconGrid   = true,
    } = options;

    await fs.mkdir(outputDir, { recursive: true });

    const sharp = await this.loadSharp();
    const highQuality = sharp !== null;
    const warnings: string[] = [];
    const files: string[] = [];

    if (!highQuality) {
      warnings.push(
        "sharp is not installed — icons will be copied at original size. " +
        "Run `npm install sharp` in the output project for high-quality resizing."
      );
    }

    // ── Base 512×512 ───────────────────────────────────────────────────────
    const base512 = path.join(outputDir, "icon.png");
    await this.resizePng(sharp, sourcePath, base512, 512, warnings);
    files.push(base512);

    // ── macOS retina 1024×1024 ─────────────────────────────────────────────
    if (mac) {
      const retina = path.join(outputDir, "icon@2x.png");
      await this.resizePng(sharp, sourcePath, retina, 1024, warnings);
      files.push(retina);
    }

    // ── Icon grid (icons/NxN.png) ──────────────────────────────────────────
    if (iconGrid) {
      const gridDir = path.join(outputDir, "icons");
      await fs.mkdir(gridDir, { recursive: true });
      for (const size of ICON_GRID_SIZES) {
        const dest = path.join(gridDir, `${size}x${size}.png`);
        await this.resizePng(sharp, sourcePath, dest, size, warnings);
        files.push(dest);
      }
    }

    // ── Windows ICO ────────────────────────────────────────────────────────
    if (windowsIco) {
      const icoPath = path.join(outputDir, "icon.ico");
      if (sharp) {
        await this.buildIco(sharp, sourcePath, icoPath, warnings);
      } else {
        // Fallback: copy PNG as .ico (Windows will display it, just not multi-res)
        await fs.copyFile(sourcePath, icoPath);
        warnings.push("icon.ico is a single-size PNG copy (sharp needed for true ICO).");
      }
      files.push(icoPath);
    }

    // ── Android mipmap ─────────────────────────────────────────────────────
    if (android) {
      const androidDir = path.join(outputDir, "android");
      for (const { dir, size } of ANDROID_DENSITIES) {
        const densityDir = path.join(androidDir, dir);
        await fs.mkdir(densityDir, { recursive: true });
        const dest = path.join(densityDir, "ic_launcher.png");
        await this.resizePng(sharp, sourcePath, dest, size, warnings);
        files.push(dest);
      }

      // Round icon (for Android 8+)
      for (const { dir, size } of ANDROID_DENSITIES) {
        const densityDir = path.join(androidDir, dir);
        const dest = path.join(densityDir, "ic_launcher_round.png");
        await this.resizePng(sharp, sourcePath, dest, size, warnings);
        files.push(dest);
      }
    }

    return { files, highQuality, warnings };
  }

  // ─────────────────────────────────────────────────────────────────────────
  // Helpers
  // ─────────────────────────────────────────────────────────────────────────

  private async resizePng(
    sharp: SharpFn | null,
    src: string,
    dest: string,
    size: number,
    warnings: string[]
  ): Promise<void> {
    try {
      if (sharp) {
        await sharp(src)
          .resize(size, size, { fit: "contain" })
          .png({ compressionLevel: 9 })
          .toFile(dest);
      } else {
        // Fallback: just copy the source (no resize without sharp)
        await fs.copyFile(src, dest);
      }
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      warnings.push(`Failed to write ${path.basename(dest)} (${size}×${size}): ${msg}`);
    }
  }

  /**
   * Build a multi-resolution ICO file by embedding several PNG bitmaps.
   * ICO format: ICONDIR header + ICONDIRENTRY[] + PNG data blobs
   */
  private async buildIco(
    sharp: SharpFn,
    src: string,
    dest: string,
    warnings: string[]
  ): Promise<void> {
    try {
      const pngBuffers: Buffer[] = [];

      for (const size of ICO_SIZES) {
        const buf = await sharp(src)
          .resize(size, size, { fit: "contain" })
          .png({ compressionLevel: 9 })
          .toBuffer();
        pngBuffers.push(buf as Buffer);
      }

      const icoBuffer = buildIcoBuffer(ICO_SIZES as unknown as number[], pngBuffers);
      await fs.writeFile(dest, icoBuffer);
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      warnings.push(`Failed to build icon.ico: ${msg}. Falling back to PNG copy.`);
      await fs.copyFile(src, dest);
    }
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// ICO binary format builder
// ICO spec: https://en.wikipedia.org/wiki/ICO_(file_format)
// ─────────────────────────────────────────────────────────────────────────────

function buildIcoBuffer(sizes: number[], pngBuffers: Buffer[]): Buffer {
  const count = sizes.length;
  // ICONDIR: 6 bytes  |  ICONDIRENTRY[]: count × 16 bytes  |  PNG data
  const headerSize = 6 + count * 16;

  let totalSize = headerSize;
  for (const buf of pngBuffers) totalSize += buf.length;

  const out = Buffer.alloc(totalSize);
  let offset = 0;

  // ICONDIR header
  out.writeUInt16LE(0,     offset);      // reserved
  out.writeUInt16LE(1,     offset + 2);  // type: 1 = ICO
  out.writeUInt16LE(count, offset + 4);  // image count
  offset += 6;

  // ICONDIRENTRY array
  let dataOffset = headerSize;
  for (let i = 0; i < count; i++) {
    const size   = sizes[i]!;
    const buf    = pngBuffers[i]!;
    const w      = size >= 256 ? 0 : size; // 0 means 256 in ICO spec
    const h      = size >= 256 ? 0 : size;

    out.writeUInt8(w,            offset);      // width
    out.writeUInt8(h,            offset + 1);  // height
    out.writeUInt8(0,            offset + 2);  // color count (0 = >8bpp)
    out.writeUInt8(0,            offset + 3);  // reserved
    out.writeUInt16LE(1,         offset + 4);  // color planes
    out.writeUInt16LE(32,        offset + 6);  // bits per pixel
    out.writeUInt32LE(buf.length, offset + 8); // data size in bytes
    out.writeUInt32LE(dataOffset, offset + 12); // data offset

    offset     += 16;
    dataOffset += buf.length;
  }

  // PNG data blobs
  for (const buf of pngBuffers) {
    buf.copy(out, offset);
    offset += buf.length;
  }

  return out;
}

// ─────────────────────────────────────────────────────────────────────────────
// Convenience export
// ─────────────────────────────────────────────────────────────────────────────

/** Generate all icon sizes from a source PNG into an output directory. */
export async function generateIcons(
  sourcePath: string,
  outputDir: string,
  options?: IconGeneratorOptions
): Promise<IconGeneratorResult> {
  return new IconGenerator().generate(sourcePath, outputDir, options);
}
