import path from "node:path";
import fs from "node:fs/promises";

export interface ArtifactUploadOptions {
  releaseDir: string;
  conversionId: string;
  userId: string;
  onLog: (line: string) => void;
  /** uploadFn is injected by the worker to avoid circular deps */
  uploadFn: (localPath: string, conversionId: string, userId: string) => Promise<string>;
}

export interface ArtifactUploadResult {
  artifacts: Array<{ filename: string; url: string; sizeBytes: number; platform: string }>;
}

const PLATFORM_EXTS: Record<string, string> = {
  ".exe":       "windows",
  ".AppImage":  "linux",
  ".deb":       "linux",
  ".rpm":       "linux",
  ".dmg":       "mac",
  ".pkg":       "mac",
  ".snap":      "linux",
};

/**
 * Scans the electron-builder release/ directory, uploads each installer
 * artifact to S3 via the injected uploadFn, and returns the CDN URLs.
 *
 * The uploadFn injection keeps this package free of AWS SDK dependencies
 * (those live in apps/api/src/services/storageService.ts).
 */
export class ArtifactUploader {
  async upload(opts: ArtifactUploadOptions): Promise<ArtifactUploadResult> {
    const { releaseDir, conversionId, userId, onLog, uploadFn } = opts;
    const artifacts: ArtifactUploadResult["artifacts"] = [];

    const entries = await fs.readdir(releaseDir, { withFileTypes: true }).catch(() => []);
    const installerFiles = entries.filter((e) => {
      if (!e.isFile()) return false;
      const ext = path.extname(e.name).toLowerCase();
      return ext in PLATFORM_EXTS;
    });

    if (installerFiles.length === 0) {
      onLog("[uploader] No installer artifacts found in release/");
      return { artifacts };
    }

    for (const file of installerFiles) {
      const localPath = path.join(releaseDir, file.name);
      const ext = path.extname(file.name).toLowerCase();
      const platform = PLATFORM_EXTS[ext] ?? "unknown";

      try {
        const stat = await fs.stat(localPath);
        onLog(`[uploader] Uploading ${file.name} (${(stat.size / 1024 / 1024).toFixed(1)}MB)...`);

        const url = await uploadFn(localPath, conversionId, userId);
        artifacts.push({ filename: file.name, url, sizeBytes: stat.size, platform });

        onLog(`[uploader] ✓ ${file.name} → ${url}`);
      } catch (err) {
        onLog(`[uploader] ✗ Failed to upload ${file.name}: ${(err as Error).message}`);
      }
    }

    return { artifacts };
  }
}
