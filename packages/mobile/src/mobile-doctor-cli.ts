/**
 * Mobile doctor checks for the CLI.
 *
 * Usage in your existing CLI doctor command:
 *
 *   import { runMobileDoctor } from './mobile-doctor.js';
 *   runMobileDoctor(['android', 'ios']);
 *
 * Or add --android / --ios flags to `npx webtoapp doctor`.
 */

import chalk from 'chalk';
import { checkAndroid, checkIos, DoctorResult } from './index.js';

export function runMobileDoctor(platforms: Array<'android' | 'ios'> = ['android']): boolean {
  let allReady = true;

  for (const platform of platforms) {
    const result: DoctorResult =
      platform === 'android' ? checkAndroid() : checkIos();

    const header = platform === 'android' ? '📱  Android' : '🍎  iOS';
    console.log(`\n${chalk.bold(header)} environment check:`);
    console.log('─'.repeat(50));

    for (const check of result.checks) {
      if (check.passed) {
        console.log(chalk.green(`  ✓  ${check.name}`) + chalk.gray(`  — ${check.message}`));
      } else if (check.required) {
        console.log(chalk.red(`  ✗  ${check.name}`) + chalk.yellow(`  — ${check.message}`));
        allReady = false;
      } else {
        console.log(chalk.yellow(`  ⚠  ${check.name}`) + chalk.gray(`  — ${check.message}`));
      }
    }

    const status = result.ready
      ? chalk.green.bold(`\n  ${platform} is ready ✓`)
      : chalk.red.bold(`\n  ${platform} is NOT ready ✗`);
    console.log(status);
  }

  return allReady;
}

// ─── Standalone CLI entrypoint ────────────────────────────────────────────────
// Run: node dist/mobile-doctor.js [android] [ios]
if (process.argv[1]?.endsWith('mobile-doctor.js') || process.argv[1]?.endsWith('mobile-doctor')) {
  const args = process.argv.slice(2);
  const platforms = (args.length > 0 ? args : ['android']) as Array<'android' | 'ios'>;
  const ready = runMobileDoctor(platforms);
  process.exit(ready ? 0 : 1);
}
