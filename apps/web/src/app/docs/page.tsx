"use client";

import Link from "next/link";
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
  Code
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";

export default function DocsPage() {
  return (
    <div className="min-h-screen bg-zinc-950 text-zinc-300 font-sans selection:bg-indigo-500/30">
      {/* ── Sidebar ── */}
      <aside className="fixed left-0 top-0 w-72 h-full border-r border-zinc-900 bg-zinc-950/50 backdrop-blur-xl hidden lg:block p-8">
        <div className="flex items-center gap-2 mb-12">
          <div className="w-8 h-8 rounded-xl bg-indigo-500 flex items-center justify-center font-bold text-white shadow-[0_0_15px_rgba(99,102,241,0.5)]">
            W
          </div>
          <span className="font-bold text-lg text-white tracking-tight">WebToApp</span>
        </div>

        <div className="space-y-8">
          <section>
            <h4 className="text-xs font-bold uppercase tracking-widest text-zinc-500 mb-4 px-2">Introduction</h4>
            <nav className="space-y-1">
              <SidebarLink active>Getting Started</SidebarLink>
              <SidebarLink>How it Works</SidebarLink>
              <SidebarLink>Architecture</SidebarLink>
            </nav>
          </section>

          <section>
            <h4 className="text-xs font-bold uppercase tracking-widest text-zinc-500 mb-4 px-2">Configuration</h4>
            <nav className="space-y-1">
              <SidebarLink>webtoapp.config.json</SidebarLink>
              <SidebarLink>Environment Variables</SidebarLink>
              <SidebarLink>Advanced Options</SidebarLink>
            </nav>
          </section>

          <section>
            <h4 className="text-xs font-bold uppercase tracking-widest text-zinc-500 mb-4 px-2">Pipeline</h4>
            <nav className="space-y-1">
              <SidebarLink>Detection</SidebarLink>
              <SidebarLink>AST Transformation</SidebarLink>
              <SidebarLink>Scaffolding</SidebarLink>
              <SidebarLink>Packaging</SidebarLink>
            </nav>
          </section>
        </div>
      </aside>

      {/* ── Main Content ── */}
      <main className="lg:ml-72 min-h-screen">
        {/* Header */}
        <header className="sticky top-0 z-40 w-full border-b border-zinc-900 bg-zinc-950/80 backdrop-blur-md px-8 h-16 flex items-center justify-between">
          <div className="flex-1 max-w-md relative">
            <Search className="w-4 h-4 text-zinc-600 absolute left-3 top-1/2 -translate-y-1/2" />
            <Input 
              placeholder="Search documentation..." 
              className="bg-zinc-900/50 border-zinc-800 pl-10 h-9 rounded-lg text-sm focus:ring-indigo-500"
            />
          </div>
          <div className="flex items-center gap-4">
            <Button variant="ghost" size="sm" asChild className="text-zinc-400 hover:text-white">
              <Link href="https://github.com/jeff2450/desktop-to-app" target="_blank" className="flex items-center gap-2">
                GitHub <ExternalLink className="w-3 h-3" />
              </Link>
            </Button>
            <Button size="sm" asChild className="bg-indigo-600 hover:bg-indigo-500 text-white rounded-lg px-4">
              <Link href="/dashboard">Dashboard</Link>
            </Button>
          </div>
        </header>

        <div className="max-w-4xl px-8 py-12 pb-32 mx-auto">
          {/* Breadcrumbs */}
          <div className="flex items-center gap-2 text-xs font-medium text-zinc-500 mb-8 uppercase tracking-widest">
            <span>Introduction</span>
            <ChevronRight className="w-3 h-3" />
            <span className="text-indigo-400">Getting Started</span>
          </div>

          <article className="prose prose-zinc prose-invert max-w-none">
            <h1 className="text-5xl font-black text-white mb-6 tracking-tight leading-tight">
              Documentation
            </h1>
            <p className="text-xl text-zinc-400 mb-12 leading-relaxed">
              Welcome to the WebToApp documentation. Learn how to convert your AI-generated web apps 
              into native, offline-capable desktop applications for Windows, Linux, and macOS.
            </p>

            <div className="grid grid-cols-1 md:grid-cols-2 gap-6 mb-16">
              <DocCard 
                icon={Terminal} 
                title="Quick Start" 
                desc="Get your first app converted in under 60 seconds with our zero-config CLI."
              />
              <DocCard 
                icon={FileJson} 
                title="Configuration" 
                desc="Deep dive into webtoapp.config.json and customize your build pipeline."
              />
            </div>

            <section className="space-y-12">
              <div>
                <h2 className="text-3xl font-bold text-white mb-6 flex items-center gap-3">
                  <div className="w-10 h-10 rounded-xl bg-indigo-500/10 flex items-center justify-center text-indigo-400">
                    <Zap className="w-5 h-5" />
                  </div>
                  Quick Start
                </h2>
                <div className="bg-zinc-900 border border-zinc-800 rounded-2xl p-6 font-mono text-sm overflow-x-auto relative group">
                  <div className="absolute top-4 right-4 opacity-0 group-hover:opacity-100 transition-opacity">
                    <Button variant="ghost" size="sm" className="h-8 w-8 p-0 hover:bg-zinc-800 text-zinc-500">
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

              <div>
                <h2 className="text-3xl font-bold text-white mb-6">Pipeline Architecture</h2>
                <p className="mb-6 leading-relaxed">
                  WebToApp uses a 7-stage pipeline to transform your codebase. Each stage is modular 
                  and can be customized via plugins or the main configuration file.
                </p>
                <div className="space-y-4">
                  {[
                    { id: "01", name: "Detect", desc: "Identifies framework, backend, auth, and database tables." },
                    { id: "02", name: "Plan", desc: "Decides what to transform, copy, and generate based on target platforms." },
                    { id: "03", name: "Transform", desc: "Rewrites cloud SDK calls (Supabase, Firebase) to local API calls via AST." },
                    { id: "04", name: "Scaffold", desc: "Generates Electron main process, backend server, and SQLite database." },
                  ].map(stage => (
                    <div key={stage.id} className="flex items-start gap-6 p-6 bg-zinc-900/50 border border-zinc-800 rounded-2xl hover:border-zinc-700 transition-colors">
                      <div className="text-2xl font-black text-zinc-800 tabular-nums">{stage.id}</div>
                      <div>
                        <h4 className="font-bold text-white mb-1">{stage.name}</h4>
                        <p className="text-sm text-zinc-500">{stage.desc}</p>
                      </div>
                    </div>
                  ))}
                </div>
              </div>

              <div>
                <h2 className="text-3xl font-bold text-white mb-6">Conversion Modes</h2>
                <p className="mb-8 leading-relaxed">
                  Choose the behavior that best fits your application's requirements.
                </p>
                <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
                  <ModeCard 
                    title="Offline" 
                    mode="offline" 
                    desc="Full data isolation. Best for sensitive data apps." 
                    color="text-indigo-400" 
                    bg="bg-indigo-400/10" 
                  />
                  <ModeCard 
                    title="Online" 
                    mode="online" 
                    desc="Pure wrapper around your web app. Always synced." 
                    color="text-cyan-400" 
                    bg="bg-cyan-400/10" 
                  />
                  <ModeCard 
                    title="Hybrid" 
                    mode="hybrid" 
                    desc="Best of both worlds with automatic cloud sync." 
                    color="text-emerald-400" 
                    bg="bg-emerald-400/10" 
                  />
                </div>
              </div>
            </section>
          </article>

          {/* Footer Navigation */}
          <div className="mt-24 pt-12 border-t border-zinc-900 flex justify-between items-center">
            <Link href="/" className="group flex flex-col items-start gap-1">
              <span className="text-[10px] font-bold uppercase tracking-widest text-zinc-600 group-hover:text-zinc-500">Previous</span>
              <span className="text-sm font-bold text-white group-hover:text-indigo-400 transition-colors">Home</span>
            </Link>
            <Link href="/pricing" className="group flex flex-col items-end gap-1 text-right">
              <span className="text-[10px] font-bold uppercase tracking-widest text-zinc-600 group-hover:text-zinc-500">Next</span>
              <span className="text-sm font-bold text-white group-hover:text-indigo-400 transition-colors flex items-center gap-1">
                Pricing <ChevronRight className="w-4 h-4" />
              </span>
            </Link>
          </div>
        </div>
      </main>
    </div>
  );
}

function SidebarLink({ children, active }: any) {
  return (
    <Link 
      href="#" 
      className={cn(
        "flex items-center px-3 py-2 rounded-lg text-sm font-medium transition-all",
        active 
          ? "bg-indigo-600/10 text-indigo-400 font-bold" 
          : "text-zinc-500 hover:text-white hover:bg-zinc-900"
      )}
    >
      {children}
    </Link>
  );
}

function DocCard({ icon: Icon, title, desc }: any) {
  return (
    <Card className="bg-zinc-900/30 border-zinc-800 hover:border-indigo-500/50 transition-all group overflow-hidden">
      <CardContent className="p-6">
        <div className="w-10 h-10 rounded-xl bg-zinc-800 flex items-center justify-center text-zinc-400 mb-4 group-hover:bg-indigo-500/20 group-hover:text-indigo-400 transition-colors">
          <Icon className="w-5 h-5" />
        </div>
        <h3 className="font-bold text-white mb-2">{title}</h3>
        <p className="text-sm text-zinc-500 leading-relaxed">{desc}</p>
      </CardContent>
    </Card>
  );
}

function ModeCard({ title, mode, desc, color, bg }: any) {
  return (
    <div className="bg-zinc-950 border border-zinc-900 p-6 rounded-2xl relative overflow-hidden group">
      <div className={cn("absolute top-0 right-0 px-3 py-1 text-[10px] font-black uppercase tracking-widest rounded-bl-xl", bg, color)}>
        {mode}
      </div>
      <h4 className="font-bold text-white mb-2">{title}</h4>
      <p className="text-xs text-zinc-500 leading-relaxed">{desc}</p>
    </div>
  );
}

function cn(...classes: any[]) {
  return classes.filter(Boolean).join(" ");
}
