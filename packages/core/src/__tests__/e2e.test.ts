import { describe, it, expect, beforeEach, afterEach } from "vitest";
import * as path from "node:path";
import * as fs from "node:fs/promises";
import * as os from "node:os";
import { ConversionPipeline } from "../pipeline/ConversionPipeline.js";

// Determine if we should run this slow E2E test.
// It is opt-in so normal unit-test runs stay fast, including CI unit tests.
const shouldRun = process.env.RUN_E2E_TEST === "true";
const smokeIt = shouldRun ? it : it.skip;

const INSTALLER_EXTENSIONS = [".exe", ".appimage", ".dmg"] as const;

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

  // Set the timeout to 15 minutes because npm install + electron-builder packaging is slow.
  smokeIt(
    "feeds a tiny React+Supabase fixture through the full pipeline and produces a native installer",
    { timeout: 900000 },
    async () => {
      console.log(`Starting E2E test.`);
      console.log(`Source: ${sourceDir}`);
      console.log(`Output: ${outputDir}`);

      await createReactSupabaseFixture(sourceDir);

      // 2. Initialize the pipeline targeting the native platform of the environment
      const currentPlatform = currentDesktopTarget();

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

      // Assert the pipeline surfaced an installer path and that the file exists.
      expect(result.installerPath).toBeDefined();
      expect(typeof result.installerPath).toBe("string");

      const installerExists = await fs
        .stat(result.installerPath!)
        .then((s) => s.isFile())
        .catch(() => false);

      expect(installerExists).toBe(true);

      const installerArtifacts = await findInstallerArtifacts(path.join(outputDir, "release"));
      const artifactExtensions = installerArtifacts.map((artifactPath) =>
        path.extname(artifactPath).toLowerCase()
      );

      if (currentPlatform === "windows") {
        expect(artifactExtensions).toContain(".exe");
      } else if (currentPlatform === "linux") {
        expect(artifactExtensions).toContain(".appimage");
      } else if (currentPlatform === "mac") {
        expect(artifactExtensions).toContain(".dmg");
      }

      expect(
        artifactExtensions.some((extension) =>
          INSTALLER_EXTENSIONS.includes(extension as (typeof INSTALLER_EXTENSIONS)[number])
        )
      ).toBe(true);

      console.log(`Generated installer: ${result.installerPath}`);
      console.log(`Release artifacts: ${installerArtifacts.join(", ")}`);
    }
  );
});

function currentDesktopTarget(): "windows" | "linux" | "mac" {
  if (process.platform === "win32") return "windows";
  if (process.platform === "darwin") return "mac";
  return "linux";
}

async function createReactSupabaseFixture(rootDir: string): Promise<void> {
  await fs.mkdir(path.join(rootDir, "src"), { recursive: true });
  await fs.mkdir(path.join(rootDir, "supabase", "migrations"), { recursive: true });

  await fs.writeFile(
    path.join(rootDir, "package.json"),
    JSON.stringify(
      {
        name: "e2e-test-app",
        version: "1.0.0",
        author: "E2E Test Runner",
        dependencies: {
          "@supabase/supabase-js": "^2.39.0",
          react: "^18.2.0",
          "react-dom": "^18.2.0",
        },
        devDependencies: {
          "@vitejs/plugin-react": "^4.2.0",
          typescript: "^5.0.0",
          vite: "^5.0.0",
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

  await fs.writeFile(
    path.join(rootDir, "index.html"),
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

  await fs.writeFile(
    path.join(rootDir, "tsconfig.json"),
    JSON.stringify(
      {
        compilerOptions: {
          baseUrl: ".",
          paths: {
            "@/*": ["./src/*"],
          },
        },
      },
      null,
      2
    ),
    "utf-8"
  );

  await fs.writeFile(
    path.join(rootDir, "supabase", "migrations", "0001_todos.sql"),
    `create table todos (
  id integer primary key,
  title text not null,
  complete boolean not null default false
);
`,
    "utf-8"
  );

  await fs.writeFile(
    path.join(rootDir, "src/main.tsx"),
    `import React from "react";
import ReactDOM from "react-dom/client";
import { createClient } from "@supabase/supabase-js";

const supabase = createClient("https://xyz.supabase.co", "anonKey");

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
);
`,
    "utf-8"
  );
}

async function findInstallerArtifacts(releaseDir: string): Promise<string[]> {
  const artifacts: string[] = [];
  const entries = await fs.readdir(releaseDir, { withFileTypes: true }).catch(() => []);

  for (const entry of entries) {
    const entryPath = path.join(releaseDir, entry.name);
    if (entry.isDirectory()) {
      const nestedArtifacts = await findInstallerArtifacts(entryPath);
      artifacts.push(...nestedArtifacts);
      continue;
    }

    const extension = path.extname(entry.name).toLowerCase();
    if (INSTALLER_EXTENSIONS.includes(extension as (typeof INSTALLER_EXTENSIONS)[number])) {
      artifacts.push(entryPath);
    }
  }

  return artifacts;
}
