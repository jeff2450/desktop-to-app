/**
 * jobHelpers.ts — Session 5 upgrade for conversionWorker.ts
 *
 * Provides real implementations of source preparation and installer upload
 * that the worker calls after the pipeline completes.
 *
 * Replace the stub prepareSource / installer handling in conversionWorker.ts
 * with these when running in production.
 */

import path from "node:path";
import fs from "node:fs/promises";
import { createWriteStream } from "node:fs";
import { pipeline as streamPipeline } from "node:stream/promises";

import { githubService } from "../services/githubService.js";
import { storageService } from "../services/storageService.js";
import { notificationService } from "../services/notificationService.js";
import { db } from "../db/client.js";
import { users, conversions } from "../db/schema.js";
import { eq } from "drizzle-orm";

// ── Source preparation ────────────────────────────────────────────────────────

/**
 * Prepare the source directory for conversion.
 *
 * Handles three source types:
 *  - "github"  → shallow-clone via GitHubService
 *  - "upload"  → download zip from S3, extract to destDir
 *  - "zip"     → same as upload
 */
export async function prepareSource(params: {
  sourceUrl: string;
  sourceType: "github" | "upload" | "zip";
  destDir: string;
  onLog: (line: string) => void;
}): Promise<void> {
  const { sourceUrl, sourceType, destDir, onLog } = params;

  await fs.mkdir(destDir, { recursive: true });

  if (sourceType === "github") {
    // Validate before cloning
    onLog(`[source] Validating GitHub repo: ${sourceUrl}`);
    const { valid, error, metadata } = await githubService.validateRepo(sourceUrl);

    if (!valid) throw new Error(error ?? "Invalid repository");

    onLog(`[source] Repo: ${metadata!.name} (${(metadata!.sizeKb / 1024).toFixed(0)}MB)`);
    onLog(`[source] Branch: ${metadata!.defaultBranch}`);

    await githubService.cloneRepo({
      repoUrl: sourceUrl,
      destDir,
      branch: metadata!.defaultBranch,
      onLog,
    });
    return;
  }

  if (sourceType === "upload" || sourceType === "zip") {
    // sourceUrl is an S3 key for upload type
    onLog(`[source] Downloading source archive from storage: ${sourceUrl}`);
    await downloadAndExtract(sourceUrl, destDir, onLog);
    return;
  }

  throw new Error(`Unknown sourceType: ${sourceType as string}`);
}

async function downloadAndExtract(
  s3Key: string,
  destDir: string,
  onLog: (line: string) => void
): Promise<void> {
  const { createPresignedDownload } = storageService;

  // Get a presigned URL for the uploaded archive
  const { url } = await storageService.createPresignedDownload(s3Key);

  // Download to a temp file
  const tmpZip = path.join(destDir, "..", `source-${Date.now()}.zip`);
  const res = await fetch(url);
  if (!res.ok) throw new Error(`Failed to download source: HTTP ${res.status}`);

  const writer = createWriteStream(tmpZip);
  await streamPipeline(res.body as unknown as NodeJS.ReadableStream, writer);

  onLog(`[source] Downloaded archive (${((await fs.stat(tmpZip)).size / 1024 / 1024).toFixed(1)}MB)`);

  // Extract zip
  await extractZip(tmpZip, destDir, onLog);

  // Clean up temp zip
  await fs.rm(tmpZip, { force: true });
}

async function extractZip(zipPath: string, destDir: string, onLog: (l: string) => void): Promise<void> {
  const { execFile } = await import("node:child_process");
  const { promisify } = await import("node:util");
  const execFileAsync = promisify(execFile);

  onLog(`[source] Extracting archive...`);

  try {
    // Try unzip (Linux/macOS)
    await execFileAsync("unzip", ["-q", "-o", zipPath, "-d", destDir]);
  } catch {
    // Fall back to Node.js (no system unzip)
    const AdmZip = (await import("adm-zip")).default;
    const zip = new AdmZip(zipPath);
    zip.extractAllTo(destDir, true);
  }

  onLog(`[source] Archive extracted to ${destDir}`);

  // If the zip contains a single top-level folder, hoist its contents
  await hoistSingleFolder(destDir, onLog);
}

async function hoistSingleFolder(dir: string, onLog: (l: string) => void): Promise<void> {
  const entries = await fs.readdir(dir, { withFileTypes: true });
  const dirs = entries.filter((e) => e.isDirectory() && !e.name.startsWith("."));
  const files = entries.filter((e) => e.isFile());

  if (dirs.length === 1 && files.length === 0) {
    const innerDir = path.join(dir, dirs[0]!.name);
    const innerEntries = await fs.readdir(innerDir);

    for (const entry of innerEntries) {
      await fs.rename(path.join(innerDir, entry), path.join(dir, entry));
    }
    await fs.rmdir(innerDir);
    onLog(`[source] Hoisted contents of ${dirs[0]!.name}/`);
  }
}

// ── Installer upload ──────────────────────────────────────────────────────────

/**
 * Upload the finished installer to S3 and update the conversion record.
 */
export async function uploadInstaller(params: {
  localPath: string;
  conversionId: string;
  userId: string;
  onLog: (line: string) => void;
}): Promise<string> {
  const { localPath, conversionId, userId, onLog } = params;

  onLog(`[upload] Uploading installer to storage: ${path.basename(localPath)}`);

  const result = await storageService.uploadInstaller({ localPath, conversionId, userId });

  onLog(`[upload] Uploaded (${(result.sizeBytes / 1024 / 1024).toFixed(1)}MB) → ${result.key}`);

  // Update conversion record with S3 URL
  await db
    .update(conversions)
    .set({
      installerUrl: result.url,
      installerSize: result.sizeBytes,
      updatedAt: new Date(),
    })
    .where(eq(conversions.id, conversionId));

  return result.url;
}

// ── Post-completion notifications ─────────────────────────────────────────────

/**
 * Send a completion email to the user after a successful conversion.
 */
export async function notifyComplete(params: {
  conversionId: string;
  durationMs: number;
  targets: string[];
}): Promise<void> {
  const { conversionId, durationMs, targets } = params;

  try {
    const [conv] = await db
      .select({ name: conversions.name, userId: conversions.userId })
      .from(conversions)
      .where(eq(conversions.id, conversionId))
      .limit(1);

    if (!conv) return;

    const [user] = await db
      .select({ email: users.email, name: users.name })
      .from(users)
      .where(eq(users.id, conv.userId))
      .limit(1);

    if (!user) return;

    await notificationService.sendConversionComplete({
      to: user.email,
      userName: user.name ?? undefined,
      conversionName: conv.name,
      conversionId,
      durationMs,
      targets,
    });
  } catch (err) {
    console.error("[notify] Failed to send completion email:", err);
  }
}

/**
 * Send a failure email to the user after a failed conversion.
 */
export async function notifyFailed(params: {
  conversionId: string;
  errorMessage: string;
}): Promise<void> {
  const { conversionId, errorMessage } = params;

  try {
    const [conv] = await db
      .select({ name: conversions.name, userId: conversions.userId })
      .from(conversions)
      .where(eq(conversions.id, conversionId))
      .limit(1);

    if (!conv) return;

    const [user] = await db
      .select({ email: users.email, name: users.name })
      .from(users)
      .where(eq(users.id, conv.userId))
      .limit(1);

    if (!user) return;

    await notificationService.sendConversionFailed({
      to: user.email,
      userName: user.name ?? undefined,
      conversionName: conv.name,
      conversionId,
      errorMessage,
    });
  } catch (err) {
    console.error("[notify] Failed to send failure email:", err);
  }
}
