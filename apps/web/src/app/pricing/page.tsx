import Link from "next/link";
import { ArrowRight, Check, Zap, Crown, ShieldCheck } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle, CardDescription, CardFooter } from "@/components/ui/card";
import { cn } from "@/lib/utils";
import { ScrollReveal } from "@/components/scroll-reveal";

export default function PricingPage() {
  return (
    <div className="min-h-screen bg-[#020514] text-[#dee3f7] overflow-hidden pb-24">
      {/* ── Navbar ── */}
      <header className="fixed top-0 w-full z-50 border-b border-[#8d99c4]/15 bg-[#020514]/85 backdrop-blur-xl">
        <div className="container mx-auto px-6 h-16 flex items-center justify-between">
          <Link href="/" className="flex items-center gap-2 group">
            <div className="w-8 h-8 rounded-xl border border-[#2b72f5]/30 bg-[#2b72f5]/15 flex items-center justify-center font-bold text-white shadow-[0_0_15px_rgba(43,114,245,0.4)] group-hover:scale-110 transition-transform">
              W
            </div>
            <span className="font-semibold text-lg tracking-tight">WebToApp</span>
          </Link>
          <nav className="hidden md:flex items-center gap-8 text-sm font-medium text-[#8d99c4]">
            <Link href="/" className="hover:text-white transition-colors">Home</Link>
            <Link href="/#how-it-works" className="hover:text-white transition-colors">How it works</Link>
            <Link href="/pricing" className="text-white">Pricing</Link>
            <Link href="/docs" className="hover:text-white transition-colors">Docs</Link>
          </nav>
          <div className="flex items-center gap-4">
            <Link href="/login" className="text-sm font-medium text-[#8d99c4] hover:text-white transition-colors">
              Sign in
            </Link>
            <Link href="/register" className="text-sm font-medium bg-[#2b72f5] hover:bg-[#1a5ecc] text-white px-4 py-2 rounded-lg transition-all shadow-[0_0_20px_rgba(43,114,245,0.3)]">
              Get Started
            </Link>
          </div>
        </div>
      </header>

      <main className="pt-32">
        <ScrollReveal className="container mx-auto px-6 text-center mb-16 relative">
          <div className="absolute top-[-100px] left-1/2 -translate-x-1/2 w-96 h-96 bg-[#2b72f5]/10 rounded-full blur-[120px] pointer-events-none" />
          <h1 className="text-5xl font-black mb-4 tracking-tight text-white">Simple, usage-based pricing.</h1>
          <p className="text-[#8d99c4] text-lg max-w-xl mx-auto">
            Choose the plan that fits your build volume. All plans include automated Electron scaffolding and packaged desktop builds.
          </p>
        </ScrollReveal>

        <div className="container mx-auto px-6 grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-6 items-stretch">
          <ScrollReveal delay={0} className="flex h-full">
            <PricingPlanCard 
              name="Free"
              price="0"
              desc="Perfect for trying out the pipeline."
              features={[
                "1 free conversion",
                "All build targets (Win, Linux, Mac, Android, iOS)",
                "Electron wrapper",
                "Cloud backend preserved",
                "Community Support"
              ]}
              cta="Get Started"
              href="/register"
            />
          </ScrollReveal>
          <ScrollReveal delay={100} className="flex h-full">
            <PricingPlanCard 
              name="Pro"
              price="1000"
              desc="For individual developers getting started."
              features={[
                "20 conversions / mo",
                "All build targets (Win, Linux, Mac, Android, iOS)",
                "Priority Build Queue",
                "Custom App Icons",
                "Email Support"
              ]}
              cta="Get Pro"
              href="/register?plan=pro"
            />
          </ScrollReveal>
          <ScrollReveal delay={200} className="flex h-full">
            <PricingPlanCard 
              name="Semi-Pro"
              price="30000"
              isPro
              desc="For active developers and small teams."
              features={[
                "50 conversions / mo",
                "All build targets (Win, Linux, Mac, Android, iOS)",
                "Priority Build Queue",
                "Private S3 Storage",
                "Team Collaboration",
                "Email Support"
              ]}
              cta="Get Semi-Pro"
              href="/register?plan=team"
            />
          </ScrollReveal>
          <ScrollReveal delay={300} className="flex h-full">
            <PricingPlanCard 
              name="Ultra"
              price="50000"
              desc="For power users and growing teams."
              features={[
                "100 conversions / mo",
                "All build targets (Win, Linux, Mac, Android, iOS)",
                "Ultra Priority Queue",
                "CI/CD API Access",
                "Custom Integrations",
                "Dedicated Support"
              ]}
              isUltra
              cta="Get Ultra"
              href="/register?plan=ultra"
            />
          </ScrollReveal>
        </div>


        <section className="container mx-auto px-6 mt-24">
          <ScrollReveal>
             <Card className="bg-[#030720]/40 border-[#8d99c4]/15 rounded-[2.5rem] p-12 overflow-hidden relative">
                <div className="absolute bottom-[-50px] right-[-50px] w-64 h-64 bg-[#2b72f5]/5 rounded-full blur-[80px]" />
                <div className="grid md:grid-cols-2 gap-12 items-center">
                  <div>
                    <div className="inline-flex items-center gap-2 bg-[#fcc8b7]/10 border border-[#fcc8b7]/30 rounded-full px-4 py-1 text-[#fcc8b7] text-sm font-bold mb-6">
                      <ShieldCheck className="w-4 h-4" /> Ultra — Maximum Power
                    </div>
                    <h2 className="text-3xl font-bold mb-4 text-white">50,000 TZS/mo · 100 conversions</h2>
                    <p className="text-[#8d99c4] mb-8">
                      Need serious build volume? The Ultra plan gives you 100 conversions per month 
                      with ultra priority queue access, CI/CD API, and dedicated support.
                    </p>
                    <Button asChild className="bg-[#2b72f5] text-white hover:bg-[#1a5ecc] rounded-xl px-8 h-12 font-bold shadow-[0_0_24px_rgba(43,114,245,0.3)]">
                      <Link href="/register?plan=ultra">Get Ultra <ArrowRight className="ml-2 w-4 h-4" /></Link>
                    </Button>
                  </div>
                  <div className="grid grid-cols-2 gap-4">
                    {[
                      { label: "Conversions", val: "100/mo" },
                      { label: "Queue", val: "Ultra" },
                      { label: "Support", val: "Dedicated" },
                      { label: "Price", val: "50,000 TZS" },
                    ].map(stat => (
                      <div key={stat.label} className="bg-[#020514]/50 border border-[#8d99c4]/15 p-6 rounded-2xl">
                        <p className="text-2xl font-black text-[#2b72f5]">{stat.val}</p>
                        <p className="text-xs font-bold text-[#8d99c4] uppercase tracking-widest">{stat.label}</p>
                      </div>
                    ))}
                  </div>
                </div>
             </Card>
          </ScrollReveal>
        </section>

      </main>

      <footer className="container mx-auto px-6 mt-32 pt-12 border-t border-[#8d99c4]/10 flex justify-between items-center text-[#8d99c4]">
        <span className="text-sm">© 2026 WebToApp Inc.</span>
        <div className="flex gap-6 text-sm">
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
      "bg-[#030720]/50 border-[#8d99c4]/15 flex flex-col transition-all duration-300 w-full",
      isPro && "border-[#2b72f5] ring-1 ring-[#2b72f5]/50 shadow-[0_0_40px_rgba(43,114,245,0.15)] scale-105 z-10",
      isUltra && "border-[#fcc8b7] ring-1 ring-[#fcc8b7]/40 shadow-[0_0_40px_rgba(252,200,183,0.1)]"
    )}>
      <CardHeader>
        <div className={cn(
          "w-12 h-12 rounded-xl flex items-center justify-center mb-4",
          isPro ? "bg-[#2b72f5]/20 text-[#2b72f5]" :
          isUltra ? "bg-[#fcc8b7]/20 text-[#fcc8b7]" :
          "bg-[#8d99c4]/10 text-[#8d99c4]"
        )}>
          {isPro ? <Zap className="w-6 h-6" /> : isUltra ? <ShieldCheck className="w-6 h-6" /> : <Check className="w-6 h-6" />}
        </div>
        <CardTitle className="text-2xl font-black text-white">{name}</CardTitle>
        <CardDescription className="mt-2 text-[#8d99c4]">{desc}</CardDescription>
      </CardHeader>
      <CardContent className="flex-1 space-y-4 pt-4">
        <div className="flex items-baseline gap-1 mb-6">
          <span className="text-3xl font-black text-white">
            {price === "0" ? "Free" : `${Number(price).toLocaleString()} TZS`}
          </span>
          {price !== "0" && <span className="text-[#8d99c4] text-xs">/mo</span>}
        </div>
        <div className="space-y-3">
          {features.map((f: string, i: number) => (
            <div key={i} className="flex items-start gap-3">
              <Check className="w-4 h-4 text-[#2b72f5] mt-1 flex-shrink-0" />
              <span className="text-sm text-[#dee3f7]/80">{f}</span>
            </div>
          ))}
        </div>
      </CardContent>
      <CardFooter className="pt-8">
        <Button asChild className={cn(
          "w-full py-6 rounded-xl font-bold shadow-lg transition-all",
          isPro ? "bg-[#2b72f5] hover:bg-[#1a5ecc] text-white" :
          isUltra ? "bg-gradient-to-r from-[#2b72f5] to-[#fcc8b7] text-[#020514] hover:opacity-90 font-extrabold" :
          "bg-[#8d99c4]/20 hover:bg-[#8d99c4]/30 text-white"
        )}>
          <Link href={href}>{cta}</Link>
        </Button>
      </CardFooter>
    </Card>
  );
}
