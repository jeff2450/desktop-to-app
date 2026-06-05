import type { PipelineContext } from "../PipelineContext.js";
import type { MigrationPlan } from "../../types/MigrationPlan.js";
import {
  CONCURRENTLY_VERSION,
  ELECTRON_UPDATER_VERSION,
  ELECTRON_VERSION,
  WAIT_ON_VERSION,
} from "../../config/versions.js";

const STAGE = "02-plan";

/**
 * Stage 02 - Plan
 *
 * WebToApp now supports online conversions only. The source app is copied
 * verbatim and wrapped in Electron while keeping the original cloud backend.
 */
export async function runPlanStage(ctx: PipelineContext): Promise<void> {
  ctx.startStage(STAGE);

  if (!ctx.detection) {
    const err = new Error("Detection result missing - stage 01 must run first");
    ctx.failStage(STAGE, err);
    throw err;
  }

  ctx.log("info", "Conversion mode: online", STAGE);

  try {
    const plan = buildMigrationPlan(ctx);
    ctx.plan = plan;

    ctx.log("info", `Files to transform: ${plan.filesToTransform.length}`, STAGE);
    ctx.log("info", `Files to copy:      ${plan.filesToCopy.length}`, STAGE);
    ctx.log("info", `Files to generate:  ${plan.filesToGenerate.length}`, STAGE);
    ctx.log("info", `Deps to add:        ${Object.keys(plan.dependenciesToAdd).join(", ")}`, STAGE);
    ctx.log("info", `Deps to remove:     ${plan.dependenciesToRemove.join(", ") || "none"}`, STAGE);
    ctx.log("info", plan.summary, STAGE);

    ctx.completeStage(STAGE);
  } catch (err) {
    const error = err instanceof Error ? err : new Error(String(err));
    ctx.failStage(STAGE, error);
    throw error;
  }
}

function buildMigrationPlan(ctx: PipelineContext): MigrationPlan {
  const detection = ctx.detection!;

  if (detection.isLiveUrl) {
    const dependenciesToAdd: Record<string, string> = {
      electron: ELECTRON_VERSION,
      "electron-updater": ELECTRON_UPDATER_VERSION,
      concurrently: CONCURRENTLY_VERSION,
      "wait-on": WAIT_ON_VERSION,
      react: "^18.3.1",
      "react-dom": "^18.3.1",
      vite: "^5.4.2",
      "@vitejs/plugin-react": "^4.3.1",
    };

    const filesToGenerate: MigrationPlan["filesToGenerate"] = [
      {
        outputPath: "index.html",
        generatorType: "online-iframe-index" as any,
        templateVars: {
          appName: ctx.config.name,
        },
      },
      {
        outputPath: "src/App.jsx",
        generatorType: "online-iframe-app" as any,
        templateVars: {
          liveUrl: ctx.config.source,
        },
      },
      {
        outputPath: "src/main.jsx",
        generatorType: "online-iframe-main" as any,
        templateVars: {},
      },
      {
        outputPath: "electron/main.cjs",
        generatorType: "electron-main",
        templateVars: {
          appName: ctx.config.name,
          devPort: 5173,
          backendPort: 0,
          onlineMode: true,
        },
      },
      {
        outputPath: "electron/preload.cjs",
        generatorType: "electron-preload",
        templateVars: {},
      },
      {
        outputPath: "electron-builder.yml",
        generatorType: "electron-builder-config",
        templateVars: {
          appId: ctx.config.appId,
          appName: ctx.config.name,
          version: ctx.config.version,
          targets: ctx.config.targets,
          icon: ctx.config.icon ?? "assets/icon.png",
        },
      },
    ];

    if (ctx.config.targets.includes("mac")) {
      filesToGenerate.push({
        outputPath: "build/entitlements.mac.plist",
        generatorType: "mac-entitlements",
        templateVars: {},
      });
    }

    return {
      filesToTransform: [],
      filesToCopy: [],
      filesToDelete: [],
      filesToGenerate,
      dependenciesToAdd,
      dependenciesToRemove: [],
      scriptsToInject: {
        "electron:dev": "concurrently \"vite\" \"wait-on tcp:5173 && electron .\"",
        "electron:build": `vite build && electron-builder --${
          process.platform === "win32"
            ? "win"
            : process.platform === "darwin"
              ? "mac"
              : "linux"
        }`,
        "electron:build:all": "vite build && electron-builder",
      },
      summary: `Online mode - wrapping live website ${ctx.config.source} in Electron app.`,
    };
  }

  const filesToCopy = detection.scannedFiles.map((filePath) => ctx.relative(filePath));

  const dependenciesToAdd: Record<string, string> = {
    electron: ELECTRON_VERSION,
    "electron-updater": ELECTRON_UPDATER_VERSION,
    concurrently: CONCURRENTLY_VERSION,
    "wait-on": WAIT_ON_VERSION,
    vite: "^5.4.2",
  };

  const filesToGenerate: MigrationPlan["filesToGenerate"] = [
    {
      outputPath: "electron/main.cjs",
      generatorType: "electron-main",
      templateVars: {
        appName: ctx.config.name,
        devPort: detection.bundler === "vite" ? 5173 : 3000,
        backendPort: 0,
        onlineMode: true,
      },
    },
    {
      outputPath: "electron/preload.cjs",
      generatorType: "electron-preload",
      templateVars: {},
    },
    {
      outputPath: "electron-builder.yml",
      generatorType: "electron-builder-config",
      templateVars: {
        appId: ctx.config.appId,
        appName: ctx.config.name,
        version: ctx.config.version,
        targets: ctx.config.targets,
        icon: ctx.config.icon ?? "assets/icon.png",
      },
    },
  ];

  if (ctx.config.targets.includes("mac")) {
    filesToGenerate.push({
      outputPath: "build/entitlements.mac.plist",
      generatorType: "mac-entitlements",
      templateVars: {},
    });
  }

  return {
    filesToTransform: [],
    filesToCopy,
    filesToDelete: [],
    filesToGenerate,
    dependenciesToAdd,
    dependenciesToRemove: [],
    scriptsToInject: {
      "electron:dev": "concurrently \"vite\" \"wait-on tcp:5173 && electron .\"",
      "electron:build": `vite build && electron-builder --${
        process.platform === "win32"
          ? "win"
          : process.platform === "darwin"
            ? "mac"
            : "linux"
      }`,
      "electron:build:all": "vite build && electron-builder",
    },
    summary: "Online mode - Electron wrapper only. Cloud backend kept as-is. Internet required.",
  };
}
