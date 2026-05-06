"use client";

import { useEffect, useState } from "react";
import { conversionsApi } from "../../../lib/api-client";
import type { Conversion } from "../../../types";
import { Sidebar } from "../../../components/layout/Sidebar";
import { TopBar } from "../../../components/layout/TopBar";
import { JobStatusCard } from "../../../components/conversion/JobStatusCard";

export default function ConversionsPage() {
  const [conversions, setConversions] = useState<Conversion[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    conversionsApi.list().then((r) => {
      if (r.data) setConversions(r.data);
      setLoading(false);
    });
  }, []);

  return (
    <div className="flex h-full">
      <Sidebar />
      <div className="flex-1 ml-60 min-h-screen">
        <TopBar title="Conversions" action={{ label: "+ New", href: "/dashboard/conversions/new" }} />
        <div className="p-6 max-w-3xl">
          {loading ? (
            <p className="text-gray-600 text-sm">Loading…</p>
          ) : conversions.length === 0 ? (
            <div className="bg-gray-900 border border-gray-800 rounded-xl p-10 text-center">
              <p className="text-gray-500 mb-3">No conversions yet</p>
              <a href="/dashboard/conversions/new" className="text-indigo-400 hover:text-indigo-300 text-sm">
                Start your first conversion →
              </a>
            </div>
          ) : (
            <div className="space-y-3">
              {conversions.map((c) => <JobStatusCard key={c.id} conversion={c} />)}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
