"use client";

import { useEffect, useState } from "react";
import { billingApi } from "../../../lib/api-client";
import type { UsageStats, BillingPlan, Plan } from "../../../types";
import { Sidebar } from "../../../components/layout/Sidebar";
import { TopBar } from "../../../components/layout/TopBar";
import { PricingTable } from "../../../components/billing/PricingTable";

export default function BillingPage() {
  const [usage, setUsage]   = useState<UsageStats | null>(null);
  const [plans, setPlans]   = useState<BillingPlan[]>([]);
  const [loading, setLoading] = useState(true);
  const [portalLoading, setPortalLoading] = useState(false);

  useEffect(() => {
    Promise.all([billingApi.usage(), billingApi.plans()]).then(([u, p]) => {
      if (u.data) setUsage(u.data);
      if (p.data) setPlans(p.data);
      setLoading(false);
    });
  }, []);

  async function openPortal() {
    setPortalLoading(true);
    const result = await billingApi.portal();
    setPortalLoading(false);
    if (result.data?.url) window.location.href = result.data.url;
  }

  return (
    <div className="flex h-full">
      <Sidebar />
      <div className="flex-1 ml-60 min-h-screen">
        <TopBar title="Billing" />
        <div className="p-6 max-w-5xl space-y-8">

          {/* Usage */}
          {usage && (
            <div className="bg-gray-900 border border-gray-800 rounded-xl p-5">
              <div className="flex items-center justify-between mb-4">
                <div>
                  <h2 className="font-semibold text-white">Usage this month</h2>
                  <p className="text-sm text-gray-500 mt-0.5 capitalize">{usage.plan} plan</p>
                </div>
                {usage.plan !== "free" && (
                  <button
                    onClick={openPortal}
                    disabled={portalLoading}
                    className="text-sm text-indigo-400 hover:text-indigo-300 disabled:opacity-50"
                  >
                    {portalLoading ? "Opening…" : "Manage subscription →"}
                  </button>
                )}
              </div>
              <div className="flex items-end gap-3 mb-2">
                <span className="text-3xl font-bold text-white">{usage.usage}</span>
                <span className="text-gray-500 mb-1">/ {usage.limit} conversions</span>
              </div>
              <div className="h-2 bg-gray-800 rounded-full overflow-hidden mb-2">
                <div
                  className={`h-full rounded-full transition-all ${usage.percentUsed > 80 ? "bg-red-500" : "bg-indigo-500"}`}
                  style={{ width: `${usage.percentUsed}%` }}
                />
              </div>
              <p className="text-xs text-gray-600">
                Resets {new Date(usage.resetsAt).toLocaleDateString("en-US", { month: "long", day: "numeric" })}
              </p>
            </div>
          )}

          {/* Plans */}
          <div>
            <h2 className="font-semibold text-white mb-4">Plans</h2>
            {loading ? (
              <p className="text-gray-600 text-sm">Loading…</p>
            ) : (
              <PricingTable plans={plans} currentPlan={(usage?.plan ?? "free") as Plan} />
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
