import AjvModule from "ajv";
import addFormats from "ajv-formats";

const Ajv = (AjvModule as any).default || AjvModule;
const addFormatsFn = (addFormats as any).default || addFormats;

import { type ValidateFunction } from "ajv";
import { createRequire } from "node:module";
import { fileURLToPath } from "node:url";
import path from "node:path";
import type { ConversionConfig } from "../types/ConversionConfig.js";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// ── Schema loading ────────────────────────────────────────────────────────────

let _validate: ValidateFunction | null = null;

function getValidator(): ValidateFunction {
  if (_validate) return _validate;

  const ajv = new Ajv({ allErrors: true, strict: false });
  addFormatsFn(ajv);

  // Load the schema from the repo root (relative to this compiled file)
  // Handles both ts-node and compiled JS layouts
  let schema: object;
  try {
    const require = createRequire(import.meta.url);
    // Walk up from packages/core/dist/... to repo root
    const schemaPath = path.resolve(__dirname, "../../../../webtoapp.config.schema.json");
    schema = require(schemaPath) as object;
  } catch {
    // Fallback: inline minimal schema so the pipeline still runs
    schema = { type: "object", required: ["name", "version", "source", "targets", "mode", "appId"] };
  }

  _validate = ajv.compile(schema);
  return _validate!;
}

// ── Public API ────────────────────────────────────────────────────────────────

export interface ValidationError {
  path: string;
  message: string;
}

export interface ValidationResult {
  valid: boolean;
  errors: ValidationError[];
}

/**
 * Validates a ConversionConfig against the JSON schema.
 *
 * Returns { valid: true } on success, or { valid: false, errors } with
 * human-readable messages on failure.
 *
 * Called at the start of the pipeline (Stage 00) so bad configs fail fast
 * with a clear validation error.
 * error rather than a cryptic failure three minutes later.
 */
export function validateConfig(config: unknown): ValidationResult {
  const validate = getValidator();
  const valid = validate(config) as boolean;

  if (valid) {
    return { valid: true, errors: [] };
  }

  const errors: ValidationError[] = (validate.errors ?? []).map((err) => {
    const instancePath = err.instancePath || "(root)";
    const friendlyPath = instancePath.replace(/^\//, "").replace(/\//g, ".");

    let message = err.message ?? "Unknown validation error";

    // Make enum errors clearer
    if (err.keyword === "enum" && err.params?.allowedValues) {
      message = `must be one of: ${(err.params.allowedValues as string[]).join(", ")}`;
    }

    // Make pattern errors clearer
    if (err.keyword === "pattern") {
      if (instancePath.includes("appId")) {
        message = `must be a reverse-domain identifier (e.g. "com.example.myapp")`;
      } else if (instancePath.includes("version")) {
        message = `must be a semantic version string (e.g. "1.0.0")`;
      }
    }

    // Required field errors
    if (err.keyword === "required") {
      const missing = err.params?.missingProperty as string;
      return {
        path: friendlyPath === "(root)" ? missing : `${friendlyPath}.${missing}`,
        message: `is required`,
      };
    }

    return { path: friendlyPath, message };
  });

  return { valid: false, errors };
}

/**
 * Validates config and throws a formatted error if invalid.
 * This is the main entry point — call from Stage 00.
 */
export function assertValidConfig(config: unknown): asserts config is ConversionConfig {
  const result = validateConfig(config);
  if (result.valid) return;

  const lines = result.errors.map((e) => `  • ${e.path}: ${e.message}`);
  throw new Error(
    `Invalid webtoapp.config.json:\n${lines.join("\n")}\n\n` +
    `Add "$schema": "https://webtoapp.dev/config.schema.json" to your config file for VS Code autocomplete.`
  );
}
