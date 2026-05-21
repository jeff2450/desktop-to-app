"use client";

import Link from "next/link";
import { useState } from "react";
import { 
  Book, 
  Terminal, 
  Cpu, 
  FileJson, 
  Layers, 
  Zap, 
  ChevronRight,
  Search,
  ExternalLink,
  Code,
  Settings,
  Key,
  Sliders,
  Eye,
  FileCode,
  FolderGit,
  Box
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";

const SECTIONS = [
  { id: "getting-started", title: "Getting Started", category: "Introduction" },
  { id: "how-it-works", title: "How it Works", category: "Introduction" },
  { id: "architecture", title: "Architecture", category: "Introduction" },
  { id: "config-json", title: "webtoapp.config.json", category: "Configuration" },
  { id: "env-vars", title: "Environment Variables", category: "Configuration" },
  { id: "advanced-options", title: "Advanced Options", category: "Configuration" },
  { id: "detection", title: "Detection", category: "Pipeline" },
  { id: "ast-transform", title: "AST Transformation", category: "Pipeline" },
  { id: "scaffolding", title: "Scaffolding", category: "Pipeline" },
  { id: "packaging", title: "Packaging", category: "Pipeline" }
];

const GROUPS = [
  {
    title: "Introduction",
    items: [
      { id: "getting-started", title: "Getting Started", icon: Terminal },
      { id: "how-it-works", title: "How it Works", icon: Eye },
      { id: "architecture", title: "Architecture", icon: Layers }
    ]
  },
  {
    title: "Configuration",
    items: [
      { id: "config-json", title: "webtoapp.config.json", icon: FileJson },
      { id: "env-vars", title: "Environment Variables", icon: Key },
      { id: "advanced-options", title: "Advanced Options", icon: Sliders }
    ]
  },
  {
    title: "Pipeline",
    items: [
      { id: "detection", title: "Detection", icon: FolderGit },
      { id: "ast-transform", title: "AST Transformation", icon: FileCode },
      { id: "scaffolding", title: "Scaffolding", icon: Cpu },
      { id: "packaging", title: "Packaging", icon: Box }
    ]
  }
];

export default function DocsPage() {
  const [activeSection, setActiveSection] = useState("getting-started");
  const [searchQuery, setSearchQuery] = useState("");

  const currentIdx = SECTIONS.findIndex(s => s.id === activeSection);
  const currentItem = SECTIONS[currentIdx] || SECTIONS[0];
  const prevItem = currentIdx > 0 ? SECTIONS[currentIdx - 1] : null;
  const nextItem = currentIdx < SECTIONS.length - 1 ? SECTIONS[currentIdx + 1] : null;

  // Filter groups and items by search query
  const filteredGroups = GROUPS.map(group => {
    const items = group.items.filter(item => 
      item.title.toLowerCase().includes(searchQuery.toLowerCase())
    );
    return { ...group, items };
  }).filter(group => group.items.length > 0);

  const renderContent = () => {
    switch (activeSection) {
      case "getting-started":
        return (
          <div className="space-y-8 animate-in fade-in duration-300">
            <div>
              <h1 className="text-4xl font-extrabold text-white mb-4 tracking-tight leading-tight">
                Getting Started
              </h1>
              <p className="text-lg text-zinc-400 leading-relaxed">
                Welcome to the WebToApp documentation. Learn how to convert your AI-generated web apps 
                into native, offline-capable desktop applications for Windows, Linux, and macOS.
              </p>
            </div>

            <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
              <DocCard 
                icon={Terminal} 
                title="Quick Start" 
                desc="Get your first app converted in under 60 seconds with our zero-config CLI."
                onClick={() => setActiveSection("how-it-works")}
              />
              <DocCard 
                icon={FileJson} 
                title="Configuration" 
                desc="Deep dive into webtoapp.config.json and customize your build pipeline."
                onClick={() => setActiveSection("config-json")}
              />
            </div>

            <section className="space-y-6">
              <div>
                <h2 className="text-2xl font-bold text-white mb-4 flex items-center gap-3">
                  <div className="w-8 h-8 rounded-lg bg-indigo-500/10 flex items-center justify-center text-indigo-400">
                    <Zap className="w-4 h-4" />
                  </div>
                  Quick Start Command
                </h2>
                <div className="bg-zinc-900 border border-zinc-800 rounded-2xl p-6 font-mono text-sm overflow-x-auto relative group">
                  <div className="absolute top-4 right-4 opacity-0 group-hover:opacity-100 transition-opacity">
                    <Button 
                      type="button"
                      onClick={() => navigator.clipboard.writeText("npx webtoapp init\nnpx webtoapp convert\nnpx webtoapp doctor")}
                      variant="ghost" 
                      size="sm" 
                      className="h-8 w-8 p-0 hover:bg-zinc-800 text-zinc-500"
                    >
                      <Code className="w-4 h-4" />
                    </Button>
                  </div>
                  <div className="text-zinc-500 mb-2"># In your existing web project root:</div>
                  <div className="flex gap-4">
                    <span className="text-zinc-700">1</span>
                    <span className="text-indigo-400">npx</span> <span className="text-zinc-300">webtoapp init</span>
                  </div>
                  <div className="flex gap-4">
                    <span className="text-zinc-700">2</span>
                    <span className="text-indigo-400">npx</span> <span className="text-zinc-300">webtoapp convert</span>
                  </div>
                  <div className="mt-4 text-zinc-500"># Check system dependencies first:</div>
                  <div className="flex gap-4">
                    <span className="text-zinc-700">3</span>
                    <span className="text-indigo-400">npx</span> <span className="text-zinc-300">webtoapp doctor</span>
                  </div>
                </div>
              </div>

              <div className="bg-zinc-900/50 border border-zinc-800 rounded-2xl p-6 flex gap-4 items-start">
                <div className="w-10 h-10 rounded-xl bg-amber-500/10 flex items-center justify-center text-amber-400 flex-shrink-0">
                  <Cpu className="w-5 h-5" />
                </div>
                <div className="space-y-1">
                  <h4 className="font-bold text-white">System Toolchain Requirements</h4>
                  <p className="text-sm text-zinc-400 leading-relaxed">
                    Ensure you have <strong>Node.js &ge; 20</strong> and <strong>pnpm &ge; 9</strong> installed. For full installer compilation, platform-specific build tools like MSVC (Windows), Xcode Tools (macOS), or build-essential (Linux) are required. Run the <code>doctor</code> command to auto-diagnose!
                  </p>
                </div>
              </div>

              <div>
                <h2 className="text-2xl font-bold text-white mb-4">Conversion Modes</h2>
                <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
                  <ModeCard 
                    title="Offline" 
                    mode="offline" 
                    desc="Full data isolation. All queries execute on a local SQLite database. No internet needed." 
                    color="text-indigo-400" 
                    bg="bg-indigo-400/10" 
                  />
                  <ModeCard 
                    title="Online" 
                    mode="online" 
                    desc="Pure desktop wrapper around your web app. Cloud database remains untouched. Always synced." 
                    color="text-cyan-400" 
                    bg="bg-cyan-400/10" 
                  />
                  <ModeCard 
                    title="Hybrid" 
                    mode="hybrid" 
                    desc="Local SQLite database storage with automatic background syncing to cloud when connection is active." 
                    color="text-emerald-400" 
                    bg="bg-emerald-400/10" 
                  />
                </div>
              </div>
            </section>
          </div>
        );

      case "how-it-works":
        return (
          <div className="space-y-8 animate-in fade-in duration-300">
            <div>
              <h1 className="text-4xl font-extrabold text-white mb-4 tracking-tight leading-tight">
                How It Works
              </h1>
              <p className="text-lg text-zinc-400 leading-relaxed">
                WebToApp orchestrates a highly optimized, modular pipeline that transforms your cloud-bound web application codebase into a fully standalone native application in minutes.
              </p>
            </div>

            <div className="border border-zinc-800 bg-zinc-900/20 rounded-2xl p-6 font-mono text-xs overflow-x-auto text-indigo-400">
              <pre>{`Source project (React/Vue + Cloud Backend)
          │
          ▼
   00-preflight ── Validates configuration & system dependencies
   01-detect    ── Identifies frontend framework, auth, & DB tables
   02-plan      ── Creates build plan of files to copy & rewrite
   03-transform ── AST refactoring replacing cloud SDK calls with local REST API
   04-scaffold  ── Generates Electron wrapper, Express server, SQLite DB
   05-install   ── Merges project package.json and installs packages
   06-build     ── Runs production Vite build (patches base path to './')
   07-package   ── Packages native executables using electron-builder
          │
          ▼
   Output: installer.exe / .dmg / .AppImage 🎉`}</pre>
            </div>

            <div className="space-y-4">
              <h2 className="text-2xl font-bold text-white mb-4">Pipeline Stages Explained</h2>
              {[
                { step: "00", name: "Preflight", desc: "Verifies the configuration file structure, checks system requirements (Node/pnpm version), and validates file permissions before any modifications are made." },
                { step: "01", name: "Stack Detection", desc: "Analyzes codebase structure and parses package.json to auto-detect frontend framework (React, Vue), databases, auth providers, and infers schema relational models." },
                { step: "02", name: "Blueprint Planning", desc: "Builds a mapping table outlining exactly which files require rewriting, which templates to copy, and which services must be scaffolded natively." },
                { step: "03", name: "AST Code Transformation", desc: "Applies abstract syntax tree transformations on cloud calls (Supabase/Firebase/Clerk) substituting them with responsive client-side desktop API interfaces." }
              ].map(item => (
                <div key={item.step} className="p-6 bg-zinc-900/30 border border-zinc-800 rounded-xl flex gap-6 items-start hover:border-zinc-700 transition-colors">
                  <div className="text-xl font-bold text-indigo-400 font-mono">{item.step}</div>
                  <div>
                    <h4 className="font-bold text-white mb-1">{item.name}</h4>
                    <p className="text-sm text-zinc-400 leading-relaxed">{item.desc}</p>
                  </div>
                </div>
              ))}
            </div>
          </div>
        );

      case "architecture":
        return (
          <div className="space-y-8 animate-in fade-in duration-300">
            <div>
              <h1 className="text-4xl font-extrabold text-white mb-4 tracking-tight leading-tight">
                Architecture
              </h1>
              <p className="text-lg text-zinc-400 leading-relaxed">
                The WebToApp system uses a modular monorepo structure consisting of isolated core utilities, stack-specific parsers, and packaging utilities.
              </p>
            </div>

            <div className="border border-zinc-800 bg-zinc-900/20 rounded-2xl p-6 font-mono text-xs overflow-x-auto text-indigo-400">
              <pre>{`┌─────────────────────────────────────────────────────────┐
│                     @webtoapp/cli                        │
│   npx webtoapp init | convert | doctor | dev | login    │
└───────────────────────┬─────────────────────────────────┘
                        │
          ┌─────────────▼──────────────┐
          │      @webtoapp/core         │
          │   ConversionPipeline        │
          │   PipelineContext           │
          │   Stages 00 → 07            │
          └──┬──────────┬──────────────┘
             │          │
    ┌────────▼──┐  ┌────▼────────────┐
    │@webtoapp/ │  │  @webtoapp/     │
    │detectors  │  │  transformers   │
    │           │  │                 │
    │ • Supabase│  │ • Supabase      │
    │ • Firebase│  │ • Firebase      │
    │ • Clerk   │  │ • Clerk         │
    │ • Auth0   │  │ • Auth0         │
    │ • Schema  │  │ • Vue / React   │
    └───────────┘  └─────────────────┘
             │
    ┌────────▼──────────┐
    │  @webtoapp/builder  │
    │  Vite + electron- │
    │  builder wrapper  │
    └───────────────────┘`}</pre>
            </div>

            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              {[
                { name: "@webtoapp/cli", desc: "The user-facing CLI package that handles parameters parsing, interactive setup, doctor runs, and server logins." },
                { name: "@webtoapp/core", desc: "The main pipeline orchestrator executing conversion stages step-by-step and maintaining execution context." },
                { name: "@webtoapp/detectors", desc: "Detects active cloud backends, authentication setups, and infers database schemas from frontend queries." },
                { name: "@webtoapp/transformers", desc: "Babel-powered AST code rewrite engine that parses client scripts and swaps cloud client calls to local APIs." },
                { name: "@webtoapp/builder", desc: "Vite build hooks optimizer and packaging engine powered by electron-builder." },
                { name: "SaaS Layer", desc: "Apps directory hosting the SaaS Express conversion queue server and the Next.js interactive billing & projects dashboard." }
              ].map((item, idx) => (
                <div key={idx} className="p-5 bg-zinc-900/30 border border-zinc-800 rounded-xl hover:border-indigo-500/20 transition-colors">
                  <h4 className="font-mono font-bold text-white mb-2 text-sm flex items-center gap-2">
                    <span className="w-2 h-2 rounded-full bg-indigo-500"></span>
                    {item.name}
                  </h4>
                  <p className="text-xs text-zinc-400 leading-relaxed">{item.desc}</p>
                </div>
              ))}
            </div>
          </div>
        );

      case "config-json":
        return (
          <div className="space-y-8 animate-in fade-in duration-300">
            <div>
              <h1 className="text-4xl font-extrabold text-white mb-4 tracking-tight leading-tight">
                webtoapp.config.json
              </h1>
              <p className="text-lg text-zinc-400 leading-relaxed">
                Configure your application name, targets, conversion strategy, and internal network parameters inside the root configurations schema.
              </p>
            </div>

            <div className="bg-zinc-950 border border-zinc-900 rounded-2xl p-6 font-mono text-sm overflow-x-auto text-zinc-300">
              <pre>{`{
  "name": "My Desktop App",
  "version": "1.0.0",
  "appId": "com.example.myapp",
  "source": ".",
  "mode": "offline",
  "targets": ["windows", "linux"],
  "backend": { 
    "type": "auto", 
    "port": 3001 
  },
  "auth": { 
    "type": "local", 
    "defaultAdmin": "admin@app.local" 
  },
  "database": { 
    "type": "sqlite" 
  }
}`}</pre>
            </div>

            <div className="overflow-x-auto border border-zinc-800 rounded-2xl bg-zinc-900/10">
              <table className="w-full text-left border-collapse text-sm">
                <thead>
                  <tr className="border-b border-zinc-800 text-zinc-400 font-semibold bg-zinc-900/40">
                    <th className="p-4">Key</th>
                    <th className="p-4">Type</th>
                    <th className="p-4">Required</th>
                    <th className="p-4">Default</th>
                    <th className="p-4">Description</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-zinc-900 text-zinc-400">
                  {[
                    { key: "name", type: "string", req: "Yes", def: "-", desc: "User-facing title used in headers and installer wizard UI." },
                    { key: "version", type: "string", req: "Yes", def: "1.0.0", desc: "SemVer representation of application releases." },
                    { key: "appId", type: "string", req: "Yes", def: "-", desc: "Reverse domain package ID (e.g. com.company.appname)." },
                    { key: "mode", type: "string", req: "Yes", def: "offline", desc: "Network paradigm strategy: offline, online, or hybrid." },
                    { key: "targets", type: "string[]", req: "Yes", def: "['windows']", desc: "Target OS platforms (windows, linux, mac)." },
                    { key: "backend.port", type: "number", req: "No", def: "3001", desc: "Internal port bindings for scaffolded API routers." }
                  ].map(row => (
                    <tr key={row.key} className="hover:bg-zinc-900/20">
                      <td className="p-4 font-mono font-semibold text-white">{row.key}</td>
                      <td className="p-4 font-mono text-indigo-400 text-xs">{row.type}</td>
                      <td className="p-4 text-xs font-semibold text-emerald-500">{row.req}</td>
                      <td className="p-4 font-mono text-zinc-500 text-xs">{row.def}</td>
                      <td className="p-4 text-zinc-450 text-xs leading-relaxed">{row.desc}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        );

      case "env-vars":
        return (
          <div className="space-y-8 animate-in fade-in duration-300">
            <div>
              <h1 className="text-4xl font-extrabold text-white mb-4 tracking-tight leading-tight">
                Environment Variables
              </h1>
              <p className="text-lg text-zinc-400 leading-relaxed">
                Configure SaaS database connection URLs, Redis servers, Stripe API credentials, and email SMTP parameters in development.
              </p>
            </div>

            <div className="bg-zinc-950 border border-zinc-900 rounded-2xl p-6 font-mono text-sm overflow-x-auto text-zinc-400">
              <pre>{`# ── Database Connection URL
DATABASE_URL=postgresql://webtoapp:secret@localhost:5432/webtoapp

# ── Redis Server URL
REDIS_URL=redis://localhost:6379

# ── JWT Signatures Secrets
JWT_ACCESS_SECRET=change_me_access_secret_at_least_32_chars_long
JWT_REFRESH_SECRET=change_me_refresh_secret_at_least_32_chars_long

# ── Gateway Integration
STRIPE_SECRET_KEY=sk_test_...
STRIPE_WEBHOOK_SECRET=whsec_...
STRIPE_PRICE_STARTER=price_...
STRIPE_PRICE_PRO=price_...

# ── SMTP (Optional Email support)
SMTP_HOST=smtp.example.com
SMTP_PORT=587
SMTP_USER=billing@webtoapp.dev
SMTP_PASS=some_secure_password`}</pre>
            </div>

            <div className="p-6 bg-amber-500/5 border border-amber-500/20 rounded-2xl">
              <h4 className="font-bold text-amber-400 mb-1 flex items-center gap-2">
                <Sliders className="w-4 h-4" /> Environment Scopes
              </h4>
              <p className="text-sm text-zinc-400 leading-relaxed">
                These variables configure the global monorepo cloud server layer. Local desktop builds generate standalone SQLite databases and embedded API ports, completely isolated from cloud environment settings.
              </p>
            </div>
          </div>
        );

      case "advanced-options":
        return (
          <div className="space-y-8 animate-in fade-in duration-300">
            <div>
              <h1 className="text-4xl font-extrabold text-white mb-4 tracking-tight leading-tight">
                Advanced Options
              </h1>
              <p className="text-lg text-zinc-400 leading-relaxed">
                Unlock control over compiler flags, debug verbose logging, dynamic AST warning level limits, and multi-architecture builder configurations.
              </p>
            </div>

            <div className="space-y-4">
              <h2 className="text-2xl font-bold text-white mb-4">CLI Flag Overrides</h2>
              {[
                { flag: "--mode [offline|online|hybrid]", desc: "Directly overrides the network conversion paradigm specified in webtoapp.config.json during runtime pipeline convert commands." },
                { flag: "--verbose", desc: "Spins up verbose output detailing parsing metrics, file write triggers, native build streams, and raw AST warnings." },
                { flag: "--dry-run", desc: "Simulates step pipeline sequences (00 to 03) analyzing dependencies and generating planned schema blueprints without modifying actual codebase scripts." },
                { flag: "--platform [windows|linux|mac]", desc: "Restricts builds compilation targets to the current host computer, cutting compilation durations during local testing." }
              ].map(item => (
                <div key={item.flag} className="p-5 bg-zinc-900/30 border border-zinc-800 rounded-xl hover:border-zinc-700 transition-colors">
                  <span className="font-mono font-bold text-indigo-400 text-sm block mb-1">{item.flag}</span>
                  <p className="text-xs text-zinc-400 leading-relaxed">{item.desc}</p>
                </div>
              ))}
            </div>
          </div>
        );

      case "detection":
        return (
          <div className="space-y-8 animate-in fade-in duration-300">
            <div>
              <h1 className="text-4xl font-extrabold text-white mb-4 tracking-tight leading-tight">
                Detection Engine
              </h1>
              <p className="text-lg text-zinc-400 leading-relaxed">
                WebToApp scans dependencies and code syntax structures to establish what libraries, authentication keys, and schemas the application relies on.
              </p>
            </div>

            <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
              {[
                { title: "AST Dependency Scanning", desc: "Imports package.json dependencies and parses JS/TS files to detect client initializations (e.g. Supabase, Firebase, Clerk, Auth0)." },
                { title: "Database Schema Inference", desc: "Locates database query structures to dynamically reconstruct tables, foreign key links, and data types in the local SQLite schema." },
                { title: "LLM Heuristics Fallback", desc: "Leverages a locally-scoped lightweight AI heuristic model to interpret dynamic cloud queries if static AST parsing proves inconclusive." }
              ].map((item, idx) => (
                <div key={idx} className="p-5 bg-zinc-900/40 border border-zinc-800 rounded-xl">
                  <h4 className="font-bold text-white mb-2 text-sm">{item.title}</h4>
                  <p className="text-xs text-zinc-400 leading-relaxed">{item.desc}</p>
                </div>
              ))}
            </div>

            <div className="bg-indigo-500/5 border border-indigo-500/20 rounded-2xl p-6">
              <h4 className="font-bold text-indigo-450 mb-2 flex items-center gap-2">
                <FolderGit className="w-4 h-4" /> Output Reports
              </h4>
              <p className="text-sm text-zinc-400 leading-relaxed">
                Upon finishing step 01, the detector outputs a localized manifest detailing every discovered endpoint, schema, and API library. This manifest feeds the planners and AST code transformation stages.
              </p>
            </div>
          </div>
        );

      case "ast-transform":
        return (
          <div className="space-y-8 animate-in fade-in duration-300">
            <div>
              <h1 className="text-4xl font-extrabold text-white mb-4 tracking-tight leading-tight">
                AST Transformation
              </h1>
              <p className="text-lg text-zinc-400 leading-relaxed">
                WebToApp performs low-level code mutations on Javascript syntax structures, substituting remote network queries with offline endpoints.
              </p>
            </div>

            <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
              <div className="p-5 bg-zinc-900/30 border border-red-500/10 rounded-2xl">
                <div className="text-xs text-red-400 font-bold uppercase tracking-wider mb-2">Original Cloud Script</div>
                <pre className="font-mono text-xs text-zinc-450 leading-relaxed">
{`const { data, error } = await supabase
  .from('appointments')
  .select('*')
  .eq('status', 'confirmed');`}
                </pre>
              </div>
              <div className="p-5 bg-zinc-900/30 border border-emerald-500/10 rounded-2xl">
                <div className="text-xs text-emerald-400 font-bold uppercase tracking-wider mb-2">AST Transformed Script</div>
                <pre className="font-mono text-xs text-zinc-400 leading-relaxed">
{`const data = await window.desktopAPI
  .query('appointments', {
    where: { status: 'confirmed' }
  });`}
                </pre>
              </div>
            </div>

            <div className="p-6 bg-zinc-900/50 border border-zinc-800 rounded-2xl space-y-3">
              <h4 className="font-bold text-white">How Code Mutation Executes Safely</h4>
              <p className="text-sm text-zinc-400 leading-relaxed">
                WebToApp loads your client JS/TS files using Babel. The AST parser traverses through the node tree, targeting specific imports and cloud client instantiations. Instead of doing simple string replacement (which often causes compilation errors), Babel restructures the query expressions dynamically, assuring safe build results.
              </p>
            </div>
          </div>
        );

      case "scaffolding":
        return (
          <div className="space-y-8 animate-in fade-in duration-300">
            <div>
              <h1 className="text-4xl font-extrabold text-white mb-4 tracking-tight leading-tight">
                Scaffolding
              </h1>
              <p className="text-lg text-zinc-400 leading-relaxed">
                The scaffolding module compiles standalone native infrastructure files, building lightweight database models and native wrapper APIs.
              </p>
            </div>

            <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
              {[
                { title: "Electron Scaffold", desc: "Generates custom window layouts, custom file protocols, IPC bridge channels, and secure sandbox configurations." },
                { title: "Local Express Server", desc: "Injects standard Express routes matched against identified schemas to support offline GET/POST/PUT/DELETE interactions." },
                { title: "SQLite Database", desc: "Initializes local sqlite storage files, generates database table models, compiles migrations, and seeds defaults admin credentials." }
              ].map((item, idx) => (
                <div key={idx} className="p-5 bg-zinc-900/40 border border-zinc-800 rounded-xl hover:border-indigo-500/20 transition-colors">
                  <h4 className="font-bold text-white mb-2 text-sm">{item.title}</h4>
                  <p className="text-xs text-zinc-450 leading-relaxed">{item.desc}</p>
                </div>
              ))}
            </div>
          </div>
        );

      case "packaging":
        return (
          <div className="space-y-8 animate-in fade-in duration-300">
            <div>
              <h1 className="text-4xl font-extrabold text-white mb-4 tracking-tight leading-tight">
                Packaging
              </h1>
              <p className="text-lg text-zinc-400 leading-relaxed">
                Compiles web pages with base path adjustments and packages native bundles powered by electron-builder.
              </p>
            </div>

            <div className="p-6 bg-zinc-900/40 border border-zinc-800 rounded-2xl flex gap-4 items-start">
              <div className="w-10 h-10 rounded-xl bg-indigo-500/10 flex items-center justify-center text-indigo-400 flex-shrink-0">
                <Code className="w-5 h-5" />
              </div>
              <div className="space-y-1">
                <h4 className="font-bold text-white">Vite Base Directory Pathing Patch</h4>
                <p className="text-sm text-zinc-400 leading-relaxed">
                  WebToApp intercepts standard Vite compilation processes, patching compile base setups to relative (<code>base: "./"</code>) inside `vite.config.ts`. This ensures static css, js, and image elements load correctly across native Electron protocols.
                </p>
              </div>
            </div>

            <h2 className="text-2xl font-bold text-white mb-4">Native Installer Outputs</h2>
            <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
              {[
                { title: "Windows", ext: ".exe (NSIS Installer)", desc: "Builds a standalone, offline install executable package complete with desktop shortcuts and auto-updating protocols." },
                { title: "Linux", ext: ".AppImage / .deb / .rpm", desc: "Packages dependencies into standard AppImage files or native distributions package installers." },
                { title: "macOS", ext: ".dmg / .app", desc: "Generates Apple Disk Image installers and setups configured for standard host application folders." }
              ].map((item, idx) => (
                <div key={idx} className="p-5 bg-zinc-900/30 border border-zinc-800 rounded-xl">
                  <h4 className="font-bold text-white mb-1 text-sm">{item.title}</h4>
                  <span className="font-mono text-xs text-indigo-400 block mb-2">{item.ext}</span>
                  <p className="text-xs text-zinc-450 leading-relaxed">{item.desc}</p>
                </div>
              ))}
            </div>
          </div>
        );

      default:
        return null;
    }
  };

  return (
    <div className="min-h-screen bg-zinc-950 text-zinc-300 font-sans selection:bg-indigo-500/30">
      {/* ── Sidebar ── */}
      <aside className="fixed left-0 top-0 w-72 h-full border-r border-zinc-900 bg-zinc-950/50 backdrop-blur-xl hidden lg:block p-8 overflow-y-auto">
        <Link href="/" className="flex items-center gap-2 mb-12 hover:opacity-80 transition-opacity">
          <div className="w-8 h-8 rounded-xl bg-indigo-500 flex items-center justify-center font-bold text-white shadow-[0_0_15px_rgba(99,102,241,0.5)]">
            W
          </div>
          <span className="font-bold text-lg text-white tracking-tight">WebToApp</span>
        </Link>

        <div className="space-y-8">
          {filteredGroups.map((group, groupIdx) => (
            <section key={groupIdx}>
              <h4 className="text-xs font-bold uppercase tracking-widest text-zinc-500 mb-4 px-2">
                {group.title}
              </h4>
              <nav className="space-y-1">
                {group.items.map((item) => {
                  const Icon = item.icon;
                  const active = activeSection === item.id;
                  return (
                    <button
                      key={item.id}
                      onClick={() => setActiveSection(item.id)}
                      className={cn(
                        "w-full flex items-center gap-3 px-3 py-2.5 rounded-lg text-sm font-medium transition-all text-left",
                        active 
                          ? "bg-indigo-650/15 text-indigo-400 font-semibold border-l-2 border-indigo-500 bg-indigo-500/5" 
                          : "text-zinc-500 hover:text-white hover:bg-zinc-900/50"
                      )}
                    >
                      <Icon className={cn("w-4 h-4", active ? "text-indigo-400" : "text-zinc-650")} />
                      {item.title}
                    </button>
                  );
                })}
              </nav>
            </section>
          ))}
        </div>
      </aside>

      {/* ── Main Content ── */}
      <main className="lg:ml-72 min-h-screen flex flex-col">
        {/* Header */}
        <header className="sticky top-0 z-40 w-full border-b border-zinc-900 bg-zinc-950/80 backdrop-blur-md px-8 h-16 flex items-center justify-between">
          <div className="flex-1 max-w-md relative">
            <Search className="w-4 h-4 text-zinc-650 absolute left-3 top-1/2 -translate-y-1/2" />
            <Input 
              placeholder="Search documentation..." 
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              className="bg-zinc-900/50 border-zinc-800 pl-10 h-9 rounded-lg text-sm focus:ring-indigo-500 text-white placeholder-zinc-500"
            />
          </div>
          <div className="flex items-center gap-4">
            <Button variant="ghost" size="sm" asChild className="text-zinc-400 hover:text-white">
              <Link href="https://github.com/jeff2450/desktop-to-app" target="_blank" className="flex items-center gap-2">
                GitHub <ExternalLink className="w-3 h-3" />
              </Link>
            </Button>
            <Button size="sm" asChild className="bg-indigo-600 hover:bg-indigo-500 text-white rounded-lg px-4 font-medium transition-all">
              <Link href="/dashboard">Dashboard</Link>
            </Button>
          </div>
        </header>

        <div className="max-w-4xl px-8 py-12 pb-32 mx-auto w-full flex-1">
          {/* Breadcrumbs */}
          <div className="flex items-center gap-2 text-[10px] font-bold text-zinc-500 mb-8 uppercase tracking-widest">
            <span>{currentItem.category}</span>
            <ChevronRight className="w-3 h-3 text-zinc-700" />
            <span className="text-indigo-400">{currentItem.title}</span>
          </div>

          <article className="prose prose-zinc prose-invert max-w-none">
            {renderContent()}
          </article>

          {/* Footer Navigation */}
          <div className="mt-24 pt-12 border-t border-zinc-900 flex justify-between items-center">
            {prevItem ? (
              <button 
                onClick={() => setActiveSection(prevItem.id)}
                className="group flex flex-col items-start gap-1 text-left"
              >
                <span className="text-[10px] font-bold uppercase tracking-widest text-zinc-600 group-hover:text-zinc-500">Previous</span>
                <span className="text-sm font-bold text-white group-hover:text-indigo-400 transition-colors">
                  {prevItem.title}
                </span>
              </button>
            ) : (
              <Link href="/" className="group flex flex-col items-start gap-1">
                <span className="text-[10px] font-bold uppercase tracking-widest text-zinc-600 group-hover:text-zinc-500">Previous</span>
                <span className="text-sm font-bold text-white group-hover:text-indigo-400 transition-colors">Home</span>
              </Link>
            )}

            {nextItem ? (
              <button 
                onClick={() => setActiveSection(nextItem.id)}
                className="group flex flex-col items-end gap-1 text-right"
              >
                <span className="text-[10px] font-bold uppercase tracking-widest text-zinc-600 group-hover:text-zinc-500">Next</span>
                <span className="text-sm font-bold text-white group-hover:text-indigo-400 transition-colors flex items-center gap-1">
                  {nextItem.title} <ChevronRight className="w-4 h-4 transition-transform group-hover:translate-x-1" />
                </span>
              </button>
            ) : (
              <Link href="/pricing" className="group flex flex-col items-end gap-1 text-right">
                <span className="text-[10px] font-bold uppercase tracking-widest text-zinc-600 group-hover:text-zinc-500">Next</span>
                <span className="text-sm font-bold text-white group-hover:text-indigo-400 transition-colors flex items-center gap-1">
                  Pricing <ChevronRight className="w-4 h-4 transition-transform group-hover:translate-x-1" />
                </span>
              </Link>
            )}
          </div>
        </div>
      </main>
    </div>
  );
}

function DocCard({ icon: Icon, title, desc, onClick }: any) {
  return (
    <Card 
      onClick={onClick}
      className="bg-zinc-900/35 border-zinc-850 hover:border-indigo-500/50 hover:bg-zinc-900/50 transition-all group overflow-hidden cursor-pointer"
    >
      <CardContent className="p-6">
        <div className="w-10 h-10 rounded-xl bg-zinc-800 flex items-center justify-center text-zinc-400 mb-4 group-hover:bg-indigo-500/20 group-hover:text-indigo-400 transition-colors">
          <Icon className="w-5 h-5" />
        </div>
        <h3 className="font-bold text-white mb-2">{title}</h3>
        <p className="text-sm text-zinc-450 leading-relaxed">{desc}</p>
      </CardContent>
    </Card>
  );
}

function ModeCard({ title, mode, desc, color, bg }: any) {
  return (
    <div className="bg-zinc-950 border border-zinc-850 p-6 rounded-2xl relative overflow-hidden group">
      <div className={cn("absolute top-0 right-0 px-3 py-1 text-[10px] font-black uppercase tracking-widest rounded-bl-xl", bg, color)}>
        {mode}
      </div>
      <h4 className="font-bold text-white mb-2">{title}</h4>
      <p className="text-xs text-zinc-450 leading-relaxed">{desc}</p>
    </div>
  );
}

function cn(...classes: any[]) {
  return classes.filter(Boolean).join(" ");
}
