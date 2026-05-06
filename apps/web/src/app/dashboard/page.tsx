"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { conversionsApi, billingApi } from "../../lib/api-client";
import type { Conversion, UsageStats } from "../../types";
import { Sidebar } from "../../components/layout/Sidebar";
import { TopBar } from "../../components/layout/TopBar";
import { JobStatusCard } from "../../components/conversion/JobStatusCard";

export default function DashboardPage() {
  const [conversions, setConversions] = useState<Conversion[]>([]);
  const [usage, setUsage] = useState<UsageStats | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    Promise.all([conversionsApi.list(), billingApi.usage()]).then(([c, u]) => {
      if (c.data) setConversions(c.data.slice(0, 5));
      if (u.data) setUsage(u.data);
      setLoading(false);
    });
  }, []);

  const recent = conversions.slice(0, 5);
  const active = conversions.filter((c) =>
    ["queued","detecting","planning","transforming","scaffolding","installing","building","packaging"].includes(c.status)
  );

  return (
    <div className="flex h-full">
      <Sidebar />
      <div className="flex-1 ml-60 min-h-screen">
        <TopBar title="Dashboard" action={{ label: "+ New Conversion", href: "/dashboard/conversions/new" }} />
        <div className="p-6 space-y-6 max-w-4xl">

          {/* Usage bar */}
          {usage && (
            <div className="bg-gray-900 border border-gray-800 rounded-xl p-4">
              <div className="flex justify-between items-center mb-2">
                <span className="text-sm text-gray-400">Monthly conversions</span>
                <span className="text-sm text-white font-medium">{usage.usage} / {usage.limit}</span>
              </div>
              <div className="h-2 bg-gray-800 rounded-full overflow-hidden">
                <div
                  className={`h-full rounded-full transition-all ${usage.percentUsed > 80 ? "bg-red-500" : "bg-indigo-500"}`}
                  style={{ width: `${usage.percentUsed}%` }}
                />
              </div>
              <div className="flex justify-between mt-2">
                <span className="text-xs text-gray-500 capitalize">{usage.plan} plan</span>
                {usage.plan === "free" && (
                  <Link href="/dashboard/billing" className="text-xs text-indigo-400 hover:text-indigo-300">Upgrade →</Link>
                )}
              </div>
            </div>
          )}

          {/* Active jobs */}
          {active.length > 0 && (
            <section>
              <h2 className="text-xs font-medium text-gray-500 uppercase tracking-wider mb-3">Active</h2>
              <div className="space-y-3">
                {active.map((c) => <JobStatusCard key={c.id} conversion={c} />)}
              </div>
            </section>
          )}

          {/* Quick stats */}
          <div className="grid grid-cols-3 gap-4">
            {[
              { label: "Total conversions", value: conversions.length },
              { label: "Completed", value: conversions.filter((c) => c.status === "done").length },
              { label: "Failed", value: conversions.filter((c) => c.status === "failed").length },
            ].map(({ label, value }) => (
              <div key={label} className="bg-gray-900 border border-gray-800 rounded-xl p-4">
                <p className="text-2xl font-bold text-white">{value}</p>
                <p className="text-xs text-gray-500 mt-1">{label}</p>
              </div>
            ))}
          </div>

          {/* Recent conversions */}
          <section>
            <div className="flex items-center justify-between mb-3">
              <h2 className="text-xs font-medium text-gray-500 uppercase tracking-wider">Recent</h2>
              <Link href="/dashboard/conversions" className="text-xs text-indigo-400 hover:text-indigo-300">View all →</Link>
            </div>
            {loading ? (
              <div className="text-gray-600 text-sm">Loading…</div>
            ) : recent.length === 0 ? (
              <div className="bg-gray-900 border border-gray-800 rounded-xl p-8 text-center">
                <p className="text-gray-500 text-sm mb-3">No conversions yet</p>
                <Link href="/dashboard/conversions/new" className="text-indigo-400 hover:text-indigo-300 text-sm">
                  Convert your first app →
                </Link>
              </div>
            ) : (
              <div className="space-y-2">
                {recent.map((c) => <JobStatusCard key={c.id} conversion={c} compact />)}
              </div>
            )}
          </section>
        </div>
      </div>
    </div>
  );
}
