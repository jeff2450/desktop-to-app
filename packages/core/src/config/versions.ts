/**
 * Pinned dependency versions injected into generated output projects.
 *
 * Centralising these here means you only update one file when bumping
 * a dependency, and every generated project stays consistent.
 *
 * Ranges use:
 *  - Exact (`x.y.z`) for tools where a minor bump can break Electron packaging
 *  - `^x.y.z` for libraries where minor updates are safe
 */

/** Electron core — exact pin because electron-builder is version-sensitive */
export const ELECTRON_VERSION = "31.0.0";

/** electron-updater ships separately and tracks electron-builder releases */
export const ELECTRON_UPDATER_VERSION = "^6.1.0";

/**
 * better-sqlite3 must be rebuilt for each Electron Node.js version.
 * Pin the major to avoid silent ABI mismatches.
 */
export const BETTER_SQLITE3_VERSION = "^11.0.0";

export const EXPRESS_VERSION        = "^4.19.0";
export const CORS_VERSION           = "^2.8.5";
export const BCRYPTJS_VERSION       = "^2.4.3";
export const JSONWEBTOKEN_VERSION   = "^9.0.0";
export const MULTER_VERSION         = "^1.4.5-lts.1";
export const CONCURRENTLY_VERSION   = "^9.0.0";
export const WAIT_ON_VERSION        = "^8.0.0";

// Cloud SDKs kept for hybrid-mode sync
export const SUPABASE_JS_VERSION    = "^2.43.0";
export const FIREBASE_VERSION       = "^10.12.0";
