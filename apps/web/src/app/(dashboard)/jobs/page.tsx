"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { TopBar } from "@/components/layout/TopBar";
import { conversionsApi } from "@/lib/api-client";
import type { Conversion, ConversionStatus } from "@/types";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import {
  Plus,
  Search,
  Filter,
  MoreVertical,
  ExternalLink,
  Trash2,
  AlertCircle,
  Clock,
} from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import { cn } from "@/lib/utils";

export default function JobsPage() {
  const [jobs, setJobs] = useState<Conversion[]>([]);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState("");

  useEffect(() => {
    async function fetchData() {
      try {
        const res = await conversionsApi.list();
        if (res.data) {
          const jobsArray = Array.isArray(res.data)
            ? res.data
            : (res.data as any).data || [];
          setJobs(jobsArray);
        }
      } catch (error) {
        console.error("Failed to fetch jobs:", error);
      } finally {
        setLoading(false);
      }
    }
    fetchData();
  }, []);

  const filteredJobs = jobs.filter((job) =>
    job.name.toLowerCase().includes(search.toLowerCase()),
  );

  return (
    <div className="min-h-screen bg-[#020514]">
      <TopBar title="My Conversions" />

      <div className="p-8 space-y-6 max-w-7xl mx-auto">
        {/* Header Actions */}
        <div className="flex flex-col md:flex-row md:items-center justify-between gap-4">
          <div className="relative flex-1 max-w-md">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-[#8d99c4]/60" />
            <input
              type="text"
              placeholder="Search by app name..."
              className="w-full bg-[#030720]/50 border border-[#8d99c4]/15 rounded-xl py-2.5 pl-10 pr-4 text-sm text-[#dee3f7]/80 placeholder-[#8d99c4]/40 focus:outline-none focus:ring-1 focus:ring-[#2b72f5] transition-all"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
            />
          </div>

          <div className="flex items-center gap-3">
            <Button
              type="button"
              onClick={() => alert("Filter options coming soon!")}
              variant="outline"
              className="border-[#8d99c4]/15 bg-[#030720]/50 text-[#8d99c4] hover:text-white hover:bg-[#030720] rounded-xl"
            >
              <Filter className="w-4 h-4 mr-2" />
              Filter
            </Button>
            <Button
              asChild
              className="bg-[#2b72f5] hover:bg-[#1a5ecc] rounded-xl shadow-[0_0_20px_rgba(43,114,245,0.3)]"
            >
              <Link href="/jobs/new">
                <Plus className="w-4 h-4 mr-2" />
                New Job
              </Link>
            </Button>
          </div>
        </div>

        {/* Jobs List */}
        <div className="space-y-4">
          {loading ? (
            [1, 2, 3, 4].map((i) => (
              <Skeleton
                key={i}
                className="h-20 w-full bg-[#030720]/50 border border-[#8d99c4]/15 rounded-2xl"
              />
            ))
          ) : filteredJobs.length > 0 ? (
            filteredJobs.map((job) => (
              <JobRow
                key={job.id}
                job={job}
                onDelete={(id) =>
                  setJobs((prev) => prev.filter((j) => j.id !== id))
                }
              />
            ))
          ) : (
            <div className="py-24 flex flex-col items-center justify-center border border-dashed border-[#8d99c4]/15 rounded-[2rem] bg-[#030720]/10">
              <div className="w-16 h-16 bg-[#030720] border border-[#8d99c4]/10 rounded-full flex items-center justify-center mb-4">
                <AlertCircle className="w-8 h-8 text-[#8d99c4]/30" />
              </div>
              <h3 className="text-white font-bold text-lg">No jobs found</h3>
              <p className="text-[#8d99c4] text-sm mt-1 max-w-xs text-center">
                {search
                  ? `We couldn't find any jobs matching "${search}"`
                  : "You haven't created any conversion jobs yet."}
              </p>
              {!search && (
                <Button
                  asChild
                  className="mt-6 bg-[#030720] hover:bg-[#030720]/80 border border-[#8d99c4]/15 text-[#dee3f7] rounded-xl"
                >
                  <Link href="/jobs/new">Create your first job</Link>
                </Button>
              )}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

function JobRow({
  job,
  onDelete,
}: {
  job: Conversion;
  onDelete: (id: string) => void;
}) {
  const [isDeleting, setIsDeleting] = useState(false);
  return (
    <Card className="bg-[#030720]/30 border-[#8d99c4]/15 hover:border-[#2b72f5]/50 transition-all group overflow-hidden">
      <CardContent className="p-0">
        <Link
          href={`/jobs/${job.id}`}
          className="flex flex-col md:flex-row md:items-center justify-between p-5 gap-4"
        >
          <div className="flex items-center gap-4">
            <div className="w-12 h-12 bg-[#020514] border border-[#8d99c4]/10 rounded-xl flex items-center justify-center text-[#8d99c4] group-hover:bg-[#2b72f5]/15 group-hover:text-[#2b72f5] group-hover:border-[#2b72f5]/25 transition-all">
              {job?.name?.[0]?.toUpperCase()}
            </div>
            <div>
              <div className="flex items-center gap-2">
                <h4 className="font-bold text-white group-hover:text-[#2b72f5] transition-colors">
                  {job.name}
                </h4>
                <StatusBadge status={job.status} />
              </div>
              <p className="text-xs text-[#8d99c4] mt-1 flex items-center gap-3">
                <span className="flex items-center gap-1">
                  <Clock className="w-3 h-3" />{" "}
                  {new Date(job.createdAt).toLocaleDateString()}
                </span>
                <span className="w-1 h-1 bg-[#8d99c4]/20 rounded-full" />
                <span className="flex items-center gap-1 font-mono">
                  {job.id.slice(0, 8)}
                </span>
              </p>
            </div>
          </div>

          <div className="flex flex-wrap items-center gap-3 md:gap-8">
            <div className="flex -space-x-2">
              {job.targets.map((t) => (
                <div
                  key={t}
                  className="w-8 h-8 rounded-full bg-[#020514] border-2 border-[#020514] flex items-center justify-center text-[10px] font-bold text-[#8d99c4] uppercase"
                >
                  {t?.[0]}
                </div>
              ))}
            </div>

            <div className="flex items-center gap-2">
              <Button
                type="button"
                onClick={(e) => {
                  e.preventDefault();
                  e.stopPropagation();
                  alert("External link coming soon!");
                }}
                variant="ghost"
                size="icon"
                className="h-8 w-8 text-[#8d99c4] hover:text-white rounded-lg"
              >
                <ExternalLink className="w-4 h-4" />
              </Button>
              <Button
                type="button"
                onClick={async (e) => {
                  e.preventDefault();
                  e.stopPropagation();
                  if (
                    confirm(
                      `Are you sure you want to delete "${job.name}" and all of its artifacts?`,
                    )
                  ) {
                    setIsDeleting(true);
                    try {
                      const res = await conversionsApi.delete(job.id);
                      if (res.error) {
                        alert(res.error);
                      } else {
                        onDelete(job.id);
                      }
                    } catch (err) {
                      alert("An error occurred while deleting the job.");
                    } finally {
                      setIsDeleting(false);
                    }
                  }
                }}
                disabled={isDeleting}
                variant="ghost"
                size="icon"
                className="h-8 w-8 text-[#8d99c4] hover:text-rose-400 rounded-lg disabled:opacity-50"
              >
                <Trash2
                  className={cn("w-4 h-4", isDeleting && "animate-spin")}
                />
              </Button>
              <Button
                type="button"
                onClick={(e) => {
                  e.preventDefault();
                  e.stopPropagation();
                  alert("More options coming soon!");
                }}
                variant="ghost"
                size="icon"
                className="h-8 w-8 text-[#8d99c4] hover:text-white rounded-lg"
              >
                <MoreVertical className="w-4 h-4" />
              </Button>
            </div>
          </div>
        </Link>
      </CardContent>
    </Card>
  );
}

const STATUS_LABELS: Partial<Record<ConversionStatus, string>> = {
  queued: "Queued",
  running: "Running",
  done: "Done",
  failed: "Failed",
  cancelled: "Cancelled",
};

function StatusBadge({ status }: { status: ConversionStatus }) {
  const styles: Partial<Record<ConversionStatus | "default", string>> = {
    done: "bg-emerald-500/10 text-emerald-500 border-emerald-500/20",
    failed: "bg-rose-500/10 text-rose-500 border-rose-500/20",
    cancelled: "bg-[#030720] text-[#8d99c4] border-[#8d99c4]/15",
    default:
      "bg-[#2b72f5]/10 text-[#2b72f5] border-[#2b72f5]/20 animate-pulse",
  };

  const style = styles[status] || styles.default;

  return (
    <Badge
      variant="outline"
      className={cn(
        "px-2 py-0.5 text-[9px] font-bold uppercase tracking-wider",
        style,
      )}
    >
      {STATUS_LABELS[status] ?? status}
    </Badge>
  );
}
