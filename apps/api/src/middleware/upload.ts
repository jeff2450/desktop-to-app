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
  if (file.fieldname === "archive") {
    if (file.mimetype === "application/zip" || file.originalname.endsWith(".zip")) {
      cb(null, true);
    } else {
      cb(new ApiError(400, "Only .zip files are accepted for the archive field", "INVALID_FILE_TYPE"));
    }
  } else if (file.fieldname === "icon") {
    const ext = path.extname(file.originalname).toLowerCase();
    if ([".png", ".ico", ".jpg", ".jpeg"].includes(ext)) {
      cb(null, true);
    } else {
      cb(new ApiError(400, "Icon must be a PNG, ICO, or JPG file", "INVALID_ICON_TYPE"));
    }
  } else if (file.fieldname === "keystore") {
    const ext = path.extname(file.originalname).toLowerCase();
    if ([".keystore", ".jks"].includes(ext)) {
      cb(null, true);
    } else {
      cb(new ApiError(400, "Keystore must be a .keystore or .jks file", "INVALID_KEYSTORE_TYPE"));
    }
  } else {
    cb(new ApiError(400, `Unexpected field: ${file.fieldname}`, "UNEXPECTED_FIELD"));
  }
}

export const uploadZip = multer({
  storage,
  fileFilter,
  limits: {
    fileSize: env.UPLOAD_MAX_SIZE_MB * 1024 * 1024,
    files: 3,  // archive + icon + keystore
  },
}).fields([
  { name: "archive", maxCount: 1 },
  { name: "icon",    maxCount: 1 },
  { name: "keystore", maxCount: 1 },
]);

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

/**
 * After handleUpload(), call this to extract file references from req.files.
 * Returns { archiveFile, iconFile, keystoreFile } — iconFile and keystoreFile may be undefined.
 */
export function extractUploadedFiles(req: import("express").Request): {
  archiveFile: Express.Multer.File | undefined;
  iconFile: Express.Multer.File | undefined;
  keystoreFile: Express.Multer.File | undefined;
} {
  const files = req.files as Record<string, Express.Multer.File[]> | undefined;
  return {
    archiveFile: files?.["archive"]?.[0],
    iconFile:    files?.["icon"]?.[0],
    keystoreFile: files?.["keystore"]?.[0],
  };
}
