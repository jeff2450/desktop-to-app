#!/usr/bin/env node
/**
 * Copies the hand-crafted Prisma type stub into the installed @prisma/client
 * package so TypeScript can build without running `prisma generate`.
 *
 * Usage: node apps/api/prisma-stub/apply.mjs
 */
import { readFileSync, writeFileSync, existsSync, mkdirSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createRequire } from 'node:module';

const __dirname = dirname(fileURLToPath(import.meta.url));
const require   = createRequire(import.meta.url);

// Resolve @prisma/client location from the monorepo root
let pkgPath;
try {
  const mainEntry = require.resolve('@prisma/client', {
    paths: [resolve(__dirname, '..'), resolve(__dirname, '../../..')]
  });
  pkgPath = dirname(mainEntry);
} catch (err) {
  console.error('❌  @prisma/client not found. Run pnpm install first.', err);
  process.exit(1);
}

const stub       = readFileSync(resolve(__dirname, 'default.d.ts'), 'utf-8');
const targetDir  = resolve(pkgPath, '.prisma', 'client');
const targetFile = resolve(targetDir, 'default.d.ts');
const targetJs   = resolve(targetDir, 'default.js');

mkdirSync(targetDir, { recursive: true });
writeFileSync(targetFile, stub, 'utf-8');
writeFileSync(pkgPath + '/default.d.ts', stub, 'utf-8');

// Minimal JS runtime stub
const jsStub = `"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.Prisma = exports.PrismaClient = exports.JobStatus = exports.Plan = void 0;
exports.Plan = { FREE: 'FREE', STARTER: 'STARTER', PRO: 'PRO' };
exports.JobStatus = { QUEUED: 'QUEUED', RUNNING: 'RUNNING', SUCCESS: 'SUCCESS', FAILED: 'FAILED', CANCELLED: 'CANCELLED' };
class PrismaClient { constructor(_o){} async $connect(){} async $disconnect(){} async $transaction(fn){ return fn(this); } }
exports.PrismaClient = PrismaClient;
exports.Prisma = {};
`;
writeFileSync(targetJs, jsStub, 'utf-8');
writeFileSync(pkgPath + '/default.js', jsStub, 'utf-8');

console.log('✅  Prisma stub applied to:', pkgPath);
console.log('   This satisfies TypeScript without needing prisma generate.');
console.log('   For a production environment, run: npx prisma generate');
