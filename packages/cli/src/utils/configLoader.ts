import path from "node:path";
import fs from "node:fs/promises";
import type { ConversionConfig } from "@webtoapp/core";
import Ajv from "ajv";
import addErrors from "ajv-errors";
import { configSchema } from "./configSchema.js";

const CONFIG_FILENAME = "webtoapp.config.json";

export class ConfigError extends Error {
  constructor(
    message: string,
    public readonly field?: string
  ) {
    super(message);
    this.name = "ConfigError";
  }
}

/**
 * Loads and validates a webtoapp.config.json file.
 * Returns a fully resolved ConversionConfig ready to pass to ConversionPipeline.
 */
export async function loadConfig(configPath?: string): Promise<ConversionConfig> {
  const resolvedPath = configPath
    ? path.resolve(configPath)
    : await findConfigFile(process.cwd());

  let raw: Record<string, unknown>;

  try {
    const text = await fs.readFile(resolvedPath, "utf-8");
    raw = JSON.parse(text) as Record<string, unknown>;
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code === "ENOENT") {
      throw new ConfigError(
        `Config file not found: ${resolvedPath}\n` +
          `Run 'webtoapp init' to create one.`
      );
    }
    throw new ConfigError(`Failed to parse ${resolvedPath}: ${(err as Error).message}`);
  }

  return validateConfig(raw, resolvedPath);
}

/**
 * Walk up the directory tree looking for webtoapp.config.json.
 */
async function findConfigFile(startDir: string): Promise<string> {
  let dir = startDir;
  // eslint-disable-next-line no-constant-condition
  while (true) {
    const candidate = path.join(dir, CONFIG_FILENAME);
    try {
      await fs.access(candidate);
      return candidate;
    } catch {
      const parent = path.dirname(dir);
      if (parent === dir) {
        throw new ConfigError(
          `Could not find ${CONFIG_FILENAME} in ${startDir} or any parent directory.\n` +
            `Run 'webtoapp init' to create one.`
        );
      }
      dir = parent;
    }
  }
}

function validateConfig(
  raw: Record<string, unknown>,
  configPath: string
): ConversionConfig {
  const ajv = new Ajv({ allErrors: true });
  addErrors(ajv);

  const validate = ajv.compile(configSchema);
  const valid = validate(raw);

  if (!valid && validate.errors) {
    const error = validate.errors[0]!;
    const fieldPath = error.instancePath || "/";
    throw new ConfigError(
      `Validation error at ${fieldPath}: ${error.message}`,
      fieldPath
    );
  }

  const configDir = path.dirname(configPath);
  const source = path.resolve(configDir, raw["source"] as string);
  const output = raw["output"]
    ? path.resolve(configDir, raw["output"] as string)
    : undefined;

  let targets = raw["targets"] as Array<"windows" | "linux" | "mac" | "android" | "ios"> | undefined;
  if (!targets || targets.length === 0) {
    const platform = process.platform;
    if (platform === "win32") targets = ["windows"];
    else if (platform === "darwin") targets = ["mac"];
    else targets = ["linux"];
  }

  const mode = (raw["mode"] as "offline" | "online" | "hybrid" | undefined) ?? "offline";
  const backendRaw = raw["backend"] as Record<string, unknown> | undefined;
  const backend = {
    type: (backendRaw?.["type"] as "auto" | "express" | "none" | undefined) ?? "auto",
    port: (backendRaw?.["port"] as number | undefined) ?? 3001,
  };

  const authRaw = raw["auth"] as Record<string, unknown> | undefined;
  const auth = {
    type: (authRaw?.["type"] as "local" | "none" | undefined) ?? "local",
    defaultAdmin: authRaw?.["defaultAdmin"] as string | undefined,
  };

  const databaseRaw = raw["database"] as Record<string, unknown> | undefined;
  const database = {
    type: (databaseRaw?.["type"] as "sqlite" | "none" | undefined) ?? "sqlite",
    migrations: databaseRaw?.["migrations"] as string | undefined,
  };

  return {
    name: raw["name"] as string,
    version: raw["version"] as string,
    source,
    output,
    targets,
    mode,
    appId: raw["appId"] as string,
    icon: raw["icon"] as string | undefined,
    backend,
    auth,
    database,
    devTools: raw["devTools"] as boolean | undefined,
    verbose: raw["verbose"] as boolean | undefined,
    dryRun: raw["dryRun"] as boolean | undefined,
    author: raw["author"] as string | undefined,
    resumeFromStage: raw["resumeFromStage"] as string | undefined,
    cleanLogs: raw["cleanLogs"] as boolean | undefined,
  };
}
