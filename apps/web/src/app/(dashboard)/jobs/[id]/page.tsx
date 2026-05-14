"use client";

import { useEffect, useState, useRef } from "react";
import { useParams, useRouter } from "next/navigation";
import { TopBar } from "@/components/layout/TopBar";
import { conversionsApi, downloadsApi } from "@/lib/api-client";
import type { Conversion } from "@/types";
import { 
  Card, 
  CardContent, 
  CardHeader, 
  CardTitle, 
  CardDescription 
} from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Progress } from "@/components/ui/progress";
import { 
  Download, 
  Terminal as TerminalIcon, 
  Settings, 
  Clock, 
  AlertTriangle,
  CheckCircle2,
  XCircle,
  RefreshCw,
  Trash2,
  ArrowLeft
} from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { cn } from "@/lib/utils";
import { Skeleton } from "@/components/ui/skeleton";

export default function JobDetailPage() {
  const { id } = useParams<{ id: string }>();
  const router = useRouter();
  const [job, setJob] = useState<Conversion | null>(null);
  const [loading, setLoading] = useState(true);
  const [polling, setPolling] = useState(false);
  const logEndRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    async function fetchJob() {
      try {
        const res = await conversionsApi.get(id);
        if (res.data) {
          setJob(res.data);
          // Start polling if job is active
          if (["queued", "detecting", "planning", "transforming", "scaffolding", "installing", "building", "packaging"].includes(res.data.status)) {
            setPolling(true);
          } else {
            setPolling(false);
          }
        }
      } catch (error) {
        console.error("Failed to fetch job detail:", error);
      } finally {
        setLoading(false);
      }
    }
    fetchJob();
  }, [id]);

  // Polling logic
  useEffect(() => {
    if (!polling) return;

    const interval = setInterval(async () => {
      try {
        const res = await conversionsApi.get(id);
        if (res.data) {
          setJob(res.data);
          if (["done", "failed", "cancelled"].includes(res.data.status)) {
            setPolling(false);
          }
        }
      } catch (err) {
        console.error("Polling error:", err);
      }
    }, 3000);

    return () => clearInterval(interval);
  }, [polling, id]);

  // Auto-scroll logs
  useEffect(() => {
    logEndRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [job?.status]);

  const handleDownload = async () => {
    try {
      const res = await downloadsApi.getUrl(id);
      if (res.data?.downloadUrl) {
        window.open(res.data.downloadUrl, "_blank");
      }
    } catch (err) {
      alert("Failed to get download URL");
    }
  };

  if (loading) {
    return (
      <div className="min-h-screen bg-zinc-950">
        <TopBar title="Loading Job..." />
        <div className="p-8 max-w-7xl mx-auto space-y-6">
          <Skeleton className="h-40 w-full bg-zinc-900" />
          <Skeleton className="h-64 w-full bg-zinc-900" />
        </div>
      </div>
    );
  }

  if (!job) {
    return (
      <div className="min-h-screen bg-zinc-950 flex flex-col items-center justify-center">
        <AlertTriangle className="w-16 h-16 text-zinc-800 mb-4" />
        <h2 className="text-xl font-bold text-white">Job Not Found</h2>
        <Button variant="link" onClick={() => router.push("/jobs")}>Back to My Jobs</Button>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-zinc-950">
      <TopBar title={job.name} />
      
      <div className="p-8 space-y-8 max-w-7xl mx-auto">
        <div className="flex items-center gap-4">
          <Button variant="ghost" size="icon" onClick={() => router.push("/jobs")} className="text-zinc-500 hover:text-white">
            <ArrowLeft className="w-5 h-5" />
          </Button>
          <div className="flex items-center gap-3">
            <h2 className="text-2xl font-bold text-white">{job.name}</h2>
            <StatusBadge status={job.status} />
          </div>
        </div>

        <div className="grid grid-cols-1 lg:grid-cols-3 gap-8">
          {/* Left Column: Summary & Downloads */}
          <div className="space-y-6">
            <Card className="bg-zinc-900/50 border-zinc-800 overflow-hidden">
              <CardHeader className="bg-zinc-900/80 border-b border-zinc-800">
                <CardTitle className="text-sm font-bold uppercase tracking-widest text-zinc-400 flex items-center gap-2">
                  <Settings className="w-4 h-4" /> Build Summary
                </CardTitle>
              </CardHeader>
              <CardContent className="pt-6 space-y-4">
                <SummaryItem label="Source" value={job.sourceUrl || "Uploaded ZIP"} />
                <SummaryItem label="Targets" value={job.targets.join(", ").toUpperCase()} />
                <SummaryItem label="Created" value={new Date(job.createdAt).toLocaleString()} />
                <SummaryItem label="Job ID" value={job.id} />
              </CardContent>
            </Card>

            <Card className={cn(
              "border-2",
              job.status === "done" ? "bg-emerald-500/5 border-emerald-500/20" : "bg-zinc-900/50 border-zinc-800"
            )}>
              <CardHeader>
                <CardTitle className="text-sm font-bold uppercase tracking-widest text-zinc-400">Artifacts</CardTitle>
              </CardHeader>
              <CardContent className="space-y-4">
                {job.status === "done" ? (
                  <div className="space-y-3">
                    {job.targets.map(target => (
                      <div key={target} className="flex items-center justify-between p-3 bg-zinc-950 border border-zinc-800 rounded-xl group hover:border-indigo-500/50 transition-colors">
                        <div className="flex items-center gap-3">
                          <div className="w-8 h-8 rounded-lg bg-zinc-900 flex items-center justify-center font-bold text-[10px] text-zinc-500">
                            {target[0].toUpperCase()}
                          </div>
                          <div>
                            <p className="text-xs font-bold text-white uppercase">{target}</p>
                            <p className="text-[10px] text-zinc-500">Production Installer</p>
                          </div>
                        </div>
                        <Button size="sm" onClick={handleDownload} className="bg-emerald-600 hover:bg-emerald-500 text-[10px] h-8 font-bold">
                          <Download className="w-3 h-3 mr-1" /> Download
                        </Button>
                      </div>
                    ))}
                  </div>
                ) : job.status === "failed" ? (
                  <div className="text-center py-6">
                    <XCircle className="w-12 h-12 text-rose-500 mx-auto mb-3" />
                    <p className="text-sm text-zinc-400 font-medium">Build failed</p>
                    <p className="text-xs text-zinc-600 mt-1 max-w-[180px] mx-auto">{job.errorMessage || "An unknown error occurred during the pipeline."}</p>
                    <Button variant="outline" size="sm" className="mt-4 border-zinc-800 text-zinc-400 hover:text-white" onClick={() => router.push("/jobs/new")}>
                      <RefreshCw className="w-3 h-3 mr-1" /> Retry
                    </Button>
                  </div>
                ) : (
                  <div className="text-center py-12">
                    <Clock className="w-10 h-10 text-zinc-700 mx-auto mb-3 animate-pulse" />
                    <p className="text-xs text-zinc-500 uppercase font-bold tracking-widest">Building artifacts...</p>
                    <p className="text-[10px] text-zinc-600 mt-2">Available once the pipeline completes.</p>
                  </div>
                )}
              </CardContent>
            </Card>

            <Button variant="ghost" className="w-full text-zinc-600 hover:text-rose-400 hover:bg-rose-500/5">
              <Trash2 className="w-4 h-4 mr-2" /> Delete Job History
            </Button>
          </div>

          {/* Right Column: Live Logs */}
          <div className="lg:col-span-2 space-y-6">
            <Card className="bg-zinc-900/50 border-zinc-800 h-full flex flex-col">
              <CardHeader className="flex flex-row items-center justify-between border-b border-zinc-800/50 bg-zinc-900/30">
                <div className="flex items-center gap-3">
                  <div className="w-8 h-8 rounded-lg bg-zinc-950 flex items-center justify-center">
                    <TerminalIcon className="w-4 h-4 text-emerald-500" />
                  </div>
                  <div>
                    <CardTitle className="text-sm font-bold text-white tracking-tight">Pipeline Console</CardTitle>
                    <CardDescription className="text-[10px] uppercase tracking-tighter">Live Build Output</CardDescription>
                  </div>
                </div>
                {polling && (
                  <div className="flex items-center gap-2 px-3 py-1 bg-emerald-500/10 border border-emerald-500/20 rounded-full">
                    <span className="w-2 h-2 bg-emerald-500 rounded-full animate-pulse" />
                    <span className="text-[10px] font-bold text-emerald-500 uppercase tracking-widest">Streaming</span>
                  </div>
                )}
              </CardHeader>
              <CardContent className="p-0 flex-1 relative bg-black font-mono text-xs leading-relaxed overflow-hidden">
                <div className="absolute inset-0 p-6 overflow-y-auto custom-scrollbar">
                  <div className="space-y-1">
                    <div className="text-zinc-500 mb-2">Initializing pipeline for {job.id}...</div>
                    <div className="text-zinc-300 flex gap-4"><span className="text-zinc-600">01:12:05</span> <span className="text-indigo-400">[DETECTOR]</span> Analysing project stack...</div>
                    <div className="text-zinc-300 flex gap-4"><span className="text-zinc-600">01:12:08</span> <span className="text-indigo-400">[DETECTOR]</span> Match found: Vite + React + Supabase</div>
                    <div className="text-zinc-300 flex gap-4"><span className="text-zinc-600">01:12:12</span> <span className="text-cyan-400">[TRANSFORM]</span> Applying AST transforms to remove external imports...</div>
                    
                    {/* Fake logs based on status for now */}
                    {["transforming", "scaffolding", "installing", "building", "packaging", "done"].includes(job.status) && (
                      <div className="text-zinc-300 flex gap-4"><span className="text-zinc-600">01:12:45</span> <span className="text-amber-400">[SCAFFOLD]</span> Injecting local SQLite database layer...</div>
                    )}
                    
                    {["installing", "building", "packaging", "done"].includes(job.status) && (
                      <div className="text-zinc-300 flex gap-4"><span className="text-zinc-600">01:13:10</span> <span className="text-purple-400">[BUILD]</span> Running vite build for desktop target...</div>
                    )}

                    {job.status === "done" && (
                      <div className="mt-4 pt-4 border-t border-zinc-800">
                        <div className="text-emerald-500 font-bold">✨ BUILD SUCCESSFUL</div>
                        <div className="text-zinc-400">Total time: 1m 45s</div>
                        <div className="text-zinc-400">Artifacts uploaded to S3.</div>
                      </div>
                    )}

                    {job.status === "failed" && (
                      <div className="mt-4 pt-4 border-t border-zinc-800">
                        <div className="text-rose-500 font-bold">✖ BUILD FAILED</div>
                        <div className="text-rose-400/70">{job.errorMessage || "Error: Process exited with code 1"}</div>
                      </div>
                    )}

                    <div ref={logEndRef} />
                  </div>
                </div>
              </CardContent>
            </Card>
          </div>
        </div>
      </div>
    </div>
  );
}

function SummaryItem({ label, value }: { label: string, value: string }) {
  return (
    <div className="space-y-1">
      <p className="text-[10px] font-bold text-zinc-600 uppercase tracking-widest">{label}</p>
      <p className="text-sm font-medium text-zinc-300 truncate" title={value}>{value}</p>
    </div>
  );
}

function StatusBadge({ status }: { status: string }) {
  const styles: any = {
    done: "bg-emerald-500/10 text-emerald-500 border-emerald-500/20",
    failed: "bg-rose-500/10 text-rose-500 border-rose-500/20",
    cancelled: "bg-zinc-800 text-zinc-500 border-zinc-700",
    default: "bg-indigo-500/10 text-indigo-400 border-indigo-500/20 animate-pulse",
  };
  
  const style = styles[status] || styles.default;
  
  return (
    <Badge variant="outline" className={cn("px-2 py-0.5 text-[10px] font-bold uppercase", style)}>
      {status}
    </Badge>
  );
}
