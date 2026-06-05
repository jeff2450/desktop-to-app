"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { TopBar } from "@/components/layout/TopBar";
import { conversionsApi, billingApi } from "@/lib/api-client";
import type { Conversion, ConversionStatus, UsageStats } from "@/types";
import {
  Card,
  CardContent,
  CardHeader,
  CardTitle,
  CardDescription,
} from "@/components/ui/card";
import { Progress } from "@/components/ui/progress";
import { Button } from "@/components/ui/button";
import {
  Plus,
  History,
  CheckCircle2,
  XCircle,
  Clock,
  ArrowUpRight,
  ChevronRight,
} from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import { cn } from "@/lib/utils";

export default function DashboardPage() {
  const [conversions, setConversions] = useState<Conversion[]>([]);
  const [usage, setUsage] = useState<UsageStats | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    async function fetchData() {
      try {
        const [c, u] = await Promise.all([
          conversionsApi.list(),
          billingApi.usage(),
        ]);
        if (c.data) {
          setConversions(c.data);
        }
        if (u.data) setUsage(u.data);
      } catch (error) {
        console.error("Failed to fetch dashboard data:", error);
      } finally {
        setLoading(false);
      }
    }
    fetchData();
  }, []);

  const activeJobs = conversions.filter(
    (c) => !["done", "failed", "cancelled"].includes(c.status),
  );

  const recentJobs = conversions.slice(0, 5);

  return (
    <div className="min-h-screen bg-[#020514]">
      <TopBar title="Overview" />

      <div className="p-8 space-y-8 max-w-7xl mx-auto">
        {/* Welcome & Stats Row */}
        <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
          {/* Usage Meter */}
          <Card className="lg:col-span-2 bg-[#030720]/50 border-[#8d99c4]/15 backdrop-blur-sm overflow-hidden relative">
            <div className="absolute top-0 right-0 p-8 opacity-5">
              <History className="w-32 h-32" />
            </div>
            <CardHeader>
              <div className="flex justify-between items-start">
                <div>
                  <CardTitle className="text-xl font-bold">
                    Monthly Usage
                  </CardTitle>
                  <CardDescription className="text-[#8d99c4]">
                    Track your conversion limits for this month
                  </CardDescription>
                </div>
                {usage && (
                  <Badge
                    variant="outline"
                    className="bg-[#2b72f5]/15 text-[#2b72f5] border-[#2b72f5]/20 px-3 py-1"
                  >
                    {usage.plan.toUpperCase()} PLAN
                  </Badge>
                )}
              </div>
            </CardHeader>
            <CardContent>
              {loading ? (
                <div className="space-y-4">
                  <Skeleton className="h-4 w-full bg-[#030720]" />
                  <Skeleton className="h-2 w-full bg-[#030720]" />
                </div>
              ) : usage ? (
                <div className="space-y-6">
                  <div className="flex justify-between items-end">
                    <div className="space-y-1">
                      <p className="text-3xl font-bold text-white">
                        {usage.usage}{" "}
                        <span className="text-[#8d99c4] text-lg font-normal">
                          / {usage.limit === 9999 ? "∞" : usage.limit}
                        </span>
                      </p>
                      <p className="text-xs text-[#8d99c4]">
                        Conversions performed this month
                      </p>
                    </div>
                    <Button
                      asChild
                      variant="ghost"
                      className="text-[#2b72f5] hover:text-[#1a5ecc] hover:bg-[#2b72f5]/10"
                    >
                      <Link href="/billing" className="flex items-center gap-2">
                        Upgrade Plan <ArrowUpRight className="w-4 h-4" />
                      </Link>
                    </Button>
                  </div>
                  <Progress
                    value={usage.percentUsed}
                    className="h-2 bg-[#030720] [&>div]:bg-[#2b72f5]"
                  />
                </div>
              ) : (
                <p className="text-[#8d99c4]">No usage data available.</p>
              )}
            </CardContent>
          </Card>

          {/* Quick Action */}
          <Card className="bg-[#2b72f5] border-[#2b72f5]/30 shadow-[0_0_30px_rgba(43,114,245,0.25)]">
            <CardHeader>
              <CardTitle className="text-white">Ready to convert?</CardTitle>
              <CardDescription className="text-white/80">
                Transform your web app into a desktop installer in minutes.
              </CardDescription>
            </CardHeader>
            <CardContent>
              <Button
                asChild
                className="w-full bg-white text-[#2b72f5] hover:bg-[#dee3f7] shadow-lg font-bold py-6 rounded-xl"
              >
                <Link href="/jobs/new" className="flex items-center gap-2">
                  <Plus className="w-5 h-5" />
                  New Conversion
                </Link>
              </Button>
            </CardContent>
          </Card>
        </div>

        {/* Middle Section: Active Jobs & Quick Stats */}
        <div className="grid grid-cols-1 md:grid-cols-4 gap-6">
          {/* Active Jobs List */}
          <div className="md:col-span-3 space-y-4">
            <div className="flex items-center justify-between">
              <h3 className="text-sm font-bold uppercase tracking-widest text-[#8d99c4]">
                Active Jobs
              </h3>
              <Badge variant="secondary" className="bg-[#030720] text-[#dee3f7]/80 border border-[#8d99c4]/15">
                {activeJobs.length} Running
              </Badge>
            </div>

            {loading ? (
              [1, 2].map((i) => (
                <Skeleton
                  key={i}
                  className="h-24 w-full bg-[#030720]/45 border-[#8d99c4]/15 rounded-2xl"
                />
              ))
            ) : activeJobs.length > 0 ? (
              <div className="space-y-4">
                {activeJobs.map((job) => {
                  const jobProgress = job.progress ?? 0;
                  return (
                    <Link key={job.id} href={`/jobs/${job.id}`}>
                      <div className="group bg-[#030720]/50 border border-[#8d99c4]/15 p-5 rounded-2xl hover:border-[#2b72f5]/50 transition-all flex items-center justify-between">
                        <div className="flex items-center gap-4">
                          <div className="w-12 h-12 bg-[#020514] rounded-xl flex items-center justify-center relative">
                            <Clock className="w-6 h-6 text-[#2b72f5] animate-pulse" />
                          </div>
                          <div>
                            <h4 className="font-bold text-white group-hover:text-[#2b72f5] transition-colors">
                              {job.name}
                            </h4>
                            <p className="text-xs text-[#8d99c4] uppercase font-medium tracking-tighter">
                              Status: {job.status}
                            </p>
                          </div>
                        </div>
                        <div className="flex items-center gap-4">
                          <div className="flex items-center gap-2">
                            <div className="w-32 h-1.5 bg-[#020514] rounded-full overflow-hidden">
                              <div
                                className="h-full bg-[#2b72f5] animate-progress-flow transition-all duration-500"
                                style={{ width: `${jobProgress}%` }}
                              />
                            </div>
                            <span className="text-xs text-[#8d99c4] font-mono w-8 text-right">
                              {jobProgress}%
                            </span>
                          </div>
                          <ChevronRight className="w-4 h-4 text-[#8d99c4]/40" />
                        </div>
                      </div>
                    </Link>
                  );
                })}
              </div>
            ) : (
              <div className="p-12 border border-dashed border-[#8d99c4]/15 rounded-3xl text-center">
                <p className="text-[#8d99c4] text-sm">
                  No active conversions at the moment.
                </p>
              </div>
            )}
          </div>

          {/* Quick Stats Grid */}
          <div className="space-y-4">
            <h3 className="text-sm font-bold uppercase tracking-widest text-[#8d99c4]">
              History
            </h3>
            <div className="grid grid-cols-1 gap-4">
              <StatCard
                label="Completed"
                value={conversions.filter((c) => c.status === "done").length}
                icon={CheckCircle2}
                color="text-emerald-400"
                bg="bg-emerald-500/10 border border-emerald-500/20"
              />
              <StatCard
                label="Failed"
                value={conversions.filter((c) => c.status === "failed").length}
                icon={XCircle}
                color="text-rose-400"
                bg="bg-rose-500/10 border border-rose-500/20"
              />
            </div>
          </div>
        </div>

        {/* Recent Jobs Table/List */}
        <section className="space-y-4">
          <div className="flex items-center justify-between">
            <h3 className="text-sm font-bold uppercase tracking-widest text-[#8d99c4]">
              Recent Conversions
            </h3>
            <Button
              asChild
              variant="link"
              className="text-[#8d99c4] hover:text-white"
            >
              <Link href="/jobs">View all history</Link>
            </Button>
          </div>

          <div className="bg-[#030720]/30 border border-[#8d99c4]/15 rounded-3xl overflow-hidden backdrop-blur-sm">
            <div className="overflow-x-auto">
              <table className="w-full text-left">
                <thead>
                  <tr className="border-b border-[#8d99c4]/15">
                    <th className="px-6 py-4 text-xs font-bold text-[#8d99c4]/70 uppercase">
                      App Name
                    </th>
                    <th className="px-6 py-4 text-xs font-bold text-[#8d99c4]/70 uppercase">
                      Targets
                    </th>
                    <th className="px-6 py-4 text-xs font-bold text-[#8d99c4]/70 uppercase">
                      Status
                    </th>
                    <th className="px-6 py-4 text-xs font-bold text-[#8d99c4]/70 uppercase">
                      Date
                    </th>
                    <th className="px-6 py-4 text-xs font-bold text-[#8d99c4]/70 uppercase"></th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-[#8d99c4]/10">
                  {loading ? (
                    [1, 2, 3].map((i) => (
                      <tr key={i}>
                        <td className="px-6 py-4">
                          <Skeleton className="h-4 w-32 bg-[#020514]" />
                        </td>
                        <td className="px-6 py-4">
                          <Skeleton className="h-4 w-24 bg-[#020514]" />
                        </td>
                        <td className="px-6 py-4">
                          <Skeleton className="h-4 w-20 bg-[#020514]" />
                        </td>
                        <td className="px-6 py-4">
                          <Skeleton className="h-4 w-24 bg-[#020514]" />
                        </td>
                        <td className="px-6 py-4"></td>
                      </tr>
                    ))
                  ) : recentJobs.length > 0 ? (
                    recentJobs.map((job) => (
                      <tr
                        key={job.id}
                        className="hover:bg-[#030720]/50 transition-colors group"
                      >
                        <td className="px-6 py-4">
                          <div className="flex items-center gap-3">
                            <div className="w-8 h-8 bg-[#020514] rounded-lg flex items-center justify-center font-bold text-xs text-[#8d99c4] group-hover:bg-[#2b72f5]/15 group-hover:text-[#2b72f5] transition-colors">
                              {job?.name?.[0] || "?"}
                            </div>
                            <span className="text-sm font-medium text-white">
                              {job.name}
                            </span>
                          </div>
                        </td>
                        <td className="px-6 py-4">
                          <div className="flex gap-1">
                            {job.targets.map((t) => (
                              <Badge
                                key={t}
                                variant="outline"
                                className="text-[10px] py-0 border-[#8d99c4]/15 bg-[#030720]/50 text-[#8d99c4]"
                              >
                                {t}
                              </Badge>
                            ))}
                          </div>
                        </td>
                        <td className="px-6 py-4">
                          <StatusBadge status={job.status} />
                        </td>
                        <td className="px-6 py-4 text-sm text-[#8d99c4]/70">
                          {new Date(job.createdAt).toLocaleDateString()}
                        </td>
                        <td className="px-6 py-4 text-right">
                          <Button
                            asChild
                            variant="ghost"
                            size="sm"
                            className="opacity-0 group-hover:opacity-100 transition-opacity"
                          >
                            <Link href={`/jobs/${job.id}`}>Details</Link>
                          </Button>
                        </td>
                      </tr>
                    ))
                  ) : (
                    <tr>
                      <td
                        colSpan={5}
                        className="px-6 py-12 text-center text-[#8d99c4]/50 text-sm"
                      >
                        No conversion history found.
                      </td>
                    </tr>
                  )}
                </tbody>
              </table>
            </div>
          </div>
        </section>
      </div>
    </div>
  );
}

interface StatCardProps {
  label: string;
  value: number;
  icon: React.ElementType;
  color: string;
  bg: string;
}

function StatCard({ label, value, icon: Icon, color, bg }: StatCardProps) {
  return (
    <div className="bg-[#030720]/50 border border-[#8d99c4]/15 p-5 rounded-2xl flex items-center gap-4">
      <div
        className={cn(
          "w-10 h-10 rounded-xl flex items-center justify-center",
          bg,
        )}
      >
        <Icon className={cn("w-5 h-5", color)} />
      </div>
      <div>
        <p className="text-2xl font-bold text-white">{value}</p>
        <p className="text-[10px] font-bold text-[#8d99c4] uppercase tracking-widest">
          {label}
        </p>
      </div>
    </div>
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
      className={cn("px-2 py-0.5 text-[10px] font-bold uppercase", style)}
    >
      {STATUS_LABELS[status] ?? status}
    </Badge>
  );
}
