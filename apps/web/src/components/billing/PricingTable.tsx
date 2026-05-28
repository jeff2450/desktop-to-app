"use client";

import { useState } from "react";
import { billingApi } from "../../lib/api-client";
import type { BillingPlan, Plan } from "../../types";

interface Props {
  plans: BillingPlan[];
  currentPlan: Plan;
}

export function PricingTable({ plans, currentPlan }: Props) {
  const [loading, setLoading] = useState<string | null>(null);

  async function handleUpgrade(planId: Plan) {
    if (planId === "free" || planId === currentPlan) return;
    setLoading(planId);

    const result = await billingApi.checkout(planId);
    setLoading(null);
    if (result.data?.url) window.location.href = result.data.url;

  }

  return (
    <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
      {plans.map((plan) => {
        const isCurrent = plan.id === currentPlan;
        const isPaid = plan.id !== "free";


        return (
          <div
            key={plan.id}
            className={`bg-gray-900 rounded-xl border p-5 flex flex-col ${
              isCurrent ? "border-indigo-500" : "border-gray-800"
            }`}
          >
            {isCurrent && (
              <span className="text-xs font-medium text-indigo-400 mb-2">Current plan</span>
            )}
            <h3 className="font-semibold text-white text-base">{plan.name}</h3>
            <div className="mt-2 mb-4">
              {plan.price === null ? (
                <span className="text-2xl font-bold text-white">Custom</span>
              ) : plan.price === 0 ? (
                <span className="text-2xl font-bold text-white">Free</span>
              ) : (
                <div>
                  <span className="text-2xl font-bold text-white">${plan.price}</span>
                  <span className="text-gray-500 text-sm">/mo</span>
                </div>
              )}
            </div>

            <ul className="space-y-2 flex-1 mb-5">
              {plan.features.map((f) => (
                <li key={f} className="flex items-start gap-2 text-sm text-gray-400">
                  <span className="text-green-500 mt-0.5 flex-shrink-0">✓</span>
                  {f}
                </li>
              ))}
            </ul>

            <button
              onClick={() => handleUpgrade(plan.id)}
              disabled={isCurrent || loading === plan.id}
              className={`w-full py-2 rounded-lg text-sm font-medium transition-colors ${
                isCurrent
                  ? "bg-gray-800 text-gray-500 cursor-default"
                  : "bg-indigo-600 hover:bg-indigo-500 text-white disabled:opacity-50"
              }`}
            >
              {loading === plan.id
                ? "Redirecting…"
                : isCurrent
                ? "Current"
                : `Upgrade to ${plan.name}`}

            </button>
          </div>
        );
      })}
    </div>
  );
}
