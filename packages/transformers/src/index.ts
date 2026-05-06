import path from "node:path";
import fs from "node:fs/promises";
import { Project } from "ts-morph";

import { SupabaseQueryTransformer } from "./supabase/SupabaseQueryTransformer.js";
import { SupabaseAuthTransformer } from "./supabase/SupabaseAuthTransformer.js";
import { SupabaseRealtimeTransformer } from "./supabase/SupabaseRealtimeTransformer.js";
import { SupabaseStorageTransformer } from "./supabase/SupabaseStorageTransformer.js";
import { FirestoreTransformer } from "./firebase/FirestoreTransformer.js";
import { FirebaseAuthTransformer } from "./firebase/FirebaseAuthTransformer.js";
import { ClerkTransformer } from "./auth/ClerkTransformer.js";
import { AiFallbackTransformer } from "./ai/AiFallbackTransformer.js";
import type { TransformResult } from "./base/BaseTransformer.js";

export { SupabaseQueryTransformer } from "./supabase/SupabaseQueryTransformer.js";
export { SupabaseAuthTransformer } from "./supabase/SupabaseAuthTransformer.js";
export { SupabaseRealtimeTransformer } from "./supabase/SupabaseRealtimeTransformer.js";
export { SupabaseStorageTransformer } from "./supabase/SupabaseStorageTransformer.js";
export { BaseTransformer } from "./base/BaseTransformer.js";
export type { TransformResult, TransformContext } from "./base/BaseTransformer.js";

export type TransformerType =
  | "supabase-query"
  | "supabase-auth"
  | "supabase-realtime"
  | "supabase-storage"
  | "firebase-firestore"
  | "firebase-auth"
  | "clerk-auth"
  | "auth0"
  | "ai";

/**
 * Transform a single source file using the appropriate transformer.
 *
 * This is the main entry point used by pipeline stage 03-transform.ts.
 * It instantiates the right transformer, runs it, and returns the result.
 *
 * Firebase, Clerk, and AI transformers are implemented in Session 3.
 */
export async function transformFile(params: {
  sourcePath: string;
  outputPath: string;
  transformerType: TransformerType;
  projectRoot: string;
}): Promise<TransformResult> {
  const { sourcePath, outputPath, transformerType, projectRoot } = params;

  const content = await fs.readFile(sourcePath, "utf-8");

  // Shared ts-morph project — reuse for performance when transforming many files
  const tsProject = new Project({
    skipAddingFilesFromTsConfig: true,
    compilerOptions: { allowJs: true, jsx: 2 /* React */ },
  });

  const sourceFile = tsProject.createSourceFile(
    path.basename(sourcePath),
    content,
    { overwrite: true }
  );

  const ctx = { sourcePath, projectRoot, outputPath };

  let transformer:
    | SupabaseQueryTransformer
    | SupabaseAuthTransformer
    | SupabaseRealtimeTransformer
    | SupabaseStorageTransformer;

  switch (transformerType) {
    case "supabase-query":
      transformer = new SupabaseQueryTransformer();
      break;
    case "supabase-auth":
      transformer = new SupabaseAuthTransformer();
      break;
    case "supabase-realtime":
      transformer = new SupabaseRealtimeTransformer();
      break;
    case "supabase-storage":
      transformer = new SupabaseStorageTransformer();
      break;

    case 'firebase-firestore':
    case "firebase-auth":
    case "clerk-auth":
    case "auth0":
      // Implemented in Session 3 (packages/transformers/src/firebase/, auth/)
      return {
        success: false,
        changes: [],
        warnings: [`Transformer '${transformerType}' is not yet implemented (Session 3).`],
        confidence: 0,
        error: `Transformer '${transformerType}' not yet available.`,
      };

    case "ai":
      // AiFallbackTransformer implemented in Session 3
      return {
        success: false,
        changes: [],
        warnings: ["AI fallback transformer is not yet implemented (Session 3)."],
        confidence: 0,
        error: "AiFallbackTransformer not yet available.",
      };

    default:
      return {
        success: false,
        changes: [],
        warnings: [`Unknown transformer type: ${transformerType as string}`],
        confidence: 0,
        error: `Unknown transformer type: ${transformerType as string}`,
      };
  }

  return transformer.transform(content, ctx);
}
