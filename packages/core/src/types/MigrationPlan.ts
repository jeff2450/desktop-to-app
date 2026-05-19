/**
 * A fully planned migration produced by the Plan stage (02-plan.ts).
 * Describes every file that needs to be transformed and what to do with it.
 */
export interface MigrationPlan {
  /** Files that need AST-based transformation */
  filesToTransform: FileTransformPlan[];

  /** Files to copy verbatim (no transformation needed) */
  filesToCopy: string[];

  /** Files to delete from the output (cloud-only build artifacts, etc.) */
  filesToDelete: string[];

  /** New files to generate (Electron main, preload, backend server, etc.) */
  filesToGenerate: FileGeneratePlan[];

  /** npm packages to add to the output project */
  dependenciesToAdd: Record<string, string>;

  /** npm packages to remove from the output project */
  dependenciesToRemove: string[];

  /** npm scripts to inject or override in the output package.json */
  scriptsToInject: Record<string, string>;

  /** Summary of what this plan will do — shown to users */
  summary: string;
}

export interface FileTransformPlan {
  /** Relative path within the source project */
  sourcePath: string;

  /** Relative path in the output project (usually the same) */
  outputPath: string;

  /**
   * Which transformer to apply.
   * "ai" means the AiFallbackTransformer will be used.
   */
  transformerType:
    | "supabase-query"
    | "supabase-auth"
    | "supabase-realtime"
    | "supabase-storage"
    | "firebase-firestore"
    | "firebase-auth"
    | "clerk-auth"
    | "auth0"
    | "vue"
    | "ai";

  /** Estimated confidence the transformer can handle this file (0–1) */
  confidence: number;

  /** Human-readable reason why this file needs transformation */
  reason: string;
}

export interface FileGeneratePlan {
  /** Output path in the project */
  outputPath: string;

  /** Which generator to use */
  generatorType:
    | "electron-main"
    | "electron-preload"
    | "electron-builder-config"
    | "express-server"
    | "sqlite-database"
    | "jwt-auth"
    | "crud-routes"
    | "local-api-client"
    | "sync-engine"
    | "online-status-hook"
    | "mac-entitlements";

  /** Template variables to pass to the Handlebars template */
  templateVars: Record<string, unknown>;
}
