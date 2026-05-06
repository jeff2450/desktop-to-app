import type { SourceFile } from "ts-morph";
import { BaseTransformer, type TransformContext, type TransformResult } from "../base/BaseTransformer.js";

/**
 * Rewrites Supabase Realtime channel subscriptions to Server-Sent Events (SSE)
 * connections against the local Express backend.
 *
 * Supabase Realtime:
 *   supabase
 *     .channel('room1')
 *     .on('postgres_changes', { event: '*', schema: 'public', table: 'messages' }, callback)
 *     .subscribe()
 *
 * WebToApp replacement (SSE):
 *   localApi.subscribe('messages', callback)
 *
 * The local Express server exposes GET /api/:table/subscribe as an SSE stream
 * that emits events whenever the SQLite table is mutated by INSERT/UPDATE/DELETE.
 */
export class SupabaseRealtimeTransformer extends BaseTransformer {

  canTransform(content: string): boolean {
    return content.includes(".channel(") && content.includes("subscribe");
  }

  protected async transformSourceFile(
    sourceFile: SourceFile,
    ctx: TransformContext
  ): Promise<Pick<TransformResult, "changes" | "warnings" | "confidence">> {
    const changes: string[] = [];
    const warnings: string[] = [];
    let confidence = 0.78;

    let text = sourceFile.getFullText();

    // Ensure localApi is imported
    if (!text.includes("localApi")) {
      text = `import { localApi } from '@/lib/localApi';\n` + text;
      changes.push("Added localApi import");
    }

    // ── Full channel().on().subscribe() chain ──────────────────────
    // Match the common multi-line pattern:
    // supabase
    //   .channel('name')
    //   .on('postgres_changes', { ..., table: 'tableName' }, callback)
    //   .subscribe()
    const channelChainRe =
      /supabase\s*\n?\s*\.channel\s*\([^)]+\)\s*\n?\s*\.on\s*\(\s*'postgres_changes'\s*,\s*\{[^}]*table\s*:\s*['"`](\w+)['"`][^}]*\}\s*,\s*([^)]+)\)\s*\n?\s*\.subscribe\s*\(\s*\)/g;

    text = text.replace(channelChainRe, (_match, table, callback) => {
      changes.push(`Rewrote Realtime channel for table '${table}' to SSE`);
      return `localApi.subscribe('${table}', ${callback.trim()})`;
    });

    // ── Broadcast channels (non-postgres_changes) ──────────────────
    const broadcastRe =
      /supabase\s*\n?\s*\.channel\s*\([^)]+\)\s*\n?\s*\.on\s*\(\s*'broadcast'[^)]+\)\s*\n?\s*\.subscribe\s*\(\s*\)/g;

    if (broadcastRe.test(text)) {
      text = text.replace(
        broadcastRe,
        `/* WebToApp: broadcast channel removed — use localApi.subscribe() for table changes */`
      );
      warnings.push(
        "Supabase broadcast channels are not supported in offline mode. " +
          "Replaced with a comment — implement custom IPC if needed."
      );
      confidence -= 0.1;
    }

    // ── Presence channels ──────────────────────────────────────────
    if (text.includes(".track(") || text.includes("presence")) {
      warnings.push(
        "Supabase Presence detected. Presence is not available in offline mode — " +
          "these calls will not function in the desktop app."
      );
      confidence -= 0.15;
    }

    // ── removeChannel / unsubscribe cleanup ───────────────────────
    text = text.replace(
      /supabase\.removeChannel\s*\([^)]+\)/g,
      (_match) => {
        changes.push("Rewrote removeChannel to SSE unsubscribe");
        return `localApi.unsubscribe()`;
      }
    );

    const remaining = (text.match(/supabase\.\s*channel\s*\(/g) ?? []).length;
    if (remaining > 0) {
      warnings.push(
        `${remaining} Realtime channel subscription(s) could not be automatically converted. ` +
          "Review these patterns manually."
      );
      confidence -= Math.min(remaining * 0.08, 0.25);
    }

    if (changes.length > 0) {
      sourceFile.replaceWithText(text);
    }

    return { changes, warnings, confidence: Math.max(confidence, 0.4) };
  }
}
