import {
  S3Client,
  PutObjectCommand,
  GetObjectCommand,
  DeleteObjectCommand,
  HeadObjectCommand,
} from "@aws-sdk/client-s3";
import { getSignedUrl } from "@aws-sdk/s3-request-presigner";
import fs from "node:fs/promises";
import path from "node:path";
import { createReadStream } from "node:fs";

const BUCKET = process.env["S3_BUCKET"] ?? "webtoapp-installers";
const REGION = process.env["AWS_REGION"] ?? "us-east-1";
const PRESIGN_EXPIRY_SECONDS = 60 * 60; // 1 hour

const s3 = new S3Client({
  region: REGION,
  ...(process.env["S3_ENDPOINT"]
    ? {
        endpoint: process.env["S3_ENDPOINT"], // for MinIO / localstack
        forcePathStyle: true,
      }
    : {}),
});

export interface UploadResult {
  key: string;
  url: string;
  sizeBytes: number;
  etag?: string;
}

export interface PresignedDownload {
  url: string;
  expiresAt: Date;
  key: string;
}

/**
 * Storage service — wraps AWS S3 for installer artifact storage.
 *
 * Key layout:
 *   installers/{userId}/{conversionId}/{filename}    — compiled installers
 *   uploads/{userId}/{conversionId}/{filename}       — source zip uploads
 *
 * Compatible with:
 *  - AWS S3
 *  - Cloudflare R2 (set S3_ENDPOINT)
 *  - MinIO (set S3_ENDPOINT, forcePathStyle: true)
 */
export class StorageService {
  /**
   * Upload a local file to S3.
   * Returns the S3 key and a permanent (non-expiring) URL.
   */
  async uploadInstaller(params: {
    localPath: string;
    conversionId: string;
    userId: string;
  }): Promise<UploadResult> {
    const { localPath, conversionId, userId } = params;
    const filename = path.basename(localPath);
    const key = `installers/${userId}/${conversionId}/${filename}`;

    const stat = await fs.stat(localPath);
    const sizeBytes = stat.size;

    const contentType = this.guessContentType(filename);

    const stream = createReadStream(localPath);

    const cmd = new PutObjectCommand({
      Bucket: BUCKET,
      Key: key,
      Body: stream,
      ContentType: contentType,
      ContentLength: sizeBytes,
      Metadata: {
        conversionId,
        userId,
        originalName: filename,
      },
    });

    const result = await s3.send(cmd);

    return {
      key,
      url: this.buildPublicUrl(key),
      sizeBytes,
      etag: result.ETag,
    };
  }

  /**
   * Upload a source zip/archive that a user submitted via the dashboard.
   */
  async uploadSourceArchive(params: {
    buffer: Buffer;
    filename: string;
    conversionId: string;
    userId: string;
  }): Promise<UploadResult> {
    const { buffer, filename, conversionId, userId } = params;
    const key = `uploads/${userId}/${conversionId}/${filename}`;

    const cmd = new PutObjectCommand({
      Bucket: BUCKET,
      Key: key,
      Body: buffer,
      ContentType: "application/zip",
      ContentLength: buffer.byteLength,
    });

    await s3.send(cmd);

    return {
      key,
      url: this.buildPublicUrl(key),
      sizeBytes: buffer.byteLength,
    };
  }

  /**
   * Generate a time-limited presigned URL for a user to download their installer.
   * The URL expires after PRESIGN_EXPIRY_SECONDS (1 hour by default).
   */
  async createPresignedDownload(key: string): Promise<PresignedDownload> {
    const cmd = new GetObjectCommand({ Bucket: BUCKET, Key: key });
    const url = await getSignedUrl(s3, cmd, { expiresIn: PRESIGN_EXPIRY_SECONDS });
    const expiresAt = new Date(Date.now() + PRESIGN_EXPIRY_SECONDS * 1000);
    return { url, expiresAt, key };
  }

  /**
   * Generate a presigned PUT URL for direct browser → S3 upload.
   * The dashboard uses this to upload source zips without proxying through the API.
   */
  async createPresignedUpload(params: {
    conversionId: string;
    userId: string;
    filename: string;
    contentType?: string;
  }): Promise<{ uploadUrl: string; key: string; expiresAt: Date }> {
    const { conversionId, userId, filename, contentType = "application/zip" } = params;
    const key = `uploads/${userId}/${conversionId}/${filename}`;

    const cmd = new PutObjectCommand({
      Bucket: BUCKET,
      Key: key,
      ContentType: contentType,
    });

    const uploadUrl = await getSignedUrl(s3, cmd, { expiresIn: 900 }); // 15 min upload window
    return { uploadUrl, key, expiresAt: new Date(Date.now() + 900 * 1000) };
  }

  /**
   * Check if an S3 object exists.
   */
  async exists(key: string): Promise<boolean> {
    try {
      await s3.send(new HeadObjectCommand({ Bucket: BUCKET, Key: key }));
      return true;
    } catch {
      return false;
    }
  }

  /**
   * Delete an S3 object (e.g. when a conversion is deleted by the user).
   */
  async delete(key: string): Promise<void> {
    await s3.send(new DeleteObjectCommand({ Bucket: BUCKET, Key: key }));
  }

  /**
   * Extract the S3 key from a full URL (used to delete when conversion is removed).
   */
  keyFromUrl(url: string): string {
    const base = this.buildPublicUrl("");
    return url.replace(base, "");
  }

  // ── Private ──────────────────────────────────────────────────────────────────

  private buildPublicUrl(key: string): string {
    if (process.env["S3_PUBLIC_URL"]) {
      return `${process.env["S3_PUBLIC_URL"].replace(/\/$/, "")}/${key}`;
    }
    return `https://${BUCKET}.s3.${REGION}.amazonaws.com/${key}`;
  }

  private guessContentType(filename: string): string {
    if (filename.endsWith(".exe"))       return "application/vnd.microsoft.portable-executable";
    if (filename.endsWith(".AppImage")) return "application/x-executable";
    if (filename.endsWith(".deb"))      return "application/vnd.debian.binary-package";
    if (filename.endsWith(".dmg"))      return "application/x-apple-diskimage";
    if (filename.endsWith(".zip"))      return "application/zip";
    return "application/octet-stream";
  }
}

export const storageService = new StorageService();
