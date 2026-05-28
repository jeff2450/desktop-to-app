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
    <div className="min-h-screen bg-zinc-950">
      <TopBar title="Overview" />

      <div className="p-8 space-y-8 max-w-7xl mx-auto">
        {/* Welcome & Stats Row */}
        <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
          {/* Usage Meter */}
          <Card className="lg:col-span-2 bg-zinc-900/50 border-zinc-800 backdrop-blur-sm overflow-hidden relative">
            <div className="absolute top-0 right-0 p-8 opacity-5">
              <History className="w-32 h-32" />
            </div>
            <CardHeader>
              <div className="flex justify-between items-start">
                <div>
                  <CardTitle className="text-xl font-bold">
                    Monthly Usage
                  </CardTitle>
                  <CardDescription className="text-zinc-500">
                    Track your conversion limits for this month
                  </CardDescription>
                </div>
                {usage && (
                  <Badge
                    variant="outline"
                    className="bg-indigo-500/10 text-indigo-400 border-indigo-500/20 px-3 py-1"
                  >
                    {usage.plan.toUpperCase()} PLAN
                  </Badge>
                )}
              </div>
            </CardHeader>
            <CardContent>
              {loading ? (
                <div className="space-y-4">
                  <Skeleton className="h-4 w-full bg-zinc-800" />
                  <Skeleton className="h-2 w-full bg-zinc-800" />
                </div>
              ) : usage ? (
                <div className="space-y-6">
                  <div className="flex justify-between items-end">
                    <div className="space-y-1">
                      <p className="text-3xl font-bold text-white">
                        {usage.usage}{" "}
                        <span className="text-zinc-500 text-lg font-normal">
                          / {usage.limit === 9999 ? "∞" : usage.limit}
                        </span>
                      </p>
                      <p className="text-xs text-zinc-500">
                        Conversions performed this month
                      </p>
                    </div>
                    <Button
                      asChild
                      variant="ghost"
                      className="text-indigo-400 hover:text-indigo-300 hover:bg-indigo-500/10"
                    >
                      <Link href="/billing" className="flex items-center gap-2">
                        Upgrade Plan <ArrowUpRight className="w-4 h-4" />
                      </Link>
                    </Button>
                  </div>
                  <Progress
                    value={usage.percentUsed}
                    className="h-2 bg-zinc-800 [&>div]:bg-indigo-500"
                  />
                </div>
              ) : (
                <p className="text-zinc-500">No usage data available.</p>
              )}
            </CardContent>
          </Card>

          {/* Quick Action */}
          <Card className="bg-indigo-600 border-indigo-500 shadow-[0_0_30px_rgba(99,102,241,0.2)]">
            <CardHeader>
              <CardTitle className="text-white">Ready to convert?</CardTitle>
              <CardDescription className="text-indigo-100">
                Transform your web app into a desktop installer in minutes.
              </CardDescription>
            </CardHeader>
            <CardContent>
              <Button
                asChild
                className="w-full bg-white text-indigo-600 hover:bg-indigo-50 shadow-lg font-bold py-6 rounded-xl"
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
              <h3 className="text-sm font-bold uppercase tracking-widest text-zinc-500">
                Active Jobs
              </h3>
              <Badge variant="secondary" className="bg-zinc-800 text-zinc-400">
                {activeJobs.length} Running
              </Badge>
            </div>

            {loading ? (
              [1, 2].map((i) => (
                <Skeleton
                  key={i}
                  className="h-24 w-full bg-zinc-900 border-zinc-800 rounded-2xl"
                />
              ))
            ) : activeJobs.length > 0 ? (
              <div className="space-y-4">
                {activeJobs.map((job) => (
                  <Link key={job.id} href={`/jobs/${job.id}`}>
                    <div className="group bg-zinc-900/50 border border-zinc-800 p-5 rounded-2xl hover:border-indigo-500/50 transition-all flex items-center justify-between">
                      <div className="flex items-center gap-4">
                        <div className="w-12 h-12 bg-zinc-800 rounded-xl flex items-center justify-center relative">
                          <Clock className="w-6 h-6 text-indigo-400 animate-pulse" />
                        </div>
                        <div>
                          <h4 className="font-bold text-white group-hover:text-indigo-400 transition-colors">
                            {job.name}
                          </h4>
                          <p className="text-xs text-zinc-500 uppercase font-medium tracking-tighter">
                            Status: {job.status}
                          </p>
                        </div>
                      </div>
                      <div className="flex items-center gap-4">
                        <div className="w-32 h-1.5 bg-zinc-800 rounded-full overflow-hidden">
                          <div
                            className="h-full bg-indigo-500 animate-progress-flow"
                            style={{ width: "40%" }}
                          />
                        </div>
                        <ChevronRight className="w-4 h-4 text-zinc-600" />
                      </div>
                    </div>
                  </Link>
                ))}
              </div>
            ) : (
              <div className="p-12 border border-dashed border-zinc-800 rounded-3xl text-center">
                <p className="text-zinc-500 text-sm">
                  No active conversions at the moment.
                </p>
              </div>
            )}
          </div>

          {/* Quick Stats Grid */}
          <div className="space-y-4">
            <h3 className="text-sm font-bold uppercase tracking-widest text-zinc-500">
              History
            </h3>
            <div className="grid grid-cols-1 gap-4">
              <StatCard
                label="Completed"
                value={conversions.filter((c) => c.status === "done").length}
                icon={CheckCircle2}
                color="text-emerald-500"
                bg="bg-emerald-500/10"
              />
              <StatCard
                label="Failed"
                value={conversions.filter((c) => c.status === "failed").length}
                icon={XCircle}
                color="text-rose-500"
                bg="bg-rose-500/10"
              />
            </div>
          </div>
        </div>

        {/* Recent Jobs Table/List */}
        <section className="space-y-4">
          <div className="flex items-center justify-between">
            <h3 className="text-sm font-bold uppercase tracking-widest text-zinc-500">
              Recent Conversions
            </h3>
            <Button
              asChild
              variant="link"
              className="text-zinc-500 hover:text-white"
            >
              <Link href="/jobs">View all history</Link>
            </Button>
          </div>

          <div className="bg-zinc-900/30 border border-zinc-800 rounded-3xl overflow-hidden backdrop-blur-sm">
            <div className="overflow-x-auto">
              <table className="w-full text-left">
                <thead>
                  <tr className="border-b border-zinc-800/50">
                    <th className="px-6 py-4 text-xs font-bold text-zinc-500 uppercase">
                      App Name
                    </th>
                    <th className="px-6 py-4 text-xs font-bold text-zinc-500 uppercase">
                      Targets
                    </th>
                    <th className="px-6 py-4 text-xs font-bold text-zinc-500 uppercase">
                      Status
                    </th>
                    <th className="px-6 py-4 text-xs font-bold text-zinc-500 uppercase">
                      Date
                    </th>
                    <th className="px-6 py-4 text-xs font-bold text-zinc-500 uppercase"></th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-zinc-800/30">
                  {loading ? (
                    [1, 2, 3].map((i) => (
                      <tr key={i}>
                        <td className="px-6 py-4">
                          <Skeleton className="h-4 w-32 bg-zinc-800" />
                        </td>
                        <td className="px-6 py-4">
                          <Skeleton className="h-4 w-24 bg-zinc-800" />
                        </td>
                        <td className="px-6 py-4">
                          <Skeleton className="h-4 w-20 bg-zinc-800" />
                        </td>
                        <td className="px-6 py-4">
                          <Skeleton className="h-4 w-24 bg-zinc-800" />
                        </td>
                        <td className="px-6 py-4"></td>
                      </tr>
                    ))
                  ) : recentJobs.length > 0 ? (
                    recentJobs.map((job) => (
                      <tr
                        key={job.id}
                        className="hover:bg-zinc-800/20 transition-colors group"
                      >
                        <td className="px-6 py-4">
                          <div className="flex items-center gap-3">
                            <div className="w-8 h-8 bg-zinc-800 rounded-lg flex items-center justify-center font-bold text-xs text-zinc-400 group-hover:bg-indigo-500/20 group-hover:text-indigo-400 transition-colors">
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
                                className="text-[10px] py-0 border-zinc-700 bg-zinc-800/50 text-zinc-400"
                              >
                                {t}
                              </Badge>
                            ))}
                          </div>
                        </td>
                        <td className="px-6 py-4">
                          <StatusBadge status={job.status} />
                        </td>
                        <td className="px-6 py-4 text-sm text-zinc-500">
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
                        className="px-6 py-12 text-center text-zinc-600 text-sm"
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
    <div className="bg-zinc-900/50 border border-zinc-800 p-5 rounded-2xl flex items-center gap-4">
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
        <p className="text-[10px] font-bold text-zinc-500 uppercase tracking-widest">
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
    cancelled: "bg-zinc-800 text-zinc-500 border-zinc-700",
    default:
      "bg-indigo-500/10 text-indigo-400 border-indigo-500/20 animate-pulse",
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
