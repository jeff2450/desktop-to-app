const fs = require('fs');
const path = require('path');

const targets = [
  // Root directories
  'node_modules',
  '.turbo',
  
  // Apps directories
  'apps/api/node_modules',
  'apps/api/dist',
  'apps/api/.turbo',
  'apps/web/node_modules',
  'apps/web/.next',
  'apps/web/.turbo',

  // Packages directories
  'packages/builder/node_modules',
  'packages/builder/dist',
  'packages/builder/.turbo',
  'packages/cli/node_modules',
  'packages/cli/dist',
  'packages/cli/.turbo',
  'packages/core/node_modules',
  'packages/core/dist',
  'packages/core/.turbo',
  'packages/detectors/node_modules',
  'packages/detectors/dist',
  'packages/detectors/.turbo',
  'packages/mobile/node_modules',
  'packages/mobile/dist',
  'packages/mobile/.turbo',
  'packages/templates/node_modules',
  'packages/templates/dist',
  'packages/templates/.turbo',
  'packages/transformers/node_modules',
  'packages/transformers/dist',
  'packages/transformers/.turbo',
];

console.log('Starting cleanup...');

for (const target of targets) {
  const fullPath = path.resolve(__dirname, target);
  if (fs.existsSync(fullPath)) {
    try {
      console.log(`Removing: ${target}`);
      fs.rmSync(fullPath, { recursive: true, force: true });
    } catch (error) {
      console.error(`Failed to remove ${target}:`, error.message);
    }
  }
}

console.log('Cleanup completed successfully.');
