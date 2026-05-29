"use client";

import { useEffect, useState, useRef, useCallback } from "react";
import { useParams, useRouter } from "next/navigation";
import { TopBar } from "@/components/layout/TopBar";
import { ConversionLog } from "@/components/conversion/ConversionLog";
import { conversionsApi } from "@/lib/api-client";
import type { Conversion, ConversionStatus } from "@/types";
import {
  Card,
  CardContent,
  CardHeader,
  CardTitle,
  CardDescription,
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
  ArrowLeft,
  Timer,
} from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { cn } from "@/lib/utils";
import { Skeleton } from "@/components/ui/skeleton";

// ─── Pipeline stage map ──────────────────────────────────────────────────────

const STAGE_ORDER: ConversionStatus[] = [
  "queued",
  "detecting",
  "planning",
  "transforming",
  "scaffolding",
  "installing",
  "building",
  "packaging",
  "done",
];

const STAGE_LABELS: Record<string, string> = {
  queued: "Queued",
  detecting: "Detecting stack",
  planning: "Planning transforms",
  transforming: "Applying transforms",
  scaffolding: "Scaffolding app",
  installing: "Installing dependencies",
  building: "Building",
  packaging: "Packaging installer",
  done: "Complete",
  failed: "Failed",
  cancelled: "Cancelled",
  running: "Running",
};

function stageProgress(status: ConversionStatus): number {
  if (status === "done") return 100;
  if (status === "failed" || status === "cancelled") return 0;
  const idx = STAGE_ORDER.indexOf(status);
  if (idx < 0) return 0;
  return Math.round((idx / (STAGE_ORDER.length - 1)) * 100);
}

const ACTIVE_STATUSES: ConversionStatus[] = [
  "queued",
  "detecting",
  "planning",
  "transforming",
  "scaffolding",
  "installing",
  "building",
  "packaging",
];
const TERMINAL_STATUSES: ConversionStatus[] = ["done", "failed", "cancelled"];

function getStageIndexByProgress(
  status: ConversionStatus,
  progress: number,
): number {
  if (status === "done" || progress >= 100) return 8;
  if (status === "failed" || status === "cancelled") return -1;
  if (progress < 10) return 0;
  if (progress < 20) return 1;
  if (progress < 30) return 2;
  if (progress < 45) return 3;
  if (progress < 60) return 4;
  if (progress < 75) return 5;
  if (progress < 90) return 6;
  return 7; // packaging
}

function getActiveStageLabelByProgress(progress: number): string {
  if (progress < 10) return "Queued";
  if (progress < 20) return "Detecting stack";
  if (progress < 30) return "Planning transforms";
  if (progress < 45) return "Applying transforms";
  if (progress < 60) return "Scaffolding app";
  if (progress < 75) return "Installing dependencies";
  if (progress < 90) return "Building";
  if (progress < 100) return "Packaging installer";
  return "Complete";
}

// ─── Component ───────────────────────────────────────────────────────────────

export default function JobDetailPage() {
  const { id } = useParams<{ id: string }>();
  const router = useRouter();
  const [job, setJob] = useState<Conversion | null>(null);
  const [loading, setLoading] = useState(true);
  const [isDeleting, setIsDeleting] = useState(false);
  const [logLines, setLogLines] = useState<string[]>([]);
  const [sseConnected, setSseConnected] = useState(false);
  const logEndRef = useRef<HTMLDivElement>(null);
  const esRef = useRef<EventSource | null>(null);
  const pollRef = useRef<ReturnType<typeof setInterval> | null>(null);

  const [countdown, setCountdown] = useState<number | null>(null);
  const lastJobIdRef = useRef<string | null>(null);
  const lastEstimatedWaitRef = useRef<number | null>(null);

  const [displayProgress, setDisplayProgress] = useState(0);
  const progressRef = useRef(0);
  const statusRef = useRef<ConversionStatus | null>(null);
  const isActiveRef = useRef(false);

  // Sync displayProgress with backend progress, but smoothly
  useEffect(() => {
    if (job) {
      const normStatus = job.status;
      const progressVal = typeof job.progress === "number" ? job.progress : stageProgress(normStatus);
      const isActiveVal = ACTIVE_STATUSES.includes(normStatus) || normStatus === "running";

      progressRef.current = progressVal;
      statusRef.current = normStatus;
      isActiveRef.current = isActiveVal;

      if (!isActiveVal) {
        setDisplayProgress(normStatus === "done" ? 100 : 0);
      }
    }
  }, [job?.status, job?.progress]);

  // Continuous ticking interval for smooth gradual movement & fast catchups
  useEffect(() => {
    let lastCreepTime = Date.now();

    const timer = setInterval(() => {
      const currentProgress = progressRef.current;
      const currentStatus = statusRef.current;
      const currentIsActive = isActiveRef.current;

      if (!currentIsActive) {
        if (currentStatus === "done") {
          setDisplayProgress(100);
        } else {
          setDisplayProgress(0);
        }
        return;
      }

      setDisplayProgress((prev) => {
        if (!currentIsActive) return prev;

        if (prev === 0 && currentProgress > 0) {
          return currentProgress;
        }

        if (prev < currentProgress) {
          // Catch up phase: increment every 100ms
          const diff = currentProgress - prev;
          const step = diff > 20 ? 2 : 1;
          return Math.min(prev + step, currentProgress);
        } else {
          // Slow creep phase: increment by 1% every 2000ms
          const now = Date.now();
          if (now - lastCreepTime >= 2000) {
            lastCreepTime = now;
            const maxCreepLimit = Math.min(currentProgress + 8, 98);
            if (prev < maxCreepLimit) {
              return prev + 1;
            }
          }
          return prev;
        }
      });
    }, 100);

    return () => clearInterval(timer);
  }, []);

  // Sync countdown with job.estimatedWait, without overriding ticking progress on job updates
  useEffect(() => {
    if (!job) {
      setCountdown(null);
      lastJobIdRef.current = null;
      lastEstimatedWaitRef.current = null;
      return;
    }

    const currentWait = typeof job.estimatedWait === "number" ? job.estimatedWait : null;

    if (job.id !== lastJobIdRef.current || currentWait !== lastEstimatedWaitRef.current) {
      lastJobIdRef.current = job.id;
      lastEstimatedWaitRef.current = currentWait;
      setCountdown(currentWait);
    }
  }, [job?.id, job?.estimatedWait]);

  // Tick the countdown down every second if active
  useEffect(() => {
    const normStatus = job?.status;
    const isActive = normStatus && (ACTIVE_STATUSES.includes(normStatus) || normStatus === "running");
    if (!isActive) return;

    const timer = setInterval(() => {
      setCountdown((prev) => {
        if (prev !== null && prev > 0) {
          return prev - 1;
        }
        return prev;
      });
    }, 1000);

    return () => clearInterval(timer);
  }, [job?.status]);

  // ── Fetch initial job state ────────────────────────────────────────────────
  const fetchJob = useCallback(async () => {
    try {
      const res = await conversionsApi.get(id);
      if (res.data) {
        setJob(res.data);
        // Seed log from liveLogLines on first load
        if (res.data.liveLogLines && res.data.liveLogLines.length > 0) {
          setLogLines(res.data.liveLogLines);
        }
      }
    } catch (error) {
      console.error("Failed to fetch job detail:", error);
    } finally {
      setLoading(false);
    }
  }, [id]);

  useEffect(() => {
    fetchJob();
  }, [fetchJob]);

  // ── SSE stream ────────────────────────────────────────────────────────────
  useEffect(() => {
    if (!job) return;
    if (TERMINAL_STATUSES.includes(job.status)) return;

    // Close any existing stream
    if (esRef.current) {
      esRef.current.close();
      esRef.current = null;
    }

    const es = conversionsApi.streamLogs(id, (event) => {
      if (event.type === "log" && event.line) {
        setLogLines((prev) => [...prev, event.line!]);
      }
      if (event.type === "status" && event.status) {
        setJob((prev) =>
          prev ? { ...prev, status: event.status as ConversionStatus } : prev,
        );
      }
      if (event.type === "progress" && typeof event.progress === "number") {
        setJob((prev) => (prev ? { ...prev, progress: event.progress } : prev));
      }
      if (event.type === "done") {
        setSseConnected(false);
        // Final fetch to get complete job data (artifacts etc.)
        fetchJob();
        es?.close();
      }
      if (event.type === "ping") {
        // keepalive — no action needed
      }
    });

    if (es) {
      esRef.current = es;
      es.onopen = () => setSseConnected(true);
      es.onerror = () => {
        setSseConnected(false);
        // SSE failed — fall back to polling
        es.close();
        esRef.current = null;
        startPolling();
      };
    } else {
      // EventSource not available — use polling
      startPolling();
    }

    return () => {
      es?.close();
      esRef.current = null;
      setSseConnected(false);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [id, job?.status]);

  // ── Fallback polling ──────────────────────────────────────────────────────
  function startPolling() {
    if (pollRef.current) return; // already polling
    pollRef.current = setInterval(async () => {
      try {
        const res = await conversionsApi.get(id);
        if (res.data) {
          setJob(res.data);
          if (res.data.liveLogLines && res.data.liveLogLines.length > 0) {
            setLogLines(res.data.liveLogLines);
          }
          if (TERMINAL_STATUSES.includes(res.data.status)) {
            clearInterval(pollRef.current!);
            pollRef.current = null;
          }
        }
      } catch (err) {
        console.error("Polling error:", err);
      }
    }, 3000);
  }

  useEffect(() => {
    return () => {
      if (pollRef.current) clearInterval(pollRef.current);
      if (esRef.current) esRef.current.close();
    };
  }, []);

  // ── Auto-scroll logs ──────────────────────────────────────────────────────
  useEffect(() => {
    logEndRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [logLines.length]);

  const handleDownload = async (platform: string) => {
    try {
      const res = await conversionsApi.getDownloadUrl(id, platform);
      if (res.data?.url) {
        window.open(res.data.url, "_blank");
      }
    } catch (err) {
      alert("Failed to get download URL");
    }
  };

  // ── Loading skeleton ──────────────────────────────────────────────────────
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
        <Button variant="link" onClick={() => router.push("/jobs")}>
          Back to My Jobs
        </Button>
      </div>
    );
  }

  const normStatus = job.status;
  const progress =
    typeof job.progress === "number" ? job.progress : stageProgress(normStatus);
  const isActive =
    ACTIVE_STATUSES.includes(normStatus) || normStatus === "running";
  const artifacts = job.artifacts ?? [];

  const activeLabel =
    normStatus === "running"
      ? getActiveStageLabelByProgress(progress)
      : STAGE_LABELS[normStatus] || job.status;

  return (
    <div className="min-h-screen bg-zinc-950">
      <TopBar title={job.name} />

      <div className="p-8 space-y-8 max-w-7xl mx-auto">
        <div className="flex items-center gap-4">
          <Button
            variant="ghost"
            size="icon"
            onClick={() => router.push("/jobs")}
            className="text-zinc-500 hover:text-white"
          >
            <ArrowLeft className="w-5 h-5" />
          </Button>
          <div className="flex items-center gap-3 flex-1 flex-wrap">
            <h2 className="text-2xl font-bold text-white">{job.name}</h2>
            <StatusBadge status={job.status} />
            {/* Estimated wait time */}
            {isActive && countdown !== null && countdown > 0 && (
              <span className="flex items-center gap-1 text-xs text-zinc-500 bg-zinc-900 border border-zinc-800 rounded-full px-2.5 py-1">
                <Timer className="w-3 h-3 animate-pulse text-indigo-400" />
                ~{formatCountdown(countdown)} remaining
              </span>
            )}
          </div>
        </div>

        {/* Pipeline progress bar */}
        {(isActive || normStatus === "done") && (
          <div className="space-y-2">
            <div className="flex items-center justify-between text-xs text-zinc-500">
              <span className="font-medium uppercase tracking-widest">
                {activeLabel}
              </span>
              <span>{displayProgress}%</span>
            </div>
            <Progress value={displayProgress} className="h-2 bg-zinc-900" />
            {/* Stage markers */}
            <div className="flex justify-between px-0.5">
              {STAGE_ORDER.slice(0, -1).map((stage, i) => {
                const idx = getStageIndexByProgress(normStatus, displayProgress);
                const isPast = i < idx;
                const isCurrent = i === idx;
                return (
                  <div key={stage} className="flex flex-col items-center gap-1">
                    <div
                      className={cn(
                        "w-1.5 h-1.5 rounded-full transition-colors",
                        isCurrent
                          ? "bg-indigo-500 ring-2 ring-indigo-500/30"
                          : isPast
                            ? "bg-emerald-500"
                            : "bg-zinc-700",
                      )}
                    />
                  </div>
                );
              })}
            </div>
          </div>
        )}

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
                <SummaryItem
                  label="Source"
                  value={job.sourceUrl || "Uploaded ZIP"}
                />
                <SummaryItem
                  label="Targets"
                  value={job.targets.join(", ").toUpperCase()}
                />
                <SummaryItem
                  label="Created"
                  value={new Date(job.createdAt).toLocaleString()}
                />
                <SummaryItem label="Job ID" value={job.id} />
              </CardContent>
            </Card>

            <Card
              className={cn(
                "border-2",
                job.status === "done" && artifacts.length > 0
                  ? "bg-emerald-500/5 border-emerald-500/20"
                  : "bg-zinc-900/50 border-zinc-800",
              )}
            >
              <CardHeader>
                <CardTitle className="text-sm font-bold uppercase tracking-widest text-zinc-400">
                  Artifacts
                </CardTitle>
              </CardHeader>
              <CardContent className="space-y-4">
                {job.status === "done" && artifacts.length > 0 ? (
                  <div className="space-y-3">
                    {artifacts.map((artifact) => (
                      <div
                        key={artifact.id}
                        className="flex items-center justify-between p-3 bg-zinc-950 border border-zinc-800 rounded-xl group hover:border-indigo-500/50 transition-colors"
                      >
                        <div className="flex items-center gap-3">
                          <div className="w-8 h-8 rounded-lg bg-zinc-900 flex items-center justify-center font-bold text-[10px] text-zinc-500">
                            {artifact.platform?.[0]?.toUpperCase()}
                          </div>
                          <div>
                            <p className="text-xs font-bold text-white uppercase">
                              {artifact.platform}
                            </p>
                            <p className="text-[10px] text-zinc-500">
                              {artifactLabel(
                                artifact.s3Key,
                                artifact.sizeBytes,
                              )}
                            </p>
                          </div>
                        </div>
                        <Button
                          size="sm"
                          onClick={() => handleDownload(artifact.platform)}
                          className="bg-emerald-600 hover:bg-emerald-500 text-[10px] h-8 font-bold"
                        >
                          <Download className="w-3 h-3 mr-1" /> Download
                        </Button>
                      </div>
                    ))}
                  </div>
                ) : job.status === "done" ? (
                  <div className="text-center py-6">
                    <AlertTriangle className="w-12 h-12 text-amber-500 mx-auto mb-3" />
                    <p className="text-sm text-zinc-400 font-medium">
                      No artifacts were produced
                    </p>
                    <p className="text-xs text-zinc-600 mt-1 max-w-[220px] mx-auto">
                      Check the build log for skipped platforms or worker
                      constraints.
                    </p>
                  </div>
                ) : job.status === "failed" ? (
                  <div className="text-center py-6">
                    <XCircle className="w-12 h-12 text-rose-500 mx-auto mb-3" />
                    <p className="text-sm text-zinc-400 font-medium">
                      Build failed
                    </p>
                    <p className="text-xs text-zinc-600 mt-1 max-w-[180px] mx-auto">
                      {job.errorMessage ||
                        "An unknown error occurred during the pipeline."}
                    </p>
                    <Button
                      variant="outline"
                      size="sm"
                      className="mt-4 border-zinc-800 text-zinc-400 hover:text-white"
                      onClick={() => router.push("/jobs/new")}
                    >
                      <RefreshCw className="w-3 h-3 mr-1" /> Retry
                    </Button>
                  </div>
                ) : (
                  <div className="text-center py-12">
                    <Clock className="w-10 h-10 text-zinc-700 mx-auto mb-3 animate-pulse" />
                    <p className="text-xs text-zinc-500 uppercase font-bold tracking-widest">
                      Building artifacts...
                    </p>
                    <p className="text-[10px] text-zinc-600 mt-2">
                      Available once the pipeline completes.
                    </p>
                  </div>
                )}
              </CardContent>
            </Card>

            <Button
              variant="ghost"
              className="w-full text-zinc-600 hover:text-rose-400 hover:bg-rose-500/5 disabled:opacity-50"
              disabled={isDeleting}
              onClick={async () => {
                if (
                  confirm(
                    `Are you sure you want to delete "${job.name}" and all of its artifacts?`,
                  )
                ) {
                  setIsDeleting(true);
                  try {
                    const res = await conversionsApi.delete(id);
                    if (res.error) {
                      alert(res.error);
                    } else {
                      router.push("/jobs");
                    }
                  } catch (err) {
                    alert("An error occurred while deleting the job.");
                  } finally {
                    setIsDeleting(false);
                  }
                }
              }}
            >
              <Trash2
                className={cn("w-4 h-4 mr-2", isDeleting && "animate-spin")}
              />
              {isDeleting ? "Deleting..." : "Delete Job History"}
            </Button>
          </div>

          {/* Right Column: Live Logs */}
          <div className="lg:col-span-2">
            <ConversionLog logs={logLines} isConnected={sseConnected} />
          </div>
        </div>
      </div>
    </div>
  );
}

function SummaryItem({ label, value }: { label: string; value: string }) {
  return (
    <div className="space-y-1">
      <p className="text-[10px] font-bold text-zinc-600 uppercase tracking-widest">
        {label}
      </p>
      <p className="text-sm font-medium text-zinc-300 truncate" title={value}>
        {value}
      </p>
    </div>
  );
}

function artifactLabel(s3Key: string | undefined, sizeBytes: number): string {
  const fileName = s3Key?.split("/").pop() ?? "Production installer";
  return sizeBytes > 0 ? `${fileName} - ${formatBytes(sizeBytes)}` : fileName;
}

function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / 1024 / 1024).toFixed(1)} MB`;
}

function StatusBadge({ status }: { status: ConversionStatus }) {
  const styles: Record<string, string> = {
    done: "bg-emerald-500/10 text-emerald-500 border-emerald-500/20",
    failed: "bg-rose-500/10 text-rose-500 border-rose-500/20",
    cancelled: "bg-zinc-800 text-zinc-500 border-zinc-700",
    default:
      "bg-indigo-500/10 text-indigo-400 border-indigo-500/20 animate-pulse",
  };

  const style = styles[status] ?? styles.default;

  return (
    <Badge
      variant="outline"
      className={cn("px-2 py-0.5 text-[10px] font-bold uppercase", style)}
    >
      {STAGE_LABELS[status] ?? status}
    </Badge>
  );
}

function formatCountdown(seconds: number): string {
  if (seconds < 0) return "0:00";
  const mins = Math.floor(seconds / 60);
  const secs = seconds % 60;
  return `${mins}:${secs.toString().padStart(2, "0")}`;
}
