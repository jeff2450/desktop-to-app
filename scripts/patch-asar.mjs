/**
 * patch-asar.mjs
 * Extracts app.asar, overlays the fixed dist/ and electron/ files, then repacks.
 * Run from the desktop-to-app workspace root:
 *   node scripts/patch-asar.mjs
 */
import { createRequire } from 'node:module';
import path from 'node:path';
import fs from 'node:fs/promises';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const require = createRequire(import.meta.url);

const APP_DIR = 'C:/Users/JEFF-PC/Desktop/multilingual-note-genius-desktop';
const ASAR_PATH = `${APP_DIR}/release/win-unpacked/resources/app.asar`;
const EXTRACT_DIR = `${APP_DIR}/release/win-unpacked/resources/app-extracted`;
const BACKUP_ASAR = `${APP_DIR}/release/win-unpacked/resources/app.asar.bak`;

// Use the local @electron/asar from the app's node_modules
const asarModule = `${APP_DIR}/node_modules/@electron/asar`;
const asar = require(asarModule);

async function copyDir(src, dest) {
  await fs.mkdir(dest, { recursive: true });
  const entries = await fs.readdir(src, { withFileTypes: true });
  for (const e of entries) {
    const s = path.join(src, e.name);
    const d = path.join(dest, e.name);
    if (e.isDirectory()) {
      await copyDir(s, d);
    } else {
      await fs.copyFile(s, d);
    }
  }
}

async function main() {
  console.log('📦 Patching app.asar for VoiceScribe...\n');

  // 1. Backup original asar
  console.log('1. Backing up original app.asar...');
  await fs.copyFile(ASAR_PATH, BACKUP_ASAR);
  console.log(`   → Backed up to app.asar.bak\n`);

  // 2. Extract asar
  console.log('2. Extracting app.asar...');
  await fs.rm(EXTRACT_DIR, { recursive: true, force: true });
  asar.extractAll(ASAR_PATH, EXTRACT_DIR);
  console.log(`   → Extracted to ${EXTRACT_DIR}\n`);

  // 3. Overlay dist/ with the freshly built files
  console.log('3. Overlaying fixed dist/...');
  const srcDist = `${APP_DIR}/dist`;
  const destDist = `${EXTRACT_DIR}/dist`;
  await fs.rm(destDist, { recursive: true, force: true });
  await copyDir(srcDist, destDist);
  console.log(`   → Replaced dist/ with fresh Vite build\n`);

  // 4. Replace electron/main.cjs with the patched version
  console.log('4. Replacing electron/main.cjs...');
  await fs.copyFile(
    `${APP_DIR}/electron/main.cjs`,
    `${EXTRACT_DIR}/electron/main.cjs`
  );
  console.log(`   → Replaced electron/main.cjs\n`);

  // 5. Repack back to app.asar
  console.log('5. Repacking app.asar...');
  await asar.createPackage(EXTRACT_DIR, ASAR_PATH);
  console.log(`   → Repacked successfully!\n`);

  // 6. Clean up extracted directory
  await fs.rm(EXTRACT_DIR, { recursive: true, force: true });

  console.log('✅ app.asar patched! Launch the app:');
  console.log(`   "${APP_DIR}/release/win-unpacked/app.exe"\n`);
}

main().catch(err => {
  console.error('❌ Error:', err);
  process.exit(1);
});
