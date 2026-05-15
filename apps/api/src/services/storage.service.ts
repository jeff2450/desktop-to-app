/**
 * Storage service — transparently supports:
 *   1. AWS S3 / Cloudflare R2 (when AWS_ACCESS_KEY_ID + S3_BUCKET are set)
 *   2. Local disk fallback (outputs/ dir) for development
 */
import path from "node:path";
import fs from "node:fs";
import fsp from "node:fs/promises";
import type { Readable } from "node:stream";
import { env, useS3 } from "../config/env.js";

// ─── Lazy S3 client (only constructed when credentials present) ─────────────
let _s3: import("@aws-sdk/client-s3").S3Client | null = null;

function getS3(): import("@aws-sdk/client-s3").S3Client {
  if (_s3) return _s3;
  if (!useS3) throw new Error("S3 is not configured");
  const { S3Client } = require("@aws-sdk/client-s3");
  _s3 = new S3Client({
    region: env.AWS_REGION,
    credentials: {
      accessKeyId: env.AWS_ACCESS_KEY_ID!,
      secretAccessKey: env.AWS_SECRET_ACCESS_KEY!,
    },
  });
  return _s3!;
}

// ─── Ensure local outputs directory exists ──────────────────────────────────
const outputsDir = path.resolve(process.cwd(), env.OUTPUTS_DIR);
if (!fs.existsSync(outputsDir)) {
  fs.mkdirSync(outputsDir, { recursive: true });
}

// ─── Public API ─────────────────────────────────────────────────────────────

export async function uploadArtifact(
  key: string,
  stream: Readable,
  contentType: string
): Promise<void> {
  if (useS3) {
    const { Upload } = await import("@aws-sdk/lib-storage");
    const upload = new Upload({
      client: getS3(),
      params: {
        Bucket: env.S3_BUCKET!,
        Key: key,
        Body: stream,
        ContentType: contentType,
      },
    });
    await upload.done();
    return;
  }

  // Local fallback: stream to outputs/<key>
  const localPath = path.join(outputsDir, key.replace(/\//g, "_"));
  const dir = path.dirname(localPath);
  await fsp.mkdir(dir, { recursive: true });
  const writeStream = fs.createWriteStream(localPath);
  await new Promise<void>((resolve, reject) => {
    stream.pipe(writeStream);
    writeStream.on("finish", resolve);
    writeStream.on("error", reject);
  });
}

/** Keep legacy alias used by conversion worker */
export const uploadToS3 = uploadArtifact;

export async function generateSignedUrl(key: string, expiresIn = 3600): Promise<string> {
  if (useS3) {
    const { GetObjectCommand } = await import("@aws-sdk/client-s3");
    const { getSignedUrl } = await import("@aws-sdk/s3-request-presigner");
    return getSignedUrl(
      getS3(),
      new GetObjectCommand({ Bucket: env.S3_BUCKET!, Key: key }),
      { expiresIn }
    );
  }

  // Local: return a direct download path (the API must handle /downloads/local/:key)
  return `/downloads/local/${encodeURIComponent(key)}`;
}

export async function deleteObject(key: string): Promise<void> {
  if (useS3) {
    const { DeleteObjectCommand } = await import("@aws-sdk/client-s3");
    await getS3().send(new DeleteObjectCommand({ Bucket: env.S3_BUCKET!, Key: key }));
    return;
  }

  const localPath = path.join(outputsDir, key.replace(/\//g, "_"));
  await fsp.unlink(localPath).catch(() => {/* already gone */});
}

/** Resolve a storage key to an absolute local path (dev only) */
export function localPathForKey(key: string): string {
  return path.join(outputsDir, key.replace(/\//g, "_"));
}
