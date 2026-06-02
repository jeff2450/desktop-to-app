export const configSchema = {
  type: "object",
  required: ["name", "version", "source", "appId"],
  properties: {
    name: { type: "string", minLength: 1 },
    version: { type: "string", minLength: 1 },
    source: { type: "string", minLength: 1 },
    output: { type: "string" },
    targets: {
      type: "array",
      items: { type: "string", enum: ["windows", "linux", "mac", "android", "ios"] },
      minItems: 1
    },
    mode: { type: "string", enum: ["online"] },
    appId: { type: "string", minLength: 1 },
    icon: { type: "string" },
    backend: {
      type: "object",
      properties: {
        type: { type: "string", enum: ["auto", "express", "none"] },
        port: { type: "number" }
      },
      additionalProperties: false
    },
    auth: {
      type: "object",
      properties: {
        type: { type: "string", enum: ["local", "none"] },
        defaultAdmin: { type: "string" }
      },
      additionalProperties: false
    },
    database: {
      type: "object",
      properties: {
        type: { type: "string", enum: ["sqlite", "none"] },
        migrations: { type: "string" }
      },
      additionalProperties: false
    },
    devTools: { type: "boolean" },
    verbose: { type: "boolean" },
    dryRun: { type: "boolean" },
    author: { type: "string" },
    resumeFromStage: { type: "string" },
    cleanLogs: { type: "boolean" },
    behaviorParity: { type: "string", enum: ["strict", "warn", "off"] },
    mobile: {
      type: "object",
      properties: {
        webDir: { type: "string", minLength: 1 },
        android: {
          type: "object",
          properties: {
            minSdkVersion: { type: "number" },
            targetSdkVersion: { type: "number" },
            buildVariant: { type: "string", enum: ["debug", "release"] },
            artifactType: { type: "string", enum: ["apk", "aab"] },
            keystorePath: { type: "string" },
            keystoreAlias: { type: "string" },
            keystorePassword: { type: "string" },
            keystoreAliasPassword: { type: "string" }
          },
          additionalProperties: false
        },
        ios: {
          type: "object",
          properties: {
            deploymentTarget: { type: "string" },
            developmentTeam: { type: "string" }
          },
          additionalProperties: false
        }
      },
      additionalProperties: false
    }
  },
  additionalProperties: false
};
