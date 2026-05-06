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

  /** UI component library / styling approach */
  uiLibrary: "shadcn" | "mui" | "tailwind" | "other";

  /** Whether the project already has offline support (IndexedDB, Service Worker) */
  hasOfflineSupport: boolean;

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
}
