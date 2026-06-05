import Link from "next/link";
import type { LucideIcon } from "lucide-react";
import {
  ArrowRight,
  BadgeCheck,
  Boxes,
  Check,
  ChevronRight,
  Clock,
  Code2,
  Database,
  Download,
  FileArchive,
  Gauge,
  GitBranch,
  Globe2,
  Layers3,
  Lock,
  Package,
  PlayCircle,
  Rocket,
  ServerCog,
  Shield,
  ShieldCheck,
  Sparkles,
  Terminal,
  UploadCloud,
  Zap,
} from "lucide-react";
import { ScrollReveal } from "@/components/scroll-reveal";

const stats = [
  { label: "Build targets", value: "5", detail: "Windows, Linux, macOS, Android, iOS beta" },
  { label: "Pipeline stages", value: "9", detail: "Detection, parity, package, signing, CI" },
  { label: "First build", value: "Free", detail: "Try the full workflow before upgrading" },
];

const platformFeatures = [
  {
    icon: GitBranch,
    title: "Repo or ZIP intake",
    body: "Start from a GitHub URL or upload a source archive. The wizard captures app name, bundle ID, icon, and targets.",
  },
  {
    icon: ServerCog,
    title: "Stack-aware conversion",
    body: "Detect React, Vue, Supabase, Firebase, Clerk, Auth0, cloud env files, and framework build settings before packaging.",
  },
  {
    icon: ShieldCheck,
    title: "Parity gate",
    body: "Check that online builds preserve cloud behavior and that packaged assets are present before users download an installer.",
  },
  {
    icon: Package,
    title: "Native installers",
    body: "Generate desktop artifacts with Electron, secure app protocols, app icons, offline fallback pages, and update hooks.",
  },
  {
    icon: UploadCloud,
    title: "Artifact delivery",
    body: "Upload builds to S3-compatible storage or local outputs in development, then serve authenticated download links.",
  },
  {
    icon: Gauge,
    title: "Live build visibility",
    body: "Users see progress, active stage, estimated wait, logs, final artifacts, retry paths, and skipped platform notes.",
  },
];

const launchSteps = [
  { icon: FileArchive, title: "Bring code", body: "Upload a ZIP or connect a repository." },
  { icon: Layers3, title: "Configure app", body: "Set bundle ID, icon, platforms, and release target." },
  { icon: Terminal, title: "Watch the build", body: "Stream every pipeline stage with progress and logs." },
  { icon: Download, title: "Ship installers", body: "Download artifacts and send them to users." },
];

const nativeWins = [
  "Secure Electron shell",
  "Auto-update hooks",
  "Code-signing validation",
  "Offline fallback screen",
  "Custom app icons",
  "CI workflow emit",
  "Mobile beta targets",
  "S3/R2 artifact storage",
];

const faqs = [
  {
    q: "Is this only an Electron wrapper?",
    a: "No. WebToApp wraps the web app, but it also runs detection, build fixes, parity checks, installer packaging, signing validation, artifact storage, and live job tracking.",
  },
  {
    q: "What projects work best today?",
    a: "React or Vue projects with Vite are the strongest fit. The pipeline also understands common cloud stacks like Supabase, Firebase, Clerk, and Auth0.",
  },
  {
    q: "Can I build every platform from one machine?",
    a: "Some targets need native workers. macOS builds need macOS, Windows builds need Windows, and Linux builds need Linux. Android can run from more hosts.",
  },
  {
    q: "What should I do after my first build?",
    a: "Use the build log and report to fix warnings, add signing credentials, configure update publishing, and then create repeatable builds for each release.",
  },
];

export default function LandingPage() {
  return (
    <div className="min-h-screen overflow-hidden bg-[#020514] text-[#dee3f7]">
      <header className="fixed top-0 z-50 w-full border-b border-[#8d99c4]/15 bg-[#020514]/85 backdrop-blur-xl">
        <div className="mx-auto flex h-16 max-w-7xl items-center justify-between px-4 sm:px-6 lg:px-8">
          <Link href="/" className="flex items-center gap-2" aria-label="WebToApp home">
            <div className="flex h-8 w-8 items-center justify-center rounded-lg border border-[#2b72f5]/30 bg-[#2b72f5]/15 text-[#dee3f7] shadow-[0_0_24px_rgba(43,114,245,0.24)]">
              <Shield className="h-4 w-4" />
            </div>
            <span className="text-lg font-semibold tracking-normal text-white">WebToApp</span>
          </Link>

          <nav className="hidden items-center gap-7 text-sm font-medium text-[#8d99c4] md:flex">
            <Link href="#features" className="transition-colors hover:text-white">
              Product
            </Link>
            <Link href="/pricing" className="transition-colors hover:text-white">
              Pricing
            </Link>
            <Link href="/docs" className="transition-colors hover:text-white">
              Docs
            </Link>
            <Link href="#launch" className="transition-colors hover:text-white">
              Resources
            </Link>
            <Link href="#faq" className="transition-colors hover:text-white">
              Support
            </Link>
          </nav>

          <div className="flex items-center gap-3">
            <Link href="/login" className="hidden text-sm font-medium text-[#8d99c4] transition-colors hover:text-white sm:inline">
              Sign in
            </Link>
            <Link
              href="/register"
              className="inline-flex items-center justify-center gap-2 rounded-lg border border-[#2b72f5]/30 bg-[#2b72f5] px-4 py-2 text-sm font-semibold text-white shadow-[0_0_28px_rgba(43,114,245,0.32)] transition-colors hover:bg-[#1a5ecc]"
            >
              Sign up
              <ArrowRight className="h-4 w-4" />
            </Link>
          </div>
        </div>
      </header>

      <main>
        <section className="relative isolate px-4 pb-14 pt-24 sm:px-6 lg:px-8">
          <div className="absolute inset-0 -z-10 bg-[radial-gradient(circle_at_50%_0%,rgba(43,114,245,0.22),transparent_38%),radial-gradient(circle_at_12%_24%,rgba(252,200,183,0.06),transparent_28%),linear-gradient(180deg,#040a3c_0%,#020514_76%)]" />
          <div className="absolute inset-x-0 top-0 -z-10 h-96 bg-[linear-gradient(90deg,transparent,rgba(222,227,247,0.06),transparent)] blur-3xl" />

          <div className="mx-auto max-w-7xl">
            <div className="relative overflow-hidden rounded-lg border border-[#8d99c4]/15 bg-[#030720]/80 shadow-[0_30px_120px_rgba(0,0,0,0.65)] backdrop-blur">
              <div className="absolute inset-0 bg-[radial-gradient(circle_at_48%_4%,rgba(43,114,245,0.22),transparent_28%),radial-gradient(circle_at_72%_15%,rgba(252,200,183,0.06),transparent_24%),linear-gradient(180deg,rgba(255,255,255,0.03),transparent_36%)]" />
              <div className="absolute inset-0 opacity-25 [background-image:linear-gradient(90deg,rgba(43,114,245,0.08)_1px,transparent_1px),linear-gradient(180deg,rgba(43,114,245,0.05)_1px,transparent_1px)] [background-size:80px_80px]" />

              <div className="relative z-10 flex min-h-[680px] flex-col items-center justify-between px-4 py-12 text-center sm:px-8 lg:px-12">
                <ScrollReveal className="mx-auto flex max-w-4xl flex-col items-center pt-8 sm:pt-12" delay={100}>
                  <div className="mb-5 inline-flex items-center gap-2 rounded-lg border border-[#2b72f5]/20 bg-black/30 px-3 py-1.5 text-xs font-semibold text-[#dee3f7] shadow-[0_0_24px_rgba(43,114,245,0.16)]">
                    <BadgeCheck className="h-4 w-4 text-[#2b72f5]" />
                    Secure every conversion
                  </div>

                  <h1 className="max-w-4xl text-4xl font-semibold leading-[1.05] tracking-normal text-white sm:text-5xl lg:text-6xl">
                    WebToApp protects your web app on its way to desktop.
                  </h1>

                  <p className="mt-6 max-w-2xl text-base leading-7 text-[#dee3f7]/72 sm:text-lg">
                    Convert React, Vue, Next.js, Supabase, Firebase, Clerk, and Auth0 projects into native installers with live logs, parity checks, and release-ready packaging.
                  </p>

                  <div className="mt-8 flex flex-col gap-3 sm:flex-row">
                    <Link
                      href="/register"
                      className="inline-flex items-center justify-center gap-2 rounded-lg border border-[#2b72f5]/30 bg-[#2b72f5] px-6 py-3 text-sm font-bold text-white shadow-[0_0_32px_rgba(43,114,245,0.35)] transition-colors hover:bg-[#1a5ecc]"
                    >
                      Try free
                      <Rocket className="h-4 w-4" />
                    </Link>
                    <Link
                      href="/docs"
                      className="inline-flex items-center justify-center gap-2 rounded-lg border border-[#8d99c4]/18 bg-white/[0.08] px-6 py-3 text-sm font-semibold text-white backdrop-blur transition-colors hover:border-[#8d99c4]/35 hover:bg-white/[0.12]"
                    >
                      Explore
                      <ChevronRight className="h-4 w-4" />
                    </Link>
                  </div>
                </ScrollReveal>

                <ScrollReveal className="w-full" delay={300}>
                  <SecurityVisual />
                </ScrollReveal>
              </div>
            </div>
          </div>
        </section>

        <section className="border-y border-[#8d99c4]/10 bg-[#030720]">
          <div className="mx-auto grid max-w-7xl gap-4 px-4 py-6 sm:grid-cols-2 sm:px-6 lg:grid-cols-4 lg:px-8">
            <ScrollReveal delay={0}>
              <TrustLine icon={Clock} label="Fast path" value="Queue, build, package, download" />
            </ScrollReveal>
            <ScrollReveal delay={100}>
              <TrustLine icon={Lock} label="Secure by default" value="Context isolation and sandboxed preload" />
            </ScrollReveal>
            <ScrollReveal delay={200}>
              <TrustLine icon={Globe2} label="Cloud friendly" value="Preserves live backend behavior" />
            </ScrollReveal>
            <ScrollReveal delay={300}>
              <TrustLine icon={Code2} label="Developer ready" value="CLI, dashboard, logs, reports" />
            </ScrollReveal>
          </div>
        </section>

        <section id="features" className="relative mx-auto max-w-7xl px-4 py-24 sm:px-6 lg:px-8">
          <div className="absolute inset-x-0 top-16 -z-10 h-80 bg-[radial-gradient(circle_at_50%_50%,rgba(43,114,245,0.08),transparent_62%)]" />
          <ScrollReveal>
            <SectionHeader
              eyebrow="Product edge"
              title="The features that turn curiosity into a paid build."
              body="A strong converter needs more than a button. Users need confidence that the app will package, run, and be explainable when something fails."
            />
          </ScrollReveal>

          <div className="mt-12 grid gap-4 md:grid-cols-2 lg:grid-cols-3">
            {platformFeatures.map((feature, index) => (
              <ScrollReveal key={feature.title} delay={index * 100}>
                <FeatureCard {...feature} />
              </ScrollReveal>
            ))}
          </div>
        </section>

        <section className="border-y border-[#8d99c4]/10 bg-[#030720]/50">
          <div className="mx-auto grid max-w-7xl gap-10 px-4 py-24 sm:px-6 lg:grid-cols-[0.9fr_1.1fr] lg:px-8">
            <ScrollReveal className="flex flex-col justify-center">
              <div className="mb-4 inline-flex self-start items-center gap-2 rounded-lg border border-[#fcc8b7]/30 bg-[#fcc8b7]/10 px-3 py-1.5 text-xs font-semibold text-[#fcc8b7]">
                <Sparkles className="h-4 w-4 text-[#fcc8b7]" />
                Stronger than manual Electron setup
              </div>
              <h2 className="max-w-xl text-3xl font-bold tracking-normal text-white sm:text-4xl">
                Give users the confidence that their build is release-ready.
              </h2>
              <p className="mt-5 max-w-xl leading-7 text-[#dee3f7]/65">
                Manual Electron work is full of hidden tasks: base paths, app protocols, signing, native rebuilds, platform constraints, and artifact delivery. WebToApp packages those jobs into a guided flow.
              </p>
              <Link
                href="/pricing"
                className="mt-8 inline-flex self-start items-center gap-2 rounded-lg border border-[#8d99c4]/18 px-5 py-3 text-sm font-semibold text-white transition-colors hover:border-[#8d99c4]/35 hover:bg-white/[0.08]"
              >
                See plans
                <ArrowRight className="h-4 w-4" />
              </Link>
            </ScrollReveal>

            <div className="grid gap-4 md:grid-cols-2">
              <ScrollReveal delay={150}>
                <ComparisonPanel
                  title="Manual Electron"
                  tone="muted"
                  rows={[
                    "Patch build output by hand",
                    "Debug native module rebuilds",
                    "Guess why installers fail",
                    "Manually collect artifacts",
                    "Explain platform skips yourself",
                  ]}
                />
              </ScrollReveal>
              <ScrollReveal delay={300}>
                <ComparisonPanel
                  title="WebToApp"
                  tone="strong"
                  rows={[
                    "Detect and prepare the stack",
                    "Run parity checks before packaging",
                    "Stream stage-level logs",
                    "Store artifacts and serve downloads",
                    "Warn clearly about platform limits",
                  ]}
                />
              </ScrollReveal>
            </div>
          </div>
        </section>

        <section id="launch" className="mx-auto max-w-7xl px-4 py-24 sm:px-6 lg:px-8">
          <ScrollReveal>
            <SectionHeader
              eyebrow="Launch path"
              title="A conversion workflow users can understand in one glance."
              body="A clear path removes hesitation: bring the project, configure the app, watch the build, and download the installer."
            />
          </ScrollReveal>

          <div className="mt-12 grid gap-4 md:grid-cols-4">
            {launchSteps.map((step, index) => (
              <ScrollReveal key={step.title} delay={index * 100}>
                <div className="rounded-lg border border-[#8d99c4]/12 bg-white/[0.04] p-5 shadow-[0_20px_60px_rgba(0,0,0,0.18)]">
                  <div className="mb-5 flex items-center justify-between">
                    <div className="flex h-10 w-10 items-center justify-center rounded-lg border border-[#2b72f5]/16 bg-[#2b72f5]/10 text-[#2b72f5]">
                      <step.icon className="h-5 w-5" />
                    </div>
                    <span className="text-xs font-bold text-[#dee3f7]/30">0{index + 1}</span>
                  </div>
                  <h3 className="font-semibold text-white">{step.title}</h3>
                  <p className="mt-2 text-sm leading-6 text-[#dee3f7]/60">{step.body}</p>
                </div>
              </ScrollReveal>
            ))}
          </div>
        </section>

        <section className="border-y border-[#8d99c4]/10 bg-[#030720]">
          <div className="mx-auto grid max-w-7xl gap-10 px-4 py-20 sm:px-6 lg:grid-cols-[0.95fr_1.05fr] lg:px-8">
            <ScrollReveal className="flex flex-col justify-center">
              <h2 className="text-3xl font-bold tracking-normal text-white">Native polish people expect.</h2>
              <p className="mt-4 max-w-xl leading-7 text-[#dee3f7]/65">
                The page now highlights the desktop details that make a converted app feel credible, usable, and ready for real users.
              </p>
            </ScrollReveal>

            <div className="grid gap-3 sm:grid-cols-2">
              {nativeWins.map((item, index) => (
                <ScrollReveal key={item} delay={index * 50}>
                  <div className="flex items-center gap-3 rounded-lg border border-[#8d99c4]/12 bg-white/[0.04] px-4 py-3">
                    <Check className="h-4 w-4 flex-none text-[#2b72f5]" />
                    <span className="text-sm font-medium text-[#dee3f7]/82">{item}</span>
                  </div>
                </ScrollReveal>
              ))}
            </div>
          </div>
        </section>

        <section id="faq" className="mx-auto max-w-4xl px-4 py-24 sm:px-6 lg:px-8">
          <ScrollReveal>
            <SectionHeader
              eyebrow="FAQ"
              title="Answer the objections before they stop the signup."
              body="These are the questions a serious user asks before trusting a build platform with their project."
            />
          </ScrollReveal>

          <div className="mt-10 space-y-3">
            {faqs.map((faq, index) => (
              <ScrollReveal key={faq.q} delay={index * 50}>
                <div className="rounded-lg border border-[#8d99c4]/12 bg-white/[0.04] p-5">
                  <h3 className="font-semibold text-white">{faq.q}</h3>
                  <p className="mt-2 leading-7 text-[#dee3f7]/62">{faq.a}</p>
                </div>
              </ScrollReveal>
            ))}
          </div>
        </section>

        <section className="mx-auto max-w-7xl px-4 pb-24 sm:px-6 lg:px-8">
          <ScrollReveal>
            <div className="relative overflow-hidden rounded-[2rem] border border-[#2b72f5]/20 bg-gradient-to-r from-[#040a3c] to-[#020514] px-6 py-10 text-[#dee3f7] shadow-[0_28px_90px_rgba(43,114,245,0.22)] md:px-10">
              <div className="absolute inset-0 bg-[radial-gradient(circle_at_86%_0%,rgba(43,114,245,0.15),transparent_30%)]" />
              <div className="relative grid gap-8 md:grid-cols-[1fr_auto] md:items-center">
                <div>
                  <div className="mb-3 inline-flex items-center gap-2 rounded-lg border border-[#2b72f5]/20 bg-[#2b72f5]/15 px-3 py-1 text-xs font-bold text-[#dee3f7]">
                    <Zap className="h-4 w-4 text-[#fcc8b7]" />
                    Free first conversion
                  </div>
                  <h2 className="text-3xl font-bold tracking-normal text-white">Turn your next web app into a desktop product.</h2>
                  <p className="mt-3 max-w-2xl text-sm leading-6 text-[#dee3f7]/76">
                    Start with one build, inspect the logs, download the artifact, and decide what to ship next.
                  </p>
                </div>
                <Link
                  href="/register"
                  className="inline-flex items-center justify-center gap-2 rounded-lg bg-[#2b72f5] px-6 py-3 text-sm font-bold text-white transition-colors hover:bg-[#1a5ecc]"
                >
                  Start building
                  <PlayCircle className="h-4 w-4" />
                </Link>
              </div>
            </div>
          </ScrollReveal>
        </section>
      </main>

      <footer className="border-t border-[#8d99c4]/10 bg-[#020514] py-10">
        <div className="mx-auto flex max-w-7xl flex-col gap-6 px-4 sm:px-6 md:flex-row md:items-center md:justify-between lg:px-8">
          <div className="flex items-center gap-2">
            <div className="flex h-7 w-7 items-center justify-center rounded-lg border border-[#2b72f5]/20 bg-[#2b72f5]/10 text-white shadow-[0_0_12px_rgba(43,114,245,0.2)]">
              <Shield className="h-3.5 w-3.5" />
            </div>
            <span className="text-sm font-semibold text-[#dee3f7]/72">WebToApp 2026</span>
          </div>
          <div className="flex flex-wrap items-center gap-5 text-sm text-[#8d99c4]">
            <Link href="https://github.com/jeff2450/desktop-to-app" className="transition-colors hover:text-white">
              GitHub
            </Link>
            <Link href="/docs" className="transition-colors hover:text-white">
              Docs
            </Link>
            <Link href="/pricing" className="transition-colors hover:text-white">
              Pricing
            </Link>
            <Link href="/register" className="transition-colors hover:text-white">
              Start free
            </Link>
          </div>
        </div>
      </footer>
    </div>
  );
}

function SecurityVisual() {
  return (
    <div className="relative mt-12 h-[280px] w-full max-w-5xl overflow-hidden sm:h-[310px]">
      <div className="absolute inset-x-0 bottom-0 h-px bg-[#2b72f5]/30" />
      <div className="absolute inset-x-4 bottom-[95px] hidden h-px bg-gradient-to-r from-transparent via-[#2b72f5]/45 to-transparent md:block" />

      <CircuitSide side="left" />
      <CircuitSide side="right" />

      <div className="absolute left-1/2 top-[64px] flex -translate-x-1/2 flex-col items-center">
        <div className="relative flex h-44 w-44 items-center justify-center rounded-full border border-[#2b72f5]/20 bg-[#2b72f5]/8 shadow-[0_0_90px_rgba(43,114,245,0.22)]">
          <div className="absolute inset-3 rounded-full border border-[#2b72f5]/22" />
          <div className="absolute inset-8 rounded-full border border-[#2b72f5]/20 bg-[radial-gradient(circle,rgba(43,114,245,0.22),transparent_70%)]" />
          <div className="absolute inset-0 rounded-full border border-dashed border-[#dee3f7]/20" />
          <div className="relative flex h-24 w-24 items-center justify-center rounded-full border border-[#dee3f7]/25 bg-gradient-to-b from-[#dee3f7] to-[#2b72f5] text-[#020514] shadow-[0_0_36px_rgba(43,114,245,0.35)]">
            <ShieldCheck className="h-14 w-14" />
          </div>
        </div>

        <div className="mt-5 grid grid-cols-3 gap-3">
          {stats.map((stat) => (
            <div key={stat.label} className="hidden w-28 rounded-lg border border-[#8d99c4]/12 bg-black/25 px-3 py-2 text-left backdrop-blur sm:block">
              <div className="text-lg font-bold text-white">{stat.value}</div>
              <div className="text-[10px] font-semibold uppercase tracking-normal text-[#dee3f7]/45">{stat.label}</div>
            </div>
          ))}
        </div>
      </div>

      <Node icon={Package} className="left-[24%] top-[44px]" />
      <Node icon={Database} className="left-[32%] top-[98px]" />
      <Node icon={Globe2} className="right-[31%] top-[98px]" />
      <Node icon={FileArchive} className="right-[24%] top-[44px]" />
    </div>
  );
}

function CircuitSide({ side }: { side: "left" | "right" }) {
  const left = side === "left";

  return (
    <div className={`absolute bottom-8 hidden h-44 w-[44%] md:block ${left ? "left-0" : "right-0"}`}>
      <div className={`absolute top-20 h-px w-full from-[#2b72f5]/45 via-[#2b72f5]/25 to-transparent ${left ? "bg-gradient-to-r" : "bg-gradient-to-l"}`} />
      <Trace className={`${left ? "left-0" : "right-0"} top-0 w-[36%]`} />
      <Trace className={`${left ? "left-[6%]" : "right-[6%]"} top-10 w-[48%]`} />
      <Trace className={`${left ? "left-[13%]" : "right-[13%]"} top-20 w-[58%]`} />
      <Trace className={`${left ? "left-[5%]" : "right-[5%]"} top-28 w-[46%]`} />
      <Trace className={`${left ? "left-[18%]" : "right-[18%]"} top-40 w-[42%]`} />
      <Dot className={`${left ? "left-[10%]" : "right-[10%]"} top-[35px]`} />
      <Dot className={`${left ? "left-[22%]" : "right-[22%]"} top-[75px]`} coral />
      <Dot className={`${left ? "left-[4%]" : "right-[4%]"} top-[116px]`} />
      <Dot className={`${left ? "left-[30%]" : "right-[30%]"} top-[150px]`} coral />
    </div>
  );
}

function Trace({ className }: { className: string }) {
  return (
    <div className={`absolute h-px bg-[#2b72f5]/28 ${className}`}>
      <span className="absolute right-0 top-0 h-px w-10 bg-gradient-to-r from-transparent to-[#2b72f5]" />
      <span className="absolute right-0 top-0 h-5 w-px origin-top rotate-45 bg-[#2b72f5]/24" />
    </div>
  );
}

function Dot({ className, coral }: { className: string; coral?: boolean }) {
  return <span className={`absolute h-1.5 w-1.5 rounded-full ${coral ? "bg-[#fcc8b7] shadow-[0_0_14px_rgba(252,200,183,0.8)]" : "bg-[#2b72f5] shadow-[0_0_14px_rgba(43,114,245,0.8)]"} ${className}`} />;
}

function Node({ icon: Icon, className }: { icon: LucideIcon; className: string }) {
  return (
    <div className={`absolute hidden h-10 w-10 items-center justify-center rounded-full border border-[#2b72f5]/15 bg-[#2b72f5]/10 text-white shadow-[0_0_24px_rgba(43,114,245,0.2)] backdrop-blur sm:flex ${className}`}>
      <Icon className="h-4 w-4" />
    </div>
  );
}

function TrustLine({ icon: Icon, label, value }: { icon: LucideIcon; label: string; value: string }) {
  return (
    <div className="flex items-start gap-3 rounded-lg border border-[#8d99c4]/10 bg-white/[0.035] p-4">
      <div className="flex h-9 w-9 flex-none items-center justify-center rounded-lg border border-[#2b72f5]/20 bg-[#2b72f5]/10 text-[#2b72f5]">
        <Icon className="h-4 w-4" />
      </div>
      <div>
        <div className="text-xs font-bold uppercase tracking-normal text-[#dee3f7]/42">{label}</div>
        <div className="mt-1 text-sm font-medium text-[#dee3f7]/82">{value}</div>
      </div>
    </div>
  );
}

function SectionHeader({ eyebrow, title, body }: { eyebrow: string; title: string; body: string }) {
  return (
    <div className="max-w-3xl text-left">
      <div className="mb-3 text-xs font-bold uppercase tracking-normal text-[#fcc8b7]">{eyebrow}</div>
      <h2 className="text-3xl font-bold tracking-normal text-white sm:text-4xl">{title}</h2>
      <p className="mt-4 text-base leading-7 text-[#dee3f7]/62">{body}</p>
    </div>
  );
}

function FeatureCard({ icon: Icon, title, body }: { icon: LucideIcon; title: string; body: string }) {
  return (
    <div className="rounded-lg border border-[#8d99c4]/12 bg-[#030720]/40 p-6 shadow-[0_20px_60px_rgba(0,0,0,0.18)] transition-all duration-300 hover:border-[#2b72f5]/30 hover:bg-[#030720]/80 hover:shadow-[0_20px_60px_rgba(43,114,245,0.08)]">
      <div className="mb-5 flex h-11 w-11 items-center justify-center rounded-lg border border-[#2b72f5]/20 bg-[#2b72f5]/10 text-[#2b72f5]">
        <Icon className="h-5 w-5" />
      </div>
      <h3 className="font-semibold text-white">{title}</h3>
      <p className="mt-3 text-sm leading-6 text-[#dee3f7]/60">{body}</p>
    </div>
  );
}

function ComparisonPanel({ title, rows, tone }: { title: string; rows: string[]; tone: "muted" | "strong" }) {
  const strong = tone === "strong";

  return (
    <div className={`rounded-lg border p-5 ${strong ? "border-[#2b72f5]/30 bg-[#2b72f5]/10" : "border-[#8d99c4]/10 bg-black/22"}`}>
      <div className={`mb-4 flex items-center gap-2 font-semibold ${strong ? "text-white" : "text-[#dee3f7]/70"}`}>
        {strong ? <Rocket className="h-4 w-4 text-[#2b72f5]" /> : <Boxes className="h-4 w-4 text-[#8d99c4]" />}
        {title}
      </div>
      <div className="space-y-3">
        {rows.map((row) => (
          <div key={row} className="flex items-start gap-3 text-sm leading-6 text-[#dee3f7]/68">
            <Check className={`mt-1 h-4 w-4 flex-none ${strong ? "text-[#2b72f5]" : "text-[#8d99c4]/28"}`} />
            {row}
          </div>
        ))}
      </div>
    </div>
  );
}
