import path from "node:path";
import fs from "node:fs/promises";

export interface SupabaseDetection {
  found: boolean;
  clientFiles: string[];        // files that create the supabase client
  queryFiles: string[];         // files with .from().select/insert/update/delete
  authFiles: string[];          // files with supabase.auth.*
  realtimeFiles: string[];      // files with .channel() subscriptions
  storageFiles: string[];       // files with storage.from().*
  hasTypesFile: boolean;        // supabase/types.ts or similar
  envVarNames: string[];        // detected env var names (VITE_SUPABASE_URL, etc.)
  confidence: number;
  warnings: string[];
}

const SUPABASE_IMPORT_RE = /from\s+['"]@supabase\/supabase-js['"]/;
const SUPABASE_CLIENT_RE = /createClient\s*\(/;
const SUPABASE_FROM_RE = /\bsupabase\s*\.\s*from\s*\(/;
const SUPABASE_AUTH_RE = /\bsupabase\s*\.\s*auth\s*\./;
const SUPABASE_CHANNEL_RE = /\bsupabase\s*\.\s*channel\s*\(/;
const SUPABASE_STORAGE_RE = /\bsupabase\s*\.\s*storage\s*\.\s*from\s*\(/;
const ENV_VAR_RE = /(?:import\.meta\.env|process\.env)\.(\w*SUPABASE\w*)/g;

/**
 * Scans the project for all Supabase usage patterns.
 * Returns a detailed breakdown of which files use which Supabase features.
 */
export class SupabaseDetector {
  async detect(
    sourceDir: string,
    deps: Record<string, string>,
    allSourceFiles: string[]
  ): Promise<SupabaseDetection> {
    const hasPackage = "@supabase/supabase-js" in deps
      || "@supabase/ssr" in deps
      || "@supabase/auth-helpers-react" in deps;

    if (!hasPackage && allSourceFiles.length === 0) {
      return this.notFound();
    }

    const clientFiles: string[] = [];
    const queryFiles: string[] = [];
    const authFiles: string[] = [];
    const realtimeFiles: string[] = [];
    const storageFiles: string[] = [];
    const envVarNames = new Set<string>();
    const warnings: string[] = [];

    let foundAnySupabase = hasPackage;

    for (const filePath of allSourceFiles) {
      let content: string;
      try {
        content = await fs.readFile(filePath, "utf-8");
      } catch {
        continue;
      }

      const rel = path.relative(sourceDir, filePath);

      if (!SUPABASE_IMPORT_RE.test(content) && !SUPABASE_FROM_RE.test(content) && !SUPABASE_AUTH_RE.test(content)) {
        continue;
      }

      foundAnySupabase = true;

      if (SUPABASE_CLIENT_RE.test(content)) clientFiles.push(rel);
      if (SUPABASE_FROM_RE.test(content)) queryFiles.push(rel);
      if (SUPABASE_AUTH_RE.test(content)) authFiles.push(rel);
      if (SUPABASE_CHANNEL_RE.test(content)) realtimeFiles.push(rel);
      if (SUPABASE_STORAGE_RE.test(content)) storageFiles.push(rel);

      // Collect env var names
      let m: RegExpExecArray | null;
      ENV_VAR_RE.lastIndex = 0;
      while ((m = ENV_VAR_RE.exec(content)) !== null) {
        if (m[1]) envVarNames.add(m[1]);
      }
    }

    if (!foundAnySupabase) return this.notFound();

    // Warn about edge cases
    if (realtimeFiles.length > 0) {
      warnings.push(
        `${realtimeFiles.length} file(s) use Supabase Realtime. ` +
          "These will be converted to server-sent events (SSE) on the local backend."
      );
    }

    if (storageFiles.length > 0) {
      warnings.push(
        `${storageFiles.length} file(s) use Supabase Storage. ` +
          "These will be converted to local filesystem storage."
      );
    }

    // Check for types file
    const typesLocations = [
      path.join(sourceDir, "supabase", "types.ts"),
      path.join(sourceDir, "src", "integrations", "supabase", "types.ts"),
      path.join(sourceDir, "src", "lib", "supabase", "types.ts"),
      path.join(sourceDir, "database.types.ts"),
    ];
    let hasTypesFile = false;
    for (const loc of typesLocations) {
      if (await this.fileExists(loc)) { hasTypesFile = true; break; }
    }

    const totalFiles = queryFiles.length + authFiles.length + realtimeFiles.length + storageFiles.length;
    let confidence = 0.9;
    if (realtimeFiles.length > 2) confidence -= 0.1;
    if (storageFiles.length > 2) confidence -= 0.05;
    if (!hasTypesFile) confidence -= 0.05;

    return {
      found: true,
      clientFiles,
      queryFiles,
      authFiles,
      realtimeFiles,
      storageFiles,
      hasTypesFile,
      envVarNames: [...envVarNames],
      confidence: Math.max(confidence, 0.4),
      warnings,
    };
  }

  private notFound(): SupabaseDetection {
    return {
      found: false,
      clientFiles: [],
      queryFiles: [],
      authFiles: [],
      realtimeFiles: [],
      storageFiles: [],
      hasTypesFile: false,
      envVarNames: [],
      confidence: 1,
      warnings: [],
    };
  }

  private async fileExists(p: string): Promise<boolean> {
    return fs.access(p).then(() => true).catch(() => false);
  }
}
