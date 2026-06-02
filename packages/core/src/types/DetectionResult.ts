/**
 * Column definition inferred from a Supabase types.ts or SQL migration file.
 * Used to generate proper SQLite CREATE TABLE statements instead of a single
 * `data TEXT` blob column.
 */
export interface ColumnDefinition {
  name: string;
  /** SQLite-compatible type */
  type: "TEXT" | "INTEGER" | "REAL" | "BLOB" | "BOOLEAN";
  nullable: boolean;
  primaryKey: boolean;
  defaultValue?: string;
}

/**
 * Parsed Supabase Row Level Security (RLS) policy.
 */
export interface RlsPolicy {
  name: string;
  table: string;
  action: "SELECT" | "INSERT" | "UPDATE" | "DELETE" | "ALL";
  /** The raw SQL expression in the USING clause */
  using: string;
  /** True if the policy enforces ownership via auth.uid() */
  isOwnerOnly: boolean;
  /** The column used for ownership checks (e.g., 'user_id' or 'id') */
  ownerColumn?: string;
}


/**
 * The result produced by running all detectors against an input project.
 * Passed through the entire pipeline so every stage has full context.
 */
export interface DetectionResult {
  /** Primary UI framework detected in the project */
  framework: "react" | "vue" | "svelte" | "angular" | "unknown";

  /** Module bundler / meta-framework */
  bundler: "vite" | "webpack" | "next" | "unknown";

  /** Cloud backend provider */
  backend: "supabase" | "firebase" | "pocketbase" | "appwrite" | "none";

  /** Authentication provider */
  auth: "supabase" | "firebase" | "clerk" | "auth0" | "none";

  /** Database table names inferred from schema files or type definitions */
  tables: string[];

  /**
   * Per-table column definitions parsed from Supabase types.ts or SQL migrations.
   * Used by Stage 04 to generate properly-typed SQLite CREATE TABLE statements.
   */
  tableColumns: Record<string, ColumnDefinition[]>;

  /**
   * Parsed Supabase Row Level Security (RLS) policies per table.
   * Used by Stage 04 to generate Express route middleware and WHERE clauses.
   */
  rlsPolicies?: Record<string, RlsPolicy[]>;

  /** UI component library / styling approach */
  uiLibrary: "shadcn" | "mui" | "tailwind" | "other";

  /** Whether the project already uses browser-local persistence */
  hasLocalPersistence: boolean;

  /**
   * Overall confidence score for the detection (0–1).
   * Below 0.5: likely incomplete / unsupported project.
   * Below 0.8: AI fallback transformer will be activated for affected files.
   */
  confidence: number;

  /** Non-breaking issues found during detection */
  warnings: string[];

  /** Files that were scanned during detection */
  scannedFiles: string[];

  /** Raw dependency map from package.json (name → version) */
  dependencies: Record<string, string>;

  /** Raw devDependency map from package.json */
  devDependencies: Record<string, string>;

  /**
   * Auto-detected path to the app icon (relative to sourceDir).
   * Used by Stage 04 to set the correct icon in electron-builder.yml
   * instead of the hardcoded assets/icon.png placeholder.
   */
  iconPath?: string;

  /**
   * Detected TypeScript path aliases (from tsconfig.json `paths`).
   * Used by Stage 06 to inject resolve.alias into the vite config.
   * @example { "@": "./src", "@/components": "./src/components" }
   */
  pathAliases: Record<string, string>;
}
