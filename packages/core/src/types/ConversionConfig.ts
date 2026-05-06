/**
 * Conversion mode — controls how the output app handles data and connectivity.
 *
 *  "offline" — All data stored locally in SQLite. No internet required ever.
 *              Cloud SDK calls fully replaced with local API calls.
 *              Best for: pharmacy apps, clinic tools, field apps.
 *
 *  "online"  — Original cloud backend kept as-is (Supabase/Firebase untouched).
 *              App runs inside Electron with internet required.
 *              Best for: apps that must sync with a shared cloud database.
 *
 *  "hybrid"  — Local SQLite when offline, syncs to cloud when internet available.
 *              A sync engine is generated to reconcile changes on reconnect.
 *              Best for: apps used in areas with intermittent connectivity.
 */
export type ConversionMode = "offline" | "online" | "hybrid";

/**
 * User-supplied configuration — loaded from webtoapp.config.json or
 * passed directly via the CLI flags / API request body.
 */
export interface ConversionConfig {
  /** Human-readable app name (used in installer UI and window title) */
  name: string;

  /** Semantic version string for the output app */
  version: string;

  /** Absolute or relative path to the source project root */
  source: string;

  /** Absolute or relative path where the output project will be written */
  output?: string;

  /** Target platforms to build for */
  targets: Array<"windows" | "linux" | "mac" | "android" | "ios">;

  /**
   * Conversion mode — controls offline/online/hybrid behaviour.
   * @default "offline"
   */
  mode: ConversionMode;

  /**
   * Reverse-domain app identifier.
   * @example "com.acme.pharmacyapp"
   */
  appId: string;

  /** Path to a 512x512 PNG icon (relative to source root) */
  icon?: string;

  /** Backend generation strategy */
  backend: BackendConfig;

  /** Auth generation strategy */
  auth: AuthConfig;

  /** Database migration strategy */
  database: DatabaseConfig;

  /** Whether to open the Electron DevTools in the output app */
  devTools?: boolean;

  /** Whether to enable verbose pipeline logging */
  verbose?: boolean;
}

export interface BackendConfig {
  /**
   * "auto" — detect and replace cloud calls automatically.
   * "express" — always generate a local Express server.
   * "none" — skip backend generation (static app only).
   */
  type: "auto" | "express" | "none";

  /** Port for the local Express server (default: 3001) */
  port?: number;
}

export interface AuthConfig {
  /**
   * "local" — generate JWT auth backed by SQLite users table.
   * "none" — strip auth entirely (single-user app).
   */
  type: "local" | "none";

  /** Default admin email for seeded account */
  defaultAdmin?: string;
}

export interface DatabaseConfig {
  /**
   * "sqlite" — use better-sqlite3 (default).
   * "none" — no database generation.
   */
  type: "sqlite" | "none";

  /** Path to Supabase SQL migrations folder (relative to source root) */
  migrations?: string;
}
