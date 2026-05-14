import Link from "next/link";
import { ArrowRight, Terminal, GitBranch as Github, Package, Download } from "lucide-react";

export default function LandingPage() {
  return (
    <div className="min-h-screen bg-zinc-950 text-zinc-50 overflow-hidden">
      {/* ── Navbar ── */}
      <header className="fixed top-0 w-full z-50 border-b border-white/5 bg-zinc-950/80 backdrop-blur-md">
        <div className="container mx-auto px-6 h-16 flex items-center justify-between">
          <div className="flex items-center gap-2">
            <div className="w-8 h-8 rounded-xl bg-indigo-500 flex items-center justify-center font-bold text-white shadow-[0_0_15px_rgba(99,102,241,0.5)]">
              W
            </div>
            <span className="font-semibold text-lg tracking-tight">WebToApp</span>
          </div>
          <nav className="hidden md:flex items-center gap-8 text-sm font-medium text-zinc-400">
            <Link href="#how-it-works" className="hover:text-white transition-colors">How it works</Link>
            <Link href="#pricing" className="hover:text-white transition-colors">Pricing</Link>
            <Link href="https://docs.webtoapp.dev" className="hover:text-white transition-colors">Docs</Link>
          </nav>
          <div className="flex items-center gap-4">
            <Link href="/login" className="text-sm font-medium hover:text-indigo-400 transition-colors">
              Sign in
            </Link>
            <Link href="/register" className="text-sm font-medium bg-indigo-600 hover:bg-indigo-500 px-4 py-2 rounded-lg transition-all shadow-[0_0_20px_rgba(99,102,241,0.3)] hover:shadow-[0_0_25px_rgba(99,102,241,0.5)]">
              Get Started
            </Link>
          </div>
        </div>
      </header>

      <main className="pt-32 pb-24">
        {/* ── Hero Section ── */}
        <section className="container mx-auto px-6 grid lg:grid-cols-2 gap-16 items-center">
          <div className="max-w-2xl relative z-10">
            <div className="absolute -top-24 -left-24 w-96 h-96 bg-indigo-600/20 rounded-full blur-[120px] pointer-events-none" />
            <h1 className="text-5xl md:text-6xl font-bold leading-tight tracking-tight mb-6">
              Convert your AI-generated web app into a desktop app in <span className="text-transparent bg-clip-text bg-gradient-to-r from-indigo-400 to-cyan-400">60 seconds</span>.
            </h1>
            <p className="text-lg text-zinc-400 mb-10 leading-relaxed max-w-xl">
              Turn your React, Vue, Next.js, and Supabase projects into native, offline-capable 
              desktop apps for Windows, macOS, and Linux automatically. Zero config required.
            </p>
            <div className="flex flex-col sm:flex-row gap-4">
              <Link href="/register" className="flex items-center justify-center gap-2 bg-indigo-600 hover:bg-indigo-500 text-white px-8 py-4 rounded-xl font-medium transition-all shadow-[0_0_20px_rgba(99,102,241,0.3)] hover:shadow-[0_0_30px_rgba(99,102,241,0.5)]">
                Start for free <ArrowRight className="w-4 h-4" />
              </Link>
              <Link href="https://docs.webtoapp.dev" className="flex items-center justify-center gap-2 bg-zinc-900 border border-zinc-800 hover:bg-zinc-800 text-white px-8 py-4 rounded-xl font-medium transition-colors">
                View documentation
              </Link>
            </div>
          </div>

          <div className="relative group perspective">
            <div className="absolute inset-0 bg-gradient-to-r from-indigo-500 to-cyan-500 rounded-2xl opacity-20 blur-2xl group-hover:opacity-30 transition-opacity duration-500" />
            <div className="relative bg-zinc-950 border border-zinc-800 rounded-2xl overflow-hidden shadow-2xl transform transition-transform duration-500 hover:scale-[1.02] hover:-rotate-1">
              <div className="flex items-center gap-2 px-4 py-3 bg-zinc-900 border-b border-zinc-800">
                <div className="w-3 h-3 rounded-full bg-red-500/80" />
                <div className="w-3 h-3 rounded-full bg-yellow-500/80" />
                <div className="w-3 h-3 rounded-full bg-green-500/80" />
                <span className="ml-2 text-xs font-medium text-zinc-500">npx webtoapp convert</span>
              </div>
              <div className="p-6 font-mono text-sm leading-relaxed overflow-hidden h-[300px]">
                <div className="animate-pulse text-zinc-500 mb-2">$ npx webtoapp convert</div>
                <div className="text-zinc-300">✔ Stack detected: React + Supabase</div>
                <div className="text-zinc-300">✔ Generating AST transformation plan...</div>
                <div className="text-zinc-300">✔ Scaffolding offline sync layer...</div>
                <div className="text-cyan-400">⚙ Building for Windows...</div>
                <div className="text-zinc-500 mt-2">  [vite] bundle generated in 1250ms</div>
                <div className="text-zinc-500">  [electron-builder] creating setup.exe</div>
                <div className="text-green-400 mt-4 font-bold">✨ Success! webtoapp_setup.exe ready.</div>
              </div>
            </div>
          </div>
        </section>

        {/* ── How it works ── */}
        <section id="how-it-works" className="container mx-auto px-6 mt-40">
          <div className="text-center mb-16">
            <h2 className="text-3xl font-bold mb-4">How it works</h2>
            <p className="text-zinc-400 max-w-2xl mx-auto">Three simple steps to go from a codebase to a fully packaged desktop installer.</p>
          </div>
          
          <div className="grid md:grid-cols-3 gap-8">
            <div className="p-8 rounded-3xl bg-zinc-900/50 border border-zinc-800 hover:border-indigo-500/50 transition-colors">
              <div className="w-14 h-14 bg-indigo-500/10 rounded-2xl flex items-center justify-center text-indigo-400 mb-6">
                <Github className="w-6 h-6" />
              </div>
              <h3 className="text-xl font-semibold mb-3">1. Point at your repo</h3>
              <p className="text-zinc-400 leading-relaxed text-sm">
                Connect your GitHub repository or upload a zip file of your codebase. We automatically detect your framework and dependencies.
              </p>
            </div>
            
            <div className="p-8 rounded-3xl bg-zinc-900/50 border border-zinc-800 hover:border-indigo-500/50 transition-colors">
              <div className="w-14 h-14 bg-indigo-500/10 rounded-2xl flex items-center justify-center text-indigo-400 mb-6">
                <Terminal className="w-6 h-6" />
              </div>
              <h3 className="text-xl font-semibold mb-3">2. We run the pipeline</h3>
              <p className="text-zinc-400 leading-relaxed text-sm">
                Our AST-based pipeline strips out unsupported browser APIs, injects an offline SQLite database, and scaffolds the Electron container.
              </p>
            </div>
            
            <div className="p-8 rounded-3xl bg-zinc-900/50 border border-zinc-800 hover:border-indigo-500/50 transition-colors">
              <div className="w-14 h-14 bg-indigo-500/10 rounded-2xl flex items-center justify-center text-indigo-400 mb-6">
                <Download className="w-6 h-6" />
              </div>
              <h3 className="text-xl font-semibold mb-3">3. Download your .exe</h3>
              <p className="text-zinc-400 leading-relaxed text-sm">
                Get a signed, production-ready installer for Windows, Linux, and macOS. Ready to distribute to your users immediately.
              </p>
            </div>
          </div>
        </section>

        {/* ── Conversion Modes ── */}
        <section className="container mx-auto px-6 mt-40">
          <div className="text-center mb-16">
            <h2 className="text-3xl font-bold mb-4">Conversion Modes</h2>
            <p className="text-zinc-400 max-w-2xl mx-auto">Tailor the build exactly to your application's needs.</p>
          </div>
          
          <div className="bg-zinc-900/50 border border-zinc-800 rounded-3xl overflow-hidden backdrop-blur-xl">
            <table className="w-full text-left border-collapse">
              <thead>
                <tr className="bg-zinc-900/80 border-b border-zinc-800">
                  <th className="p-6 font-medium text-zinc-300">Feature</th>
                  <th className="p-6 font-medium text-indigo-400">Offline</th>
                  <th className="p-6 font-medium text-cyan-400">Online</th>
                  <th className="p-6 font-medium text-emerald-400">Hybrid</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-zinc-800 text-sm">
                <tr className="hover:bg-zinc-800/30 transition-colors">
                  <td className="p-6 text-zinc-400">Network Required</td>
                  <td className="p-6 font-semibold text-zinc-200">No</td>
                  <td className="p-6 font-semibold text-zinc-200">Yes</td>
                  <td className="p-6 font-semibold text-zinc-200">Periodic</td>
                </tr>
                <tr className="hover:bg-zinc-800/30 transition-colors">
                  <td className="p-6 text-zinc-400">Database</td>
                  <td className="p-6 font-semibold text-zinc-200">Local SQLite</td>
                  <td className="p-6 font-semibold text-zinc-200">Cloud DB</td>
                  <td className="p-6 font-semibold text-zinc-200">SQLite + Cloud Sync</td>
                </tr>
                <tr className="hover:bg-zinc-800/30 transition-colors">
                  <td className="p-6 text-zinc-400">Code Transformation</td>
                  <td className="p-6 font-semibold text-zinc-200">Full AST Rewrite</td>
                  <td className="p-6 font-semibold text-zinc-200">None (WebView)</td>
                  <td className="p-6 font-semibold text-zinc-200">Selective AST</td>
                </tr>
              </tbody>
            </table>
          </div>
        </section>
      </main>

      <footer className="border-t border-white/10 bg-zinc-950 py-12">
        <div className="container mx-auto px-6 flex flex-col md:flex-row justify-between items-center gap-6">
          <div className="flex items-center gap-2">
            <div className="w-6 h-6 rounded bg-indigo-500/20 text-indigo-400 flex items-center justify-center font-bold text-xs">W</div>
            <span className="font-semibold text-sm">WebToApp © 2026</span>
          </div>
          <div className="flex items-center gap-6 text-sm text-zinc-500">
            <Link href="https://github.com/jeff2450/desktop-to-app" className="hover:text-white transition-colors">GitHub</Link>
            <Link href="https://docs.webtoapp.dev" className="hover:text-white transition-colors">Docs</Link>
            <Link href="https://twitter.com/webtoapp" className="hover:text-white transition-colors">Twitter</Link>
          </div>
        </div>
      </footer>
    </div>
  );
}
