import { describe, it, expect, beforeEach, afterEach } from "vitest";
import * as path from "node:path";
import * as fs from "node:fs/promises";
import * as os from "node:os";
import { ConversionPipeline } from "../pipeline/ConversionPipeline.js";

// Determine if we should run this slow E2E test.
// Skips locally by default to keep vitest fast.
const shouldRun = process.env.CI === "true" || process.env.RUN_E2E_TEST === "true";

describe("E2E / Smoke Test - Conversion Pipeline", () => {
  let sourceDir: string;
  let outputDir: string;

  beforeEach(async () => {
    // Generate fresh temporary folders
    sourceDir = await fs.mkdtemp(path.join(os.tmpdir(), "webtoapp-e2e-src-"));
    outputDir = await fs.mkdtemp(path.join(os.tmpdir(), "webtoapp-e2e-out-"));
  });

  afterEach(async () => {
    // Clean up temporary folders
    await Promise.all(
      [sourceDir, outputDir].map((d) =>
        fs.rm(d, { recursive: true, force: true, maxRetries: 5 }).catch(() => {})
      )
    );
  });

  // Set the timeout to 10 minutes (600,000 ms) because npm install + electron-builder compilation is slow.
  it(
    "should feed a tiny React+Supabase fixture through the full pipeline and produce a native desktop package",
    { timeout: 600000 },
    async () => {
      if (!shouldRun) {
        console.log("Skipping E2E test (neither CI nor RUN_E2E_TEST=true is set).");
        return;
      }

      console.log(`Starting E2E test.`);
      console.log(`Source: ${sourceDir}`);
      console.log(`Output: ${outputDir}`);

      // 1. Create a tiny, valid React + Supabase project structure.
      await fs.mkdir(path.join(sourceDir, "src"), { recursive: true });

      // package.json
      await fs.writeFile(
        path.join(sourceDir, "package.json"),
        JSON.stringify(
          {
            name: "e2e-test-app",
            version: "1.0.0",
            author: "E2E Test Runner",
            dependencies: {
              react: "^18.2.0",
              "react-dom": "^18.2.0",
              "@supabase/supabase-js": "^2.39.0",
            },
            devDependencies: {
              vite: "^5.0.0",
              "@vitejs/plugin-react": "^4.2.0",
              typescript: "^5.0.0",
            },
            scripts: {
              build: "vite build",
            },
          },
          null,
          2
        ),
        "utf-8"
      );

      // index.html
      await fs.writeFile(
        path.join(sourceDir, "index.html"),
        `<!DOCTYPE html>
<html>
  <head>
    <meta charset="utf-8" />
    <title>E2E App</title>
  </head>
  <body>
    <div id="root"></div>
    <script type="module" src="/src/main.tsx"></script>
  </body>
</html>`,
        "utf-8"
      );

      // src/main.tsx
      await fs.writeFile(
        path.join(sourceDir, "src/main.tsx"),
        `import React from "react";
import ReactDOM from "react-dom/client";
import { createClient } from "@supabase/supabase-js";

// Supabase client creation
const supabase = createClient("https://xyz.supabase.co", "anonKey");

// Query that triggers table detection for "todos"
const fetchTodos = async () => {
  const { data } = await supabase.from("todos").select("*");
  console.log("todos:", data);
};

const App = () => {
  React.useEffect(() => {
    fetchTodos();
  }, []);

  return (
    <div>
      <h1>WebToApp E2E Test</h1>
    </div>
  );
};

ReactDOM.createRoot(document.getElementById("root")!).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>
);`,
        "utf-8"
      );

      // 2. Initialize the pipeline targeting the native platform of the environment
      const currentPlatform =
        process.platform === "win32"
          ? "windows"
          : process.platform === "darwin"
          ? "mac"
          : "linux";

      console.log(`E2E native build target: ${currentPlatform}`);

      const pipeline = new ConversionPipeline({
        name: "E2E Test App",
        version: "1.0.0",
        source: sourceDir,
        output: outputDir,
        targets: [currentPlatform],
        mode: "offline",
        appId: "com.webtoapp.e2etest",
        author: "E2E Test Runner",
        backend: {
          type: "auto",
          port: 3009,
        },
        auth: {
          type: "local",
        },
        database: {
          type: "sqlite",
        },
      });

      // 3. Run the pipeline
      const result = await pipeline.run();

      // Log pipeline errors/status if failed
      if (result.status !== "success") {
        console.error("Pipeline run failed. Results:", JSON.stringify(result, null, 2));
      }

      // Assert status is success
      expect(result.status).toBe("success");

      // Assert installer was generated
      expect(result.installerPath).toBeDefined();
      expect(typeof result.installerPath).toBe("string");

      const installerExists = await fs
        .stat(result.installerPath!)
        .then((s) => s.isFile())
        .catch(() => false);

      expect(installerExists).toBe(true);

      // Verify file extension based on platform
      const ext = path.extname(result.installerPath!).toLowerCase();
      console.log(`Generated installer: ${result.installerPath}`);

      if (currentPlatform === "windows") {
        expect(ext).toBe(".exe");
      } else if (currentPlatform === "linux") {
        // AppImage, deb, snap etc.
        expect([".appimage", ".deb", ".snap", ".rpm"]).toContain(ext);
      } else if (currentPlatform === "mac") {
        expect([".dmg", ".zip", ".pkg"]).toContain(ext);
      }
    }
  );
});
