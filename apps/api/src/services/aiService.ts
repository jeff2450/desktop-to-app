const ANTHROPIC_API_KEY = process.env["ANTHROPIC_API_KEY"];
const MODEL = "claude-sonnet-4-20250514";
const MAX_TOKENS = 8192;

export interface AiTransformResult {
  transformedCode: string;
  changes: string[];
  confidence: number;
  tokensUsed: number;
}

export interface AiPlanResult {
  summary: string;
  recommendations: string[];
  warnings: string[];
}

/**
 * AI service — wraps the Anthropic Claude API for:
 *
 *  1. AiFallbackTransformer: rewrites complex cloud SDK files that the
 *     AST transformers couldn't handle with high confidence.
 *
 *  2. Migration plan enrichment: generates natural-language summaries
 *     and human-readable recommendations for the conversion report.
 *
 *  3. Error explanation: turns cryptic build errors into actionable
 *     suggestions for the user.
 */
export class AiService {
  private isAvailable(): boolean {
    return Boolean(ANTHROPIC_API_KEY);
  }

  // ── Code transformation ──────────────────────────────────────────────────────

  /**
   * Rewrite a source file to replace cloud SDK calls with local API equivalents.
   *
   * Used by AiFallbackTransformer for files that scored below 0.8 confidence
   * in the AST-based transformers (complex query chains, dynamic table names, etc.)
   */
  async transformFile(params: {
    sourceCode: string;
    filePath: string;
    backend: string;
    auth: string;
    localApiPort: number;
  }): Promise<AiTransformResult> {
    if (!this.isAvailable()) {
      return {
        transformedCode: params.sourceCode,
        changes: [],
        confidence: 0,
        tokensUsed: 0,
      };
    }

    const { sourceCode, filePath, backend, auth, localApiPort } = params;

    const systemPrompt = `You are an expert TypeScript/React developer specialising in migrating web apps from cloud backends to offline desktop apps.

Your task: rewrite source files to replace ${backend} cloud SDK calls with calls to a local Express REST API running on port ${localApiPort}.

Rules:
- Keep all business logic, UI code, and component structure EXACTLY the same
- Only change imports and API calls
- Replace all ${backend} client calls with equivalent fetch() calls to http://127.0.0.1:${localApiPort}/api/
- Replace auth (${auth}) with calls to /api/auth/login, /api/auth/me, /api/auth/register
- Remove cloud-specific imports and env variable references (SUPABASE_URL, FIREBASE_CONFIG, etc.)
- Preserve all TypeScript types — adjust them to match the local API response shape { data, error }
- Output ONLY the transformed TypeScript/TSX code with no explanation, no markdown fences, no preamble`;

    const userPrompt = `Transform this file (${filePath}):\n\n${sourceCode}`;

    const response = await this.callApi(systemPrompt, userPrompt);

    // Extract changes by diffing original vs transformed (simple line-count heuristic)
    const originalLines = sourceCode.split("\n").length;
    const transformedLines = response.content.split("\n").length;
    const changes = this.detectChanges(sourceCode, response.content, backend);

    return {
      transformedCode: response.content,
      changes,
      confidence: changes.length > 0 ? 0.85 : 0.5,
      tokensUsed: response.tokensUsed,
    };
  }

  // ── Plan enrichment ──────────────────────────────────────────────────────────

  /**
   * Generate a human-readable conversion plan summary from the detection result.
   * Shown to users in the dashboard before the conversion starts.
   */
  async enrichPlan(params: {
    framework: string;
    backend: string;
    auth: string;
    tables: string[];
    fileCount: number;
    transformCount: number;
  }): Promise<AiPlanResult> {
    if (!this.isAvailable()) {
      return {
        summary: `Converting ${params.framework} + ${params.backend} app to desktop`,
        recommendations: [],
        warnings: [],
      };
    }

    const prompt = `A user is converting a ${params.framework} web app that uses ${params.backend} as its backend and ${params.auth} for authentication.

The project has:
- ${params.fileCount} source files
- ${params.transformCount} files that need cloud SDK rewriting
- ${params.tables.length} database tables: ${params.tables.join(", ") || "none detected"}

Write a brief 2-sentence summary of what WebToApp will do, followed by up to 3 specific recommendations for this project, and up to 2 warnings if relevant.

Respond ONLY with valid JSON in this exact shape:
{
  "summary": "string",
  "recommendations": ["string", "string"],
  "warnings": ["string"]
}`;

    try {
      const response = await this.callApi(
        "You are a helpful assistant that outputs only valid JSON.",
        prompt
      );
      const parsed = JSON.parse(response.content) as AiPlanResult;
      return parsed;
    } catch {
      return {
        summary: `Converting ${params.framework} + ${params.backend} app with ${params.tables.length} tables to a standalone desktop app.`,
        recommendations: [],
        warnings: [],
      };
    }
  }

  // ── Error explanation ────────────────────────────────────────────────────────

  /**
   * Turn a cryptic build error into plain English with actionable steps.
   * Shown in the dashboard when a conversion fails.
   */
  async explainError(params: {
    errorMessage: string;
    stage: string;
    framework: string;
    backend: string;
  }): Promise<string> {
    if (!this.isAvailable()) return params.errorMessage;

    const prompt = `A ${params.framework} + ${params.backend} app failed during the "${params.stage}" stage of desktop conversion with this error:

${params.errorMessage}

Write a plain English explanation (2-3 sentences) of what went wrong and the most likely fix. Be specific and actionable. Do not repeat the raw error.`;

    try {
      const response = await this.callApi(
        "You are a helpful developer assistant. Respond concisely and practically.",
        prompt
      );
      return response.content.trim();
    } catch {
      return params.errorMessage;
    }
  }

  // ── Core API call ────────────────────────────────────────────────────────────

  private async callApi(
    systemPrompt: string,
    userPrompt: string
  ): Promise<{ content: string; tokensUsed: number }> {
    if (!ANTHROPIC_API_KEY) {
      throw new Error("ANTHROPIC_API_KEY is not configured");
    }

    const res = await fetch("https://api.anthropic.com/v1/messages", {
      method: "POST",
      headers: {
        "x-api-key": ANTHROPIC_API_KEY,
        "anthropic-version": "2023-06-01",
        "content-type": "application/json",
      },
      body: JSON.stringify({
        model: MODEL,
        max_tokens: MAX_TOKENS,
        system: systemPrompt,
        messages: [{ role: "user", content: userPrompt }],
      }),
    });

    if (!res.ok) {
      const body = await res.text();
      throw new Error(`Anthropic API error ${res.status}: ${body}`);
    }

    const data = (await res.json()) as {
      content: Array<{ type: string; text: string }>;
      usage: { input_tokens: number; output_tokens: number };
    };

    const content = data.content
      .filter((b) => b.type === "text")
      .map((b) => b.text)
      .join("");

    return {
      content,
      tokensUsed: (data.usage.input_tokens ?? 0) + (data.usage.output_tokens ?? 0),
    };
  }

  // ── Helpers ──────────────────────────────────────────────────────────────────

  private detectChanges(original: string, transformed: string, backend: string): string[] {
    const changes: string[] = [];

    if (!original.includes(transformed.slice(0, 50))) {
      changes.push(`Rewrote ${backend} SDK imports`);
    }

    const patterns = [
      [/supabase\.from\(/g,     "Rewrote Supabase query calls"],
      [/supabase\.auth\./g,     "Rewrote Supabase auth calls"],
      [/firebase\./g,           "Rewrote Firebase calls"],
      [/getFirestore\(/g,       "Rewrote Firestore calls"],
      [/useUser\(\)/g,          "Rewrote Clerk useUser hook"],
      [/getDoc\(/g,             "Rewrote Firestore getDoc calls"],
    ] as const;

    for (const [pattern, description] of patterns) {
      const originalCount = (original.match(pattern) ?? []).length;
      const transformedCount = (transformed.match(pattern) ?? []).length;
      if (originalCount > 0 && transformedCount < originalCount) {
        changes.push(description);
      }
    }

    return [...new Set(changes)];
  }
}

export const aiService = new AiService();
