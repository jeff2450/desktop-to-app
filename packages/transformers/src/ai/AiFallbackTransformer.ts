import type { SourceFile } from "ts-morph";
import { BaseTransformer, type TransformContext, type TransformResult } from "../base/BaseTransformer.js";

const ANTHROPIC_API_KEY = process.env["ANTHROPIC_API_KEY"];
const MODEL = "claude-sonnet-4-20250514";

/**
 * AI Fallback Transformer — uses the Claude API to rewrite files that
 * scored below the 0.8 confidence threshold in AST-based transformers.
 *
 * This handles complex patterns the regex/AST transformers miss:
 *  - Dynamic collection names (firebase.collection(tableName))
 *  - Chained Supabase queries with .or(), .contains(), .rpc()
 *  - Mixed auth + data access in the same file
 *  - Custom hooks wrapping cloud SDKs
 */
export class AiFallbackTransformer extends BaseTransformer {
  canTransform(_content: string): boolean {
    return true; // always a candidate — only called when other transformers score < 0.8
  }

  protected async transformSourceFile(
    sourceFile: SourceFile,
    ctx: TransformContext
  ): Promise<Pick<TransformResult, "changes" | "warnings" | "confidence">> {
    if (!ANTHROPIC_API_KEY) {
      return {
        changes: [],
        warnings: ["ANTHROPIC_API_KEY not set — AI fallback transformer skipped. File copied unchanged."],
        confidence: 0,
      };
    }

    const originalCode = sourceFile.getFullText();
    const filePath = ctx.sourcePath;

    try {
      const transformed = await this.callClaude(originalCode, filePath);

      if (!transformed || transformed.trim() === originalCode.trim()) {
        return {
          changes: [],
          warnings: ["AI transformer returned unchanged code"],
          confidence: 0.5,
        };
      }

      sourceFile.replaceWithText(transformed);

      const changes = this.diffChanges(originalCode, transformed);

      return {
        changes,
        warnings: [],
        confidence: 0.88,
      };
    } catch (err) {
      return {
        changes: [],
        warnings: [`AI transformer error: ${(err as Error).message} — file copied unchanged`],
        confidence: 0,
      };
    }
  }

  private async callClaude(sourceCode: string, filePath: string): Promise<string> {
    const systemPrompt = `You are an expert TypeScript/React developer. Your job is to rewrite source files to remove cloud SDK dependencies (Supabase, Firebase, Clerk, Auth0) and replace them with calls to a local REST API at http://127.0.0.1:3001.

The local API follows the same interface as the Supabase JS client:
  localApi.from('table').select()
  localApi.from('table').eq('id', id).single()
  localApi.from('table').insert(data)
  localApi.from('table').update(data)
  localApi.from('table').delete()
  localApi.from('table').upsert(data)
  localApi.auth.signInWithPassword({ email, password })
  localApi.auth.signUp({ email, password })
  localApi.auth.signOut()
  localApi.auth.getSession()
  localApi.auth.onAuthStateChange(callback)
  localApi.storage.from('bucket').upload(path, file)
  localApi.storage.from('bucket').getPublicUrl(path)
  localApi.subscribe('table', callback) // replaces realtime

Rules:
- Output ONLY the transformed TypeScript/TSX source code
- No markdown fences, no explanation, no preamble
- Keep all business logic, component structure, and types identical
- Only change imports and cloud API calls
- Import localApi from '@/lib/localApi'
- Remove all cloud SDK imports and env var references`;

    const userPrompt = `Transform this file (${filePath}):\n\n${sourceCode}`;

    const res = await fetch("https://api.anthropic.com/v1/messages", {
      method: "POST",
      headers: {
        "x-api-key": ANTHROPIC_API_KEY!,
        "anthropic-version": "2023-06-01",
        "content-type": "application/json",
      },
      body: JSON.stringify({
        model: MODEL,
        max_tokens: 8192,
        system: systemPrompt,
        messages: [{ role: "user", content: userPrompt }],
      }),
    });

    if (!res.ok) {
      throw new Error(`Claude API ${res.status}: ${await res.text()}`);
    }

    const data = (await res.json()) as {
      content: Array<{ type: string; text: string }>;
    };

    return data.content
      .filter((b) => b.type === "text")
      .map((b) => b.text)
      .join("")
      .replace(/^```(?:typescript|tsx|javascript|jsx)?\n?/m, "")
      .replace(/\n?```$/m, "")
      .trim();
  }

  private diffChanges(original: string, transformed: string): string[] {
    const changes: string[] = ["AI fallback transformer applied"];
    const patterns: Array<[RegExp, string]> = [
      [/supabase\./g,                  "Rewrote Supabase calls"],
      [/firebase\./g,                  "Rewrote Firebase calls"],
      [/@supabase\/supabase-js/g,      "Removed Supabase import"],
      [/firebase\/firestore/g,         "Removed Firestore import"],
      [/@clerk\//g,                    "Removed Clerk import"],
    ];

    for (const [pattern, label] of patterns) {
      const originalCount = (original.match(pattern) ?? []).length;
      const transformedCount = (transformed.match(pattern) ?? []).length;
      if (originalCount > 0 && transformedCount < originalCount) {
        changes.push(label);
      }
    }

    return [...new Set(changes)];
  }
}
