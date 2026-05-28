import Link from "next/link";
import { ArrowRight, Check, Zap, Crown, ShieldCheck } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle, CardDescription, CardFooter } from "@/components/ui/card";
import { cn } from "@/lib/utils";

export default function PricingPage() {
  return (
    <div className="min-h-screen bg-zinc-950 text-zinc-50 overflow-hidden pb-24">
      {/* ── Navbar ── */}
      <header className="fixed top-0 w-full z-50 border-b border-white/5 bg-zinc-950/80 backdrop-blur-md">
        <div className="container mx-auto px-6 h-16 flex items-center justify-between">
          <Link href="/" className="flex items-center gap-2 group">
            <div className="w-8 h-8 rounded-xl bg-indigo-500 flex items-center justify-center font-bold text-white shadow-[0_0_15px_rgba(99,102,241,0.5)] group-hover:scale-110 transition-transform">
              W
            </div>
            <span className="font-semibold text-lg tracking-tight">WebToApp</span>
          </Link>
          <nav className="hidden md:flex items-center gap-8 text-sm font-medium text-zinc-400">
            <Link href="/" className="hover:text-white transition-colors">Home</Link>
            <Link href="/#how-it-works" className="hover:text-white transition-colors">How it works</Link>
            <Link href="/pricing" className="text-white">Pricing</Link>
            <Link href="/docs" className="hover:text-white transition-colors">Docs</Link>
          </nav>
          <div className="flex items-center gap-4">
            <Link href="/login" className="text-sm font-medium hover:text-indigo-400 transition-colors">
              Sign in
            </Link>
            <Link href="/register" className="text-sm font-medium bg-indigo-600 hover:bg-indigo-500 px-4 py-2 rounded-lg transition-all shadow-[0_0_20px_rgba(99,102,241,0.3)]">
              Get Started
            </Link>
          </div>
        </div>
      </header>

      <main className="pt-32">
        <div className="container mx-auto px-6 text-center mb-16 relative">
          <div className="absolute top-[-100px] left-1/2 -translate-x-1/2 w-96 h-96 bg-indigo-600/10 rounded-full blur-[120px] pointer-events-none" />
          <h1 className="text-5xl font-black mb-4 tracking-tight">Simple, usage-based pricing.</h1>
          <p className="text-zinc-500 text-lg max-w-xl mx-auto">
            Choose the plan that fits your build volume. All plans include automated AST transformations and offline database injection.
          </p>
        </div>

        <div className="container mx-auto px-6 grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-6 items-stretch">
          <PricingPlanCard 
            name="Free"
            price="0"
            desc="Perfect for trying out the pipeline."
            features={[
              "1 free conversion",
              "Choose Windows, Linux, or Mac",
              "AST Transformations",
              "Offline SQLite layer",
              "Community Support"
            ]}
            cta="Get Started"
            href="/register"
          />
          <PricingPlanCard 
            name="Pro"
            price="9"
            desc="For individual developers getting started."
            features={[
              "10 conversions / mo",
              "All targets (Win, Linux, Mac)",
              "Priority Build Queue",
              "Custom App Icons",
              "Email Support"
            ]}
            cta="Get Pro"
            href="/register?plan=pro"
          />
          <PricingPlanCard 
            name="Team"
            price="15"
            isPro
            desc="For active developers and small teams."
            features={[
              "20 conversions / mo",
              "All targets (Win, Linux, Mac)",
              "Priority Build Queue",
              "Private S3 Storage",
              "Team Collaboration",
              "Email Support"
            ]}
            cta="Get Team"
            href="/register?plan=team"
          />
          <PricingPlanCard 
            name="Ultra"
            price="24"
            desc="For power users and growing teams."
            features={[
              "50 conversions / mo",
              "All targets + architectures",
              "Ultra Priority Queue",
              "CI/CD API Access",
              "Custom Integrations",
              "Dedicated Support"
            ]}
            isUltra
            cta="Get Ultra"
            href="/register?plan=ultra"
          />
        </div>


        <section className="container mx-auto px-6 mt-24">
           <Card className="bg-zinc-900/30 border-zinc-800 rounded-[2.5rem] p-12 overflow-hidden relative">
              <div className="absolute bottom-[-50px] right-[-50px] w-64 h-64 bg-purple-600/5 rounded-full blur-[80px]" />
              <div className="grid md:grid-cols-2 gap-12 items-center">
                <div>
                  <div className="inline-flex items-center gap-2 bg-purple-500/10 border border-purple-500/20 rounded-full px-4 py-1 text-purple-400 text-sm font-bold mb-6">
                    <ShieldCheck className="w-4 h-4" /> Ultra — Maximum Power
                  </div>
                  <h2 className="text-3xl font-bold mb-4">$24/mo · 50 conversions</h2>
                  <p className="text-zinc-500 mb-8">
                    Need serious build volume? The Ultra plan gives you 50 conversions per month 
                    with ultra priority queue access, CI/CD API, and dedicated support.
                  </p>
                  <Button asChild className="bg-purple-600 text-white hover:bg-purple-500 rounded-xl px-8 h-12 font-bold">
                    <Link href="/register?plan=ultra">Get Ultra <ArrowRight className="ml-2 w-4 h-4" /></Link>
                  </Button>
                </div>
                <div className="grid grid-cols-2 gap-4">
                  {[
                    { label: "Conversions", val: "50/mo" },
                    { label: "Queue", val: "Ultra" },
                    { label: "Support", val: "Dedicated" },
                    { label: "Price", val: "$24" },
                  ].map(stat => (
                    <div key={stat.label} className="bg-zinc-950/50 border border-zinc-800 p-6 rounded-2xl">
                      <p className="text-2xl font-black text-purple-400">{stat.val}</p>
                      <p className="text-xs font-bold text-zinc-500 uppercase tracking-widest">{stat.label}</p>
                    </div>
                  ))}
                </div>
              </div>
           </Card>
        </section>

      </main>

      <footer className="container mx-auto px-6 mt-32 pt-12 border-t border-zinc-900 flex justify-between items-center">
        <span className="text-zinc-600 text-sm">© 2026 WebToApp Inc.</span>
        <div className="flex gap-6 text-sm text-zinc-500">
          <Link href="/terms" className="hover:text-white transition-colors">Terms</Link>
          <Link href="/privacy" className="hover:text-white transition-colors">Privacy</Link>
        </div>
      </footer>
    </div>
  );
}

function PricingPlanCard({ name, price, desc, features, isPro, isUltra, cta, href }: any) {
  return (
    <Card className={cn(
      "bg-zinc-900 border-zinc-800 flex flex-col transition-all duration-300",
      isPro && "border-indigo-500 ring-1 ring-indigo-500/50 shadow-[0_0_40px_rgba(99,102,241,0.1)] scale-105 z-10",
      isUltra && "border-purple-500/50 ring-1 ring-purple-500/30 shadow-[0_0_40px_rgba(168,85,247,0.08)]"
    )}>
      <CardHeader>
        <div className={cn(
          "w-12 h-12 rounded-xl flex items-center justify-center mb-4",
          isPro ? "bg-indigo-500/20 text-indigo-400" :
          isUltra ? "bg-purple-500/20 text-purple-400" :
          "bg-zinc-800 text-zinc-500"
        )}>
          {isPro ? <Zap className="w-6 h-6" /> : isUltra ? <ShieldCheck className="w-6 h-6" /> : <Check className="w-6 h-6" />}
        </div>
        <CardTitle className="text-2xl font-black">{name}</CardTitle>
        <CardDescription className="mt-2">{desc}</CardDescription>
      </CardHeader>
      <CardContent className="flex-1 space-y-4 pt-4">
        <div className="flex items-baseline gap-1 mb-6">
          <span className="text-4xl font-black text-white">${price}</span>
          <span className="text-zinc-500 text-sm">/mo</span>
        </div>
        <div className="space-y-3">
          {features.map((f: string, i: number) => (
            <div key={i} className="flex items-start gap-3">
              <Check className="w-4 h-4 text-emerald-500 mt-1 flex-shrink-0" />
              <span className="text-sm text-zinc-400">{f}</span>
            </div>
          ))}
        </div>
      </CardContent>
      <CardFooter className="pt-8">
        <Button asChild className={cn(
          "w-full py-6 rounded-xl font-bold shadow-lg transition-all",
          isPro ? "bg-indigo-600 hover:bg-indigo-500 text-white" :
          isUltra ? "bg-purple-600 hover:bg-purple-500 text-white" :
          "bg-zinc-800 hover:bg-zinc-700 text-white"
        )}>
          <Link href={href}>{cta}</Link>
        </Button>
      </CardFooter>
    </Card>
  );
}

