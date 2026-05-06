#!/usr/bin/env node
/**
 * WebToApp CLI — npx webtoapp
 *
 * This is the executable entry point. It simply imports the compiled
 * TypeScript CLI and lets Commander handle argument parsing.
 *
 * Usage:
 *   npx webtoapp init
 *   npx webtoapp convert
 *   npx webtoapp convert --target windows linux --verbose
 *   npx webtoapp login
 *   npx webtoapp doctor
 */
import "../dist/index.js";
