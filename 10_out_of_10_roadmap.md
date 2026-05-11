# WebToApp: Roadmap to a 10/10 System

This document outlines the missing components and architectural upgrades required to transform the current WebToApp conversion pipeline into a "10 out of 10" enterprise-ready platform.

---

## 🛡️ Phase 1: Bulletproof Reliability (The Foundation)

### 1. Unified Test Suite (Unit + Integration + E2E)
Currently, verification is manual. A 10/10 system requires:
- **Unit Tests:** For every stage logic (e.g., test `01-detect` against 50 different `package.json` variants).
- **Integration Tests:** Run the pipeline against "Golden Sample" projects (React/Vite, Vue/Webpack, etc.).
- **E2E Tests:** Use Playwright/Cypress to launch the *converted* app and verify the local SQLite database actually works.

### 2. AST-Based Code Transformation
Replace fragile Regex patching in `03-transform.ts` and `06-build.ts` with **Babel/TypeScript AST**.
- **Benefit:** Safe removal of imports and JSX even in complex, multi-line, or obfuscated code. 
- **Implementation:** Use `@babel/traverse` to find and prune specific nodes without affecting the rest of the file syntax.

### 3. Config Schema Validation (Fail-Fast)
Implement **JSON Schema** validation for `webtoapp.config.json` using **AJV**.
- **Benefit:** Users get VS Code autocomplete/validation, and the pipeline crashes immediately with a "line 4: mode must be one of [online, offline, hybrid]" error instead of failing 3 minutes in.

---

## 🧠 Phase 2: Advanced Automation (The "Magic")

### 4. AI-Enhanced Fallback Transformer
Complete the `ai` transformer stub in `packages/transformers`.
- **Logic:** If the detector confidence is low (e.g., a complex custom SQL query), send the code block to an LLM (Gemini/Claude) with a specific prompt: *"Rewrite this Supabase query to use our local fetch() API."*

### 5. Supabase RLS to Local Middleware Migration
Automatically convert Supabase Row Level Security (RLS) policies into Express middleware.
- **Example:** If a table has `auth.uid() = user_id`, generate an Express route that automatically appends `WHERE user_id = ?` using the JWT session.

### 6. Intelligent Schema Migration
Instead of simple `TEXT` columns, perform deep type inference.
- **Implementation:** Parse Postgres `enum` types and convert them to SQLite `CHECK` constraints. Map Postgres `timestamptz` to proper SQLite ISO strings with trigger-based auto-updates.

---

## 🛠️ Phase 3: Developer Experience (The "Wow" Factor)

### 7. Integrated Watch Mode (`webtoapp dev`)
A single command that orchestrates:
- `vite` for the frontend.
- `nodemon` for the generated local backend.
- `electron` pointing to the dev server.
- **Result:** Instant hot-reload inside the Electron window as you edit your web source code.

### 8. Migration Health Report (HTML)
Generate a beautiful `webtoapp-report.html` at the end of every run.
- **Content:** Diff views of every changed file, a list of "High Risk" files that need manual review, and a status dashboard for the generated backend.

### 9. Headless CLI & Plugin System
Allow the community to write custom transformers.
- **Example:** A `webtoapp-plugin-firebase-storage` that handles specific blob upload patterns.

---

## 🚀 The "10/10" Checklist Summary

| Component | Status | Priority |
|-----------|--------|----------|
| **Multi-stage Pipeline** | ✅ Done | - |
| **Backup & Rollback** | ✅ Done | - |
| **Pre-flight Checks** | ✅ Done | - |
| **AST Transformation** | ❌ Missing | 🔥 High |
| **JSON Schema Validation** | ❌ Missing | 🔥 High |
| **Automated Test Suite** | ❌ Missing | 🔥 High |
| **AI Fallback Logic** | ❌ Missing | 🟡 Med |
| **RLS → Middleware** | ❌ Missing | 🟡 Med |
| **Intelligent Schema Migration** | ❌ Missing | 🟡 Med |
| **Dev Watch Mode** | ❌ Missing | 🟢 Low |
| **Migration Health Report** | ❌ Missing | 🟢 Low |
| **Headless CLI & Plugin System** | ❌ Missing | 🟢 Low |

---

## Conclusion
The core of the system is already powerful. By shifting from **"Pattern Patching"** (Regex) to **"Structural Analysis"** (AST + Schema Validation) and adding a **Robust Testing Layer**, WebToApp will achieve the reliability required for production-level desktop application deployment.
