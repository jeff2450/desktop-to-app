"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { TopBar } from "@/components/layout/TopBar";
import { conversionsApi } from "@/lib/api-client";
import { 
  Card, 
  CardContent, 
  CardHeader, 
  CardTitle, 
  CardDescription,
  CardFooter
} from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { 
  RadioGroup, 
  RadioGroupItem 
} from "@/components/ui/radio-group";
import { 
  GitBranch as Github, 
  FileArchive, 
  ChevronRight, 
  ChevronLeft, 
  Rocket,
  Info,
  Check
} from "lucide-react";
import { Checkbox } from "@/components/ui/checkbox";
import { cn } from "@/lib/utils";
import { useAuthStore } from "@/stores/auth";

const STEPS = ["Source", "Config", "Review"];

export default function NewJobPage() {
  const router = useRouter();
  const { user } = useAuthStore();
  const [step, setStep] = useState(0);
  const [loading, setLoading] = useState(false);
  
  // Form State
  const [formData, setFormData] = useState({
    name: "",
    sourceType: "github" as "github" | "upload",
    sourceUrl: "",
    appId: "com.example.myapp",
    mode: "offline" as "offline" | "online" | "hybrid",
    targets: ["windows"] as string[],
  });

  const nextStep = () => setStep(s => Math.min(s + 1, STEPS.length - 1));
  const prevStep = () => setStep(s => Math.max(s - 1, 0));

  const toggleTarget = (target: string) => {
    setFormData(prev => ({
      ...prev,
      targets: prev.targets.includes(target)
        ? prev.targets.filter(t => t !== target)
        : [...prev.targets, target]
    }));
  };

  const handleSubmit = async () => {
    setLoading(true);
    try {
      const res = await conversionsApi.create({
        name: formData.name,
        sourceUrl: formData.sourceUrl,
        sourceType: formData.sourceType,
        targets: formData.targets,
        appId: formData.appId,
        mode: formData.mode,
      });
      
      if (res.data) {
        router.push(`/jobs/${res.data.id}`);
      }
    } catch (error) {
      console.error("Failed to create job:", error);
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="min-h-screen bg-zinc-950">
      <TopBar title="New Conversion" />
      
      <div className="p-8 max-w-3xl mx-auto">
        {/* Progress Stepper */}
        <div className="flex items-center justify-between mb-12">
          {STEPS.map((label, i) => (
            <div key={label} className="flex items-center flex-1 last:flex-none">
              <div className="flex flex-col items-center gap-2">
                <div className={cn(
                  "w-10 h-10 rounded-full flex items-center justify-center text-sm font-bold border-2 transition-all",
                  step === i ? "bg-indigo-600 border-indigo-600 text-white shadow-[0_0_15px_rgba(99,102,241,0.5)]" : 
                  step > i ? "bg-zinc-800 border-zinc-800 text-emerald-500" : "bg-zinc-950 border-zinc-800 text-zinc-500"
                )}>
                  {step > i ? <Check className="w-5 h-5" /> : i + 1}
                </div>
                <span className={cn("text-xs font-bold uppercase tracking-widest", step === i ? "text-white" : "text-zinc-500")}>
                  {label}
                </span>
              </div>
              {i < STEPS.length - 1 && (
                <div className={cn("h-[2px] flex-1 mx-4 bg-zinc-800", step > i && "bg-indigo-600/50")} />
              )}
            </div>
          ))}
        </div>

        {/* Form Content */}
        <div className="space-y-8 animate-in fade-in slide-in-from-bottom-4 duration-500">
          
          {/* STEP 1: SOURCE */}
          {step === 0 && (
            <div className="space-y-6">
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                <SourceOption 
                  icon={Github} 
                  label="GitHub Repo" 
                  description="Point to a public or private repository" 
                  active={formData.sourceType === "github"}
                  onClick={() => setFormData(f => ({ ...f, sourceType: "github" }))}
                />
                <SourceOption 
                  icon={FileArchive} 
                  label="Upload ZIP" 
                  description="Upload a source archive (max 50MB)" 
                  active={formData.sourceType === "upload"}
                  onClick={() => setFormData(f => ({ ...f, sourceType: "upload" }))}
                />
              </div>

              {formData.sourceType === "github" ? (
                <div className="space-y-2">
                  <Label className="text-zinc-400">Repository URL</Label>
                  <Input 
                    placeholder="https://github.com/user/repo" 
                    className="bg-zinc-900 border-zinc-800 h-12 rounded-xl text-white placeholder:text-zinc-600 focus:ring-indigo-500"
                    value={formData.sourceUrl}
                    onChange={(e) => setFormData(f => ({ ...f, sourceUrl: e.target.value }))}
                  />
                  <p className="text-[10px] text-zinc-600 flex items-center gap-1"><Info className="w-3 h-3" /> Must be a valid GitHub URL</p>
                </div>
              ) : (
                <div className="border-2 border-dashed border-zinc-800 rounded-2xl p-12 text-center bg-zinc-900/10 hover:bg-zinc-900/20 transition-colors cursor-pointer group">
                  <FileArchive className="w-12 h-12 text-zinc-700 mx-auto mb-4 group-hover:text-indigo-500 transition-colors" />
                  <p className="text-zinc-400 font-medium">Click to select or drag and drop</p>
                  <p className="text-zinc-600 text-xs mt-1">.zip files only</p>
                </div>
              )}
            </div>
          )}

          {/* STEP 2: CONFIGURATION */}
          {step === 1 && (
            <Card className="bg-zinc-900/50 border-zinc-800">
              <CardContent className="pt-6 space-y-6">
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-6">
                  <div className="space-y-2">
                    <Label className="text-zinc-400">App Name</Label>
                    <Input 
                      placeholder="My Amazing App" 
                      className="bg-zinc-950 border-zinc-800 text-white"
                      value={formData.name}
                      onChange={(e) => setFormData(f => ({ ...f, name: e.target.value }))}
                    />
                  </div>
                  <div className="space-y-2">
                    <Label className="text-zinc-400">App ID (Bundle ID)</Label>
                    <Input 
                      placeholder="com.example.myapp" 
                      className="bg-zinc-950 border-zinc-800 text-white font-mono"
                      value={formData.appId}
                      onChange={(e) => setFormData(f => ({ ...f, appId: e.target.value }))}
                    />
                  </div>
                </div>

                <div className="space-y-4">
                  <Label className="text-zinc-400">Conversion Mode</Label>
                  <RadioGroup 
                    value={formData.mode} 
                    onValueChange={(v: any) => setFormData(f => ({ ...f, mode: v }))}
                    className="grid grid-cols-1 sm:grid-cols-3 gap-4"
                  >
                    <ModeOption value="offline" label="Offline" desc="Full SQLite sync" />
                    <ModeOption value="online" label="Online" desc="WebView Wrapper" />
                    <ModeOption value="hybrid" label="Hybrid" desc="Partial caching" />
                  </RadioGroup>
                </div>

                <div className="space-y-4">
                  <Label className="text-zinc-400">Target Platforms</Label>
                  <div className="flex flex-wrap gap-6 p-4 bg-zinc-950 border border-zinc-800 rounded-xl">
                    <TargetCheckbox 
                      label="Windows" 
                      checked={formData.targets.includes("windows")} 
                      onCheckedChange={() => toggleTarget("windows")} 
                    />
                    <TargetCheckbox 
                      label="Linux" 
                      checked={formData.targets.includes("linux")} 
                      onCheckedChange={() => toggleTarget("linux")} 
                    />
                    <TargetCheckbox 
                      label="macOS" 
                      checked={formData.targets.includes("mac")} 
                      disabled={user?.plan === "free"}
                      onCheckedChange={() => toggleTarget("mac")} 
                    />
                  </div>
                  {user?.plan === "free" && (
                    <p className="text-[10px] text-amber-500/80 bg-amber-500/5 p-2 rounded border border-amber-500/10">
                      Note: macOS builds require a PRO plan subscription.
                    </p>
                  )}
                </div>
              </CardContent>
            </Card>
          )}

          {/* STEP 3: REVIEW */}
          {step === 2 && (
            <Card className="bg-zinc-900 border-zinc-800 overflow-hidden">
              <div className="bg-indigo-600/10 p-6 border-b border-indigo-500/20">
                <div className="flex items-center gap-4">
                  <div className="w-12 h-12 bg-indigo-500/20 rounded-2xl flex items-center justify-center text-indigo-400">
                    <Rocket className="w-6 h-6" />
                  </div>
                  <div>
                    <h3 className="text-white font-bold">Ready to Launch</h3>
                    <p className="text-indigo-400/80 text-xs">Review your configuration before starting.</p>
                  </div>
                </div>
              </div>
              <CardContent className="p-6 space-y-4">
                <ReviewItem label="App Name" value={formData.name || "Untitled App"} />
                <ReviewItem label="App ID" value={formData.appId} />
                <ReviewItem label="Source" value={formData.sourceType === 'github' ? formData.sourceUrl : 'ZIP Upload'} />
                <ReviewItem label="Mode" value={formData.mode.toUpperCase()} />
                <ReviewItem label="Targets" value={formData.targets.join(", ").toUpperCase()} />
                
                <div className="mt-8 p-4 bg-zinc-950 rounded-xl border border-zinc-800">
                  <div className="flex items-center gap-2 mb-2">
                    <Info className="w-4 h-4 text-indigo-400" />
                    <span className="text-sm font-bold text-white">Estimated Build Time</span>
                  </div>
                  <p className="text-sm text-zinc-500">
                    Based on your selection of {formData.targets.length} target(s), this build will take approximately {formData.targets.length * 2}-5 minutes.
                  </p>
                </div>
              </CardContent>
            </Card>
          )}

          {/* Navigation Buttons */}
          <div className="flex items-center justify-between pt-4">
            <Button 
              variant="ghost" 
              onClick={prevStep} 
              className={cn("text-zinc-500 hover:text-white hover:bg-zinc-900 rounded-xl", step === 0 && "invisible")}
            >
              <ChevronLeft className="w-4 h-4 mr-2" />
              Back
            </Button>
            
            {step < STEPS.length - 1 ? (
              <Button 
                onClick={nextStep} 
                disabled={step === 0 && formData.sourceType === 'github' && !formData.sourceUrl}
                className="bg-zinc-100 text-zinc-950 hover:bg-white rounded-xl px-8"
              >
                Continue
                <ChevronRight className="w-4 h-4 ml-2" />
              </Button>
            ) : (
              <Button 
                onClick={handleSubmit} 
                disabled={loading}
                className="bg-indigo-600 hover:bg-indigo-500 text-white rounded-xl px-8 shadow-[0_0_20px_rgba(99,102,241,0.3)]"
              >
                {loading ? "Starting..." : "Start Conversion"}
                <Rocket className="w-4 h-4 ml-2" />
              </Button>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}

function SourceOption({ icon: Icon, label, description, active, onClick }: any) {
  return (
    <div 
      onClick={onClick}
      className={cn(
        "p-6 border-2 rounded-2xl cursor-pointer transition-all group",
        active ? "bg-indigo-600/10 border-indigo-600 ring-1 ring-indigo-600/50 shadow-[0_0_20px_rgba(99,102,241,0.1)]" : 
        "bg-zinc-900/30 border-zinc-800 hover:border-zinc-700"
      )}
    >
      <Icon className={cn("w-8 h-8 mb-4 transition-colors", active ? "text-indigo-400" : "text-zinc-600 group-hover:text-zinc-500")} />
      <h3 className={cn("font-bold text-sm", active ? "text-white" : "text-zinc-400")}>{label}</h3>
      <p className="text-xs text-zinc-600 mt-1">{description}</p>
    </div>
  );
}

function ModeOption({ value, label, desc }: any) {
  return (
    <div className="flex items-center space-x-2">
      <RadioGroupItem value={value} id={value} className="text-indigo-600" />
      <Label htmlFor={value} className="cursor-pointer">
        <span className="block font-bold text-sm text-white">{label}</span>
        <span className="block text-[10px] text-zinc-500">{desc}</span>
      </Label>
    </div>
  );
}

function TargetCheckbox({ label, checked, onCheckedChange, disabled }: any) {
  return (
    <div className={cn("flex items-center space-x-2", disabled && "opacity-40 cursor-not-allowed")}>
      <Checkbox id={label} checked={checked} onCheckedChange={onCheckedChange} disabled={disabled} />
      <label htmlFor={label} className="text-sm font-medium text-zinc-300 cursor-pointer uppercase tracking-tight">
        {label}
      </label>
    </div>
  );
}

function ReviewItem({ label, value }: { label: string, value: string }) {
  return (
    <div className="flex justify-between items-start py-2">
      <span className="text-xs font-bold text-zinc-600 uppercase tracking-widest">{label}</span>
      <span className="text-sm font-medium text-zinc-300 text-right max-w-xs truncate">{value}</span>
    </div>
  );
}
