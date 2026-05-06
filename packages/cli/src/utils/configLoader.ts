import path from "node:path";
import fs from "node:fs/promises";
import type { ConversionConfig } from "@webtoapp/core";

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
  const configDir = path.dirname(configPath);

  // Required fields
  requireString(raw, "name");
  requireString(raw, "version");
  requireString(raw, "source");
  requireString(raw, "appId");

  // Resolve source path relative to config file
  const source = path.resolve(configDir, raw["source"] as string);
  const output = raw["output"]
    ? path.resolve(configDir, raw["output"] as string)
    : undefined;

  // Targets
  const targets = validateTargets(raw["targets"]);

  // Backend config
  const backend = validateBackend(raw["backend"]);

  // Auth config
  const auth = validateAuth(raw["auth"]);

  // Database config
  const database = validateDatabase(raw["database"]);

  // Mode
  const rawMode = raw["mode"] ?? "offline";
  const validModes = ["offline", "online", "hybrid"];
  if (!validModes.includes(rawMode as string)) {
    throw new ConfigError(
      `Invalid mode "${rawMode}". Must be one of: ${validModes.join(", ")}`,
      "mode"
    );
  }
  const mode = rawMode as "offline" | "online" | "hybrid";

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
  };
}

function requireString(obj: Record<string, unknown>, field: string): void {
  if (typeof obj[field] !== "string" || !(obj[field] as string).trim()) {
    throw new ConfigError(`Missing required field: "${field}"`, field);
  }
}

function validateTargets(
  raw: unknown
): Array<"windows" | "linux" | "mac"> {
  const valid = ["windows", "linux", "mac"] as const;
  if (!Array.isArray(raw) || raw.length === 0) {
    // Default to current platform
    const platform = process.platform;
    if (platform === "win32") return ["windows"];
    if (platform === "darwin") return ["mac"];
    return ["linux"];
  }
  return raw.map((t) => {
    if (!valid.includes(t as (typeof valid)[number])) {
      throw new ConfigError(
        `Invalid target "${t}". Must be one of: ${valid.join(", ")}`,
        "targets"
      );
    }
    return t as (typeof valid)[number];
  });
}

function validateBackend(
  raw: unknown
): ConversionConfig["backend"] {
  if (!raw || typeof raw !== "object") {
    return { type: "auto", port: 3001 };
  }
  const obj = raw as Record<string, unknown>;
  const type = obj["type"] ?? "auto";
  if (!["auto", "express", "none"].includes(type as string)) {
    throw new ConfigError(
      `Invalid backend.type "${type}". Must be "auto", "express", or "none"`,
      "backend.type"
    );
  }
  return {
    type: type as ConversionConfig["backend"]["type"],
    port: typeof obj["port"] === "number" ? obj["port"] : 3001,
  };
}

function validateAuth(raw: unknown): ConversionConfig["auth"] {
  if (!raw || typeof raw !== "object") {
    return { type: "local" };
  }
  const obj = raw as Record<string, unknown>;
  const type = obj["type"] ?? "local";
  if (!["local", "none"].includes(type as string)) {
    throw new ConfigError(
      `Invalid auth.type "${type}". Must be "local" or "none"`,
      "auth.type"
    );
  }
  return {
    type: type as ConversionConfig["auth"]["type"],
    defaultAdmin: obj["defaultAdmin"] as string | undefined,
  };
}

function validateDatabase(raw: unknown): ConversionConfig["database"] {
  if (!raw || typeof raw !== "object") {
    return { type: "sqlite" };
  }
  const obj = raw as Record<string, unknown>;
  const type = obj["type"] ?? "sqlite";
  if (!["sqlite", "none"].includes(type as string)) {
    throw new ConfigError(
      `Invalid database.type "${type}". Must be "sqlite" or "none"`,
      "database.type"
    );
  }
  return {
    type: type as ConversionConfig["database"]["type"],
    migrations: obj["migrations"] as string | undefined,
  };
}
