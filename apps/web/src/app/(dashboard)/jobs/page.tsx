"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { TopBar } from "@/components/layout/TopBar";
import { conversionsApi } from "@/lib/api-client";
import type { Conversion } from "@/types";
import { 
  Card, 
  CardContent, 
} from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { 
  Plus, 
  Search,
  Filter,
  MoreVertical,
  ExternalLink,
  Trash2,
  AlertCircle,
  Clock
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
          const jobsArray = Array.isArray(res.data) ? res.data : (res.data as any).data || [];
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

  const filteredJobs = jobs.filter(job => 
    job.name.toLowerCase().includes(search.toLowerCase())
  );

  return (
    <div className="min-h-screen bg-zinc-950">
      <TopBar title="My Conversions" />
      
      <div className="p-8 space-y-6 max-w-7xl mx-auto">
        {/* Header Actions */}
        <div className="flex flex-col md:flex-row md:items-center justify-between gap-4">
          <div className="relative flex-1 max-w-md">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-zinc-500" />
            <input 
              type="text" 
              placeholder="Search by app name..."
              className="w-full bg-zinc-900/50 border border-zinc-800 rounded-xl py-2.5 pl-10 pr-4 text-sm text-zinc-300 focus:outline-none focus:ring-1 focus:ring-indigo-500 transition-all"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
            />
          </div>
          
          <div className="flex items-center gap-3">
            <Button variant="outline" className="border-zinc-800 bg-zinc-900/50 text-zinc-400 hover:text-white hover:bg-zinc-800 rounded-xl">
              <Filter className="w-4 h-4 mr-2" />
              Filter
            </Button>
            <Button asChild className="bg-indigo-600 hover:bg-indigo-500 rounded-xl shadow-[0_0_20px_rgba(99,102,241,0.2)]">
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
            [1, 2, 3, 4].map(i => <Skeleton key={i} className="h-20 w-full bg-zinc-900/50 border border-zinc-800 rounded-2xl" />)
          ) : filteredJobs.length > 0 ? (
            filteredJobs.map(job => (
              <JobRow key={job.id} job={job} />
            ))
          ) : (
            <div className="py-24 flex flex-col items-center justify-center border border-dashed border-zinc-800 rounded-[2rem] bg-zinc-900/10">
              <div className="w-16 h-16 bg-zinc-900 rounded-full flex items-center justify-center mb-4">
                <AlertCircle className="w-8 h-8 text-zinc-700" />
              </div>
              <h3 className="text-white font-bold text-lg">No jobs found</h3>
              <p className="text-zinc-500 text-sm mt-1 max-w-xs text-center">
                {search ? `We couldn't find any jobs matching "${search}"` : "You haven't created any conversion jobs yet."}
              </p>
              {!search && (
                <Button asChild className="mt-6 bg-zinc-800 hover:bg-zinc-700 rounded-xl">
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

function JobRow({ job }: { job: Conversion }) {
  return (
    <Card className="bg-zinc-900/30 border-zinc-800 hover:border-zinc-700 transition-all group overflow-hidden">
      <CardContent className="p-0">
        <Link href={`/jobs/${job.id}`} className="flex flex-col md:flex-row md:items-center justify-between p-5 gap-4">
          <div className="flex items-center gap-4">
            <div className="w-12 h-12 bg-zinc-800 border border-zinc-700 rounded-xl flex items-center justify-center text-zinc-400 group-hover:bg-indigo-500/10 group-hover:text-indigo-400 group-hover:border-indigo-500/20 transition-all">
              {job?.name?.[0]?.toUpperCase()}
            </div>
            <div>
              <div className="flex items-center gap-2">
                <h4 className="font-bold text-white group-hover:text-indigo-400 transition-colors">{job.name}</h4>
                <StatusBadge status={job.status} />
              </div>
              <p className="text-xs text-zinc-500 mt-1 flex items-center gap-3">
                <span className="flex items-center gap-1"><Clock className="w-3 h-3" /> {new Date(job.createdAt).toLocaleDateString()}</span>
                <span className="w-1 h-1 bg-zinc-800 rounded-full" />
                <span className="flex items-center gap-1 font-mono">{job.id.slice(0, 8)}</span>
              </p>
            </div>
          </div>
          
          <div className="flex flex-wrap items-center gap-3 md:gap-8">
            <div className="flex -space-x-2">
              {job.targets.map(t => (
                <div key={t} className="w-8 h-8 rounded-full bg-zinc-800 border-2 border-zinc-950 flex items-center justify-center text-[10px] font-bold text-zinc-400 uppercase">
                  {t?.[0]}
                </div>
              ))}
            </div>
            
            <div className="flex items-center gap-2">
              <Button variant="ghost" size="icon" className="h-8 w-8 text-zinc-500 hover:text-white rounded-lg">
                <ExternalLink className="w-4 h-4" />
              </Button>
              <Button variant="ghost" size="icon" className="h-8 w-8 text-zinc-500 hover:text-rose-400 rounded-lg">
                <Trash2 className="w-4 h-4" />
              </Button>
              <Button variant="ghost" size="icon" className="h-8 w-8 text-zinc-500 hover:text-white rounded-lg">
                <MoreVertical className="w-4 h-4" />
              </Button>
            </div>
          </div>
        </Link>
      </CardContent>
    </Card>
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
    <Badge variant="outline" className={cn("px-2 py-0.5 text-[9px] font-bold uppercase tracking-wider", style)}>
      {status}
    </Badge>
  );
}
