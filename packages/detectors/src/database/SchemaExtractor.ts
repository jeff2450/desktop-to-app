import path from "node:path";
import fs from "node:fs/promises";

export interface TableSchema {
  name: string;
  columns: ColumnDef[];
  /** True if a `created_at` column was found */
  hasCreatedAt: boolean;
  /** True if an `updated_at` column was found */
  hasUpdatedAt: boolean;
  /** True if a `user_id` column was found (RLS hint) */
  hasUserId: boolean;
}

export interface ColumnDef {
  name: string;
  sqlType: string;
  nullable: boolean;
  isPrimaryKey: boolean;
  hasDefault: boolean;
}

export interface SchemaExtractionResult {
  tables: TableSchema[];
  /** Raw table names (for quick access) */
  tableNames: string[];
  source: "migrations" | "types-file" | "inference" | "none";
  warnings: string[];
}

/**
 * Extracts the database schema from a Supabase project.
 *
 * Strategy priority:
 * 1. SQL migration files in supabase/migrations/
 * 2. Generated types file (supabase/types.ts or src/integrations/supabase/types.ts)
 * 3. Inference from import patterns (table names only, no column info)
 */
export class SchemaExtractor {
  async extract(sourceDir: string): Promise<SchemaExtractionResult> {
    const warnings: string[] = [];

    // ── Strategy 1: SQL migrations ─────────────────────────────────
    const migrationsDir = path.join(sourceDir, "supabase", "migrations");
    if (await this.dirExists(migrationsDir)) {
      const result = await this.extractFromMigrations(migrationsDir, warnings);
      if (result.tables.length > 0) {
        return { ...result, source: "migrations", warnings };
      }
    }

    // ── Strategy 2: Types file ─────────────────────────────────────
    const typesPaths = [
      path.join(sourceDir, "src", "integrations", "supabase", "types.ts"),
      path.join(sourceDir, "supabase", "types.ts"),
      path.join(sourceDir, "database.types.ts"),
      path.join(sourceDir, "src", "types", "supabase.ts"),
    ];

    for (const tp of typesPaths) {
      if (!(await this.fileExists(tp))) continue;
      const result = await this.extractFromTypesFile(tp, warnings);
      if (result.tables.length > 0) {
        return { ...result, source: "types-file", warnings };
      }
    }

    warnings.push(
      "No Supabase migrations or types file found. Table names will be inferred from query patterns."
    );

    // ── Strategy 3: Infer from source query patterns ────────────────────────
    const srcDir = path.join(sourceDir, "src");
    const inferResult = await this.inferFromSourceFiles(
      (await this.dirExists(srcDir)) ? srcDir : sourceDir,
      warnings
    );
    if (inferResult.tables.length > 0) {
      return { ...inferResult, source: "inference", warnings };
    }

    return {
      tables: [],
      tableNames: [],
      source: "none",
      warnings,
    };
  }

  // ─── Strategy 3: infer table names from .from('x') call patterns ──────────

  private async inferFromSourceFiles(
    dir: string,
    warnings: string[]
  ): Promise<Omit<SchemaExtractionResult, "source" | "warnings">> {
    const tableSet = new Set<string>();
    // Matches: .from('tableName') or .from("tableName")
    const fromPattern = /\.from\(\s*['"]([a-z_][a-z0-9_]*)['"]s*\)/g;

    await this.walkTs(dir, async (filePath) => {
      const content = await fs.readFile(filePath, "utf-8").catch(() => "");
      let m: RegExpExecArray | null;
      fromPattern.lastIndex = 0;
      while ((m = fromPattern.exec(content)) !== null) {
        const name = m[1];
        // Skip common Supabase storage bucket calls (storage.from(...))
        const before = content.slice(Math.max(0, m.index - 20), m.index);
        if (!before.includes("storage")) {
          tableSet.add(name);
        }
      }
    });

    if (tableSet.size === 0) {
      return { tables: [], tableNames: [] };
    }

    warnings.push(
      `Inferred ${tableSet.size} table(s) from query patterns: ${[...tableSet].join(", ")}. Column info unavailable — using generic schema.`
    );

    // Build minimal TableSchema stubs (no column info from inference)
    const tables: TableSchema[] = [...tableSet].map((name) => ({
      name,
      columns: [
        { name: "id",         sqlType: "text",     nullable: false, isPrimaryKey: true,  hasDefault: true },
        { name: "data",       sqlType: "jsonb",    nullable: false, isPrimaryKey: false, hasDefault: true },
        { name: "created_at", sqlType: "timestamptz", nullable: true,  isPrimaryKey: false, hasDefault: true },
      ],
      hasCreatedAt: true,
      hasUpdatedAt: false,
      hasUserId:    false,
    }));

    return { tables, tableNames: tables.map((t) => t.name) };
  }

  private async walkTs(
    dir: string,
    visitor: (filePath: string) => Promise<void>
  ): Promise<void> {
    let entries: import("node:fs").Dirent[];
    try {
      entries = await fs.readdir(dir, { withFileTypes: true });
    } catch {
      return;
    }
    for (const entry of entries) {
      const full = path.join(dir, entry.name);
      if (entry.isDirectory() && entry.name !== "node_modules" && entry.name !== "dist") {
        await this.walkTs(full, visitor);
      } else if (entry.isFile() && (entry.name.endsWith(".ts") || entry.name.endsWith(".tsx"))) {
        await visitor(full);
      }
    }
  }

  // ─── SQL migration parser ─────────────────────────────────────────────────

  private async extractFromMigrations(
    migrationsDir: string,
    warnings: string[]
  ): Promise<Omit<SchemaExtractionResult, "source" | "warnings">> {
    const files = (await fs.readdir(migrationsDir))
      .filter((f) => f.endsWith(".sql"))
      .sort(); // chronological order

    const tableMap = new Map<string, TableSchema>();

    for (const file of files) {
      const sql = await fs.readFile(path.join(migrationsDir, file), "utf-8");
      this.parseSql(sql, tableMap, warnings);
    }

    const tables = [...tableMap.values()];
    return { tables, tableNames: tables.map((t) => t.name) };
  }

  private parseSql(
    sql: string,
    tableMap: Map<string, TableSchema>,
    warnings: string[]
  ): void {
    // Remove comments
    const cleaned = sql
      .replace(/--[^\n]*/g, "")
      .replace(/\/\*[\s\S]*?\*\//g, "");

    // Match CREATE TABLE statements
    const createTableRe =
      /create\s+table\s+(?:if\s+not\s+exists\s+)?(?:"?public"?\s*\.\s*)?["']?(\w+)["']?\s*\(([^;]+?)\)/gi;

    let m: RegExpExecArray | null;
    while ((m = createTableRe.exec(cleaned)) !== null) {
      const tableName = m[1];
      const columnBlock = m[2];
      if (!tableName || !columnBlock) continue;

      // Skip Supabase internal tables
      if (["schema_migrations", "buckets", "objects", "hooks"].includes(tableName)) continue;

      const columns = this.parseColumns(columnBlock);

      tableMap.set(tableName, {
        name: tableName,
        columns,
        hasCreatedAt: columns.some((c) => c.name === "created_at"),
        hasUpdatedAt: columns.some((c) => c.name === "updated_at"),
        hasUserId: columns.some((c) => c.name === "user_id"),
      });
    }

    // Handle ALTER TABLE ADD COLUMN
    const alterRe =
      /alter\s+table\s+(?:"?public"?\s*\.\s*)?["']?(\w+)["']?\s+add\s+column\s+(?:if\s+not\s+exists\s+)?["']?(\w+)["']?\s+(\w+[^,;]*)/gi;

    while ((m = alterRe.exec(cleaned)) !== null) {
      const tableName = m[1];
      if (!tableName) continue;
      const table = tableMap.get(tableName);
      if (!table) continue;

      const colName = m[2];
      const colType = m[3]?.split(/\s/)[0] ?? "text";
      if (!colName) continue;

      if (!table.columns.find((c) => c.name === colName)) {
        table.columns.push({
          name: colName,
          sqlType: colType.toLowerCase(),
          nullable: true,
          isPrimaryKey: false,
          hasDefault: false,
        });
      }
    }
  }

  private parseColumns(columnBlock: string): ColumnDef[] {
    const columns: ColumnDef[] = [];
    // Split on commas that are NOT inside parentheses
    const lines = this.splitColumns(columnBlock);

    for (const line of lines) {
      const trimmed = line.trim();
      if (!trimmed) continue;

      // Skip constraints
      if (/^(primary\s+key|foreign\s+key|unique|check|constraint)\s/i.test(trimmed)) continue;

      // Parse: "column_name type [NOT NULL] [DEFAULT ...] [PRIMARY KEY]"
      const colMatch = trimmed.match(/^["']?(\w+)["']?\s+(\w+(?:\([^)]*\))?)(.*)/i);
      if (!colMatch) continue;

      const name = colMatch[1];
      const rawType = colMatch[2] ?? "text";
      const rest = colMatch[3] ?? "";
      if (!name) continue;

      columns.push({
        name,
        sqlType: rawType.toLowerCase(),
        nullable: !/not\s+null/i.test(rest),
        isPrimaryKey: /primary\s+key/i.test(rest) || name === "id",
        hasDefault: /default\s/i.test(rest),
      });
    }

    return columns;
  }

  private splitColumns(block: string): string[] {
    const result: string[] = [];
    let depth = 0;
    let current = "";

    for (const char of block) {
      if (char === "(") depth++;
      else if (char === ")") depth--;
      else if (char === "," && depth === 0) {
        result.push(current);
        current = "";
        continue;
      }
      current += char;
    }
    if (current.trim()) result.push(current);
    return result;
  }

  // ─── Types file parser ────────────────────────────────────────────────────

  private async extractFromTypesFile(
    typesPath: string,
    warnings: string[]
  ): Promise<Omit<SchemaExtractionResult, "source" | "warnings">> {
    const content = await fs.readFile(typesPath, "utf-8");
    const tables: TableSchema[] = [];

    // Match table blocks inside the Database type
    // Pattern: "tableName": { Row: { col: type; ... } }
    const tableBlockRe = /["'](\w+)["']\s*:\s*\{[^}]*Row\s*:\s*\{([^}]+)\}/g;
    let m: RegExpExecArray | null;

    while ((m = tableBlockRe.exec(content)) !== null) {
      const tableName = m[1];
      const rowBlock = m[2];
      if (!tableName || !rowBlock) continue;

      // Skip type helpers
      if (["Functions", "Enums", "CompositeTypes"].includes(tableName)) continue;

      const columns: ColumnDef[] = [];
      const colRe = /(\w+)\s*:\s*([^;|\n]+)/g;
      let cm: RegExpExecArray | null;

      while ((cm = colRe.exec(rowBlock)) !== null) {
        const colName = cm[1];
        const tsType = cm[2]?.trim() ?? "unknown";
        if (!colName || colName === "Row") continue;

        const nullable = tsType.includes("| null");
        columns.push({
          name: colName,
          sqlType: this.tsTypeToSql(tsType),
          nullable,
          isPrimaryKey: colName === "id",
          hasDefault: false,
        });
      }

      tables.push({
        name: tableName,
        columns,
        hasCreatedAt: columns.some((c) => c.name === "created_at"),
        hasUpdatedAt: columns.some((c) => c.name === "updated_at"),
        hasUserId: columns.some((c) => c.name === "user_id"),
      });
    }

    return { tables, tableNames: tables.map((t) => t.name) };
  }

  private tsTypeToSql(tsType: string): string {
    const clean = tsType.replace(/\s*\|\s*null/, "").trim();
    if (clean === "string") return "text";
    if (clean === "number") return "real";
    if (clean === "boolean") return "boolean";
    if (clean.startsWith("Json")) return "jsonb";
    return "text";
  }

  // ─── Helpers ──────────────────────────────────────────────────────────────

  private async fileExists(p: string): Promise<boolean> {
    return fs.access(p).then(() => true).catch(() => false);
  }

  private async dirExists(p: string): Promise<boolean> {
    return fs.stat(p).then((s) => s.isDirectory()).catch(() => false);
  }
}
