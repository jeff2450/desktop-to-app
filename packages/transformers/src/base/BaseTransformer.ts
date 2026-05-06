import { Project, SourceFile, Node } from "ts-morph";

export interface TransformResult {
  success: boolean;
  transformedContent?: string;
  changes: string[];
  confidence: number;
  warnings: string[];
  error?: string;
}

export interface TransformContext {
  sourcePath: string;
  outputPath: string;
  projectRoot: string;
  backendPort?: number;
  tables?: string[];
}

/**
 * Abstract base class for all code transformers.
 *
 * Each transformer handles one category of cloud dependency replacement
 * (e.g. Supabase queries, Firebase auth, Clerk components).
 *
 * Subclasses implement:
 * - `canTransform(content)` — quick check before loading the AST
 * - `transformSourceFile(sf, ctx)` — the actual AST transformation
 */
export abstract class BaseTransformer {
  protected readonly project: Project;

  constructor() {
    this.project = new Project({
      useInMemoryFileSystem: true,
      compilerOptions: {
        allowJs: true,
        jsx: 4, // JsxEmit.ReactJSX
        target: 99, // ScriptTarget.ESNext
      },
    });
  }

  /**
   * Quick pre-check — should return false if the file clearly doesn't
   * need this transformer (avoids loading the full AST unnecessarily).
   */
  abstract canTransform(content: string): boolean;

  /**
   * Perform the AST transformation on a loaded SourceFile.
   * Should make changes in-place on the SourceFile.
   */
  protected abstract transformSourceFile(
    sourceFile: SourceFile,
    ctx: TransformContext
  ): Promise<Pick<TransformResult, "changes" | "warnings" | "confidence">>;

  /**
   * Main entry point. Loads the source into ts-morph, runs
   * transformSourceFile, and returns the result.
   */
  async transform(content: string, ctx: TransformContext): Promise<TransformResult> {
    if (!this.canTransform(content)) {
      return {
        success: true,
        transformedContent: content,
        confidence: 1.0,
        changes: [],
        warnings: [],
      };
    }

    // Add file to the in-memory project
    const fileName = ctx.sourcePath.endsWith(".tsx") || ctx.sourcePath.endsWith(".jsx")
      ? "input.tsx"
      : "input.ts";

    // Remove any previously added file
    const existing = this.project.getSourceFile(fileName);
    if (existing) this.project.removeSourceFile(existing);

    const sourceFile = this.project.createSourceFile(fileName, content, {
      overwrite: true,
    });

    try {
      const { changes, warnings, confidence } = await this.transformSourceFile(sourceFile, ctx);

      return {
        success: true,
        transformedContent: sourceFile.getFullText(),
        confidence,
        changes,
        warnings,
      };
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      return {
        success: false,
        confidence: 0,
        changes: [],
        warnings: [`Transformer error: ${message}`],
        error: message,
      };
    }
  }

  // ─── Shared AST utilities ─────────────────────────────────────────────────

  /**
   * Remove an import declaration for a given module specifier.
   * Returns the removed import's named imports for downstream use.
   */
  protected removeImport(sourceFile: SourceFile, moduleSpecifier: string): string[] {
    const importDecl = sourceFile.getImportDeclaration(moduleSpecifier);
    if (!importDecl) return [];

    const names = importDecl
      .getNamedImports()
      .map((n) => n.getName());

    importDecl.remove();
    return names;
  }

  /**
   * Add an import at the top of the file if it doesn't already exist.
   */
  protected addImport(
    sourceFile: SourceFile,
    moduleSpecifier: string,
    namedImports: string[]
  ): void {
    const existing = sourceFile.getImportDeclaration(moduleSpecifier);
    if (existing) {
      // Merge named imports
      const existingNames = existing.getNamedImports().map((n) => n.getName());
      const toAdd = namedImports.filter((n) => !existingNames.includes(n));
      if (toAdd.length > 0) {
        existing.addNamedImports(toAdd);
      }
      return;
    }

    sourceFile.addImportDeclaration({
      moduleSpecifier,
      namedImports,
    });
  }

  /**
   * Replace all occurrences of a text pattern using simple string replacement.
   * Use for straightforward token substitution where AST is overkill.
   */
  protected replaceText(
    sourceFile: SourceFile,
    from: string | RegExp,
    to: string
  ): number {
    const original = sourceFile.getFullText();
    const replaced = original.replace(
      typeof from === "string" ? new RegExp(escapeRegex(from), "g") : from,
      to
    );
    if (replaced !== original) {
      sourceFile.replaceWithText(replaced);
      return (original.match(typeof from === "string" ? new RegExp(escapeRegex(from), "g") : from) ?? []).length;
    }
    return 0;
  }

  /**
   * Find all call expressions matching a predicate.
   */
  protected findCallExpressions(
    sourceFile: SourceFile,
    predicate: (callText: string) => boolean
  ): Node[] {
    return sourceFile
      .getDescendantsOfKind(208 /* SyntaxKind.CallExpression */)
      .filter((node) => predicate(node.getText()));
  }
}

function escapeRegex(str: string): string {
  return str.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}
