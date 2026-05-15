import multerModule from "multer";
const multer = (multerModule as any).default || multerModule;
import type { Request } from "express";
import path from "node:path";
import fs from "node:fs";
import { env } from "../config/env.js";
import { ApiError } from "../lib/errors.js";

// Ensure uploads directory exists
const uploadsDir = path.resolve(process.cwd(), env.UPLOADS_DIR);
if (!fs.existsSync(uploadsDir)) {
  fs.mkdirSync(uploadsDir, { recursive: true });
}

const storage = multer.diskStorage({
  destination: (_req: any, _file: any, cb: any) => {
    cb(null, uploadsDir);
  },
  filename: (_req: any, file: any, cb: any) => {
    const timestamp = Date.now();
    const safe = file.originalname.replace(/[^a-zA-Z0-9._-]/g, "_");
    cb(null, `${timestamp}-${safe}`);
  },
});

function fileFilter(
  _req: Request,
  file: any,
  cb: any
): void {
  if (file.mimetype === "application/zip" || file.originalname.endsWith(".zip")) {
    cb(null, true);
  } else {
    cb(new ApiError(400, "Only .zip files are accepted", "INVALID_FILE_TYPE"));
  }
}

export const uploadZip = multer({
  storage,
  fileFilter,
  limits: {
    fileSize: env.UPLOAD_MAX_SIZE_MB * 1024 * 1024,
    files: 1,
  },
}).single("archive");

/** Promisified multer middleware for use in async route handlers */
export function handleUpload(
  req: import("express").Request,
  res: import("express").Response
): Promise<void> {
  return new Promise((resolve, reject) => {
    uploadZip(req, res, (err: any) => {
      if (err instanceof multer.MulterError) {
        if (err.code === "LIMIT_FILE_SIZE") {
          reject(
            new ApiError(
              413,
              `File too large. Maximum size is ${env.UPLOAD_MAX_SIZE_MB} MB`,
              "FILE_TOO_LARGE"
            )
          );
        } else {
          reject(new ApiError(400, err.message, "UPLOAD_ERROR"));
        }
      } else if (err) {
        reject(err);
      } else {
        resolve();
      }
    });
  });
}
