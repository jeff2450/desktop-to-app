"use client";

import { useEffect, useState } from "react";
import { TopBar } from "@/components/layout/TopBar";
import { billingApi } from "@/lib/api-client";
import type { UsageStats, BillingPlan, SubscriptionInfo, UsageChartData, Plan } from "@/types";
import { 
  Card, 
  CardContent, 
  CardHeader, 
  CardTitle, 
  CardDescription,
  CardFooter
} from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { 
  Check, 
  CreditCard, 
  Zap, 
  ShieldCheck, 
  Crown,
  ArrowRight,
  Loader2
} from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { cn } from "@/lib/utils";
import { 
  BarChart, 
  Bar, 
  XAxis, 
  YAxis, 
  CartesianGrid, 
  Tooltip, 
  ResponsiveContainer 
} from 'recharts';

export default function BillingPage() {
  const [usage, setUsage] = useState<UsageStats | null>(null);
  const [subscription, setSubscription] = useState<SubscriptionInfo | null>(null);
  const [usageChart, setUsageChart] = useState<UsageChartData[]>([]);
  const [plans, setPlans] = useState<BillingPlan[]>([]);
  const [loading, setLoading] = useState(true);
  const [actionLoading, setActionLoading] = useState<string | null>(null);

  useEffect(() => {
    async function fetchData() {
      try {
        const [u, s, uc, p] = await Promise.all([
          billingApi.usage(),
          billingApi.subscription(),
          billingApi.usageChart(),
          billingApi.plans()
        ]);
        if (u.data) setUsage(u.data);
        if (s.data) setSubscription(s.data);
        if (uc.data) setUsageChart(uc.data);
        if (p.data) setPlans(p.data);
      } catch (err) {
        console.error("Failed to fetch billing data:", err);
      } finally {
        setLoading(false);
      }
    }
    fetchData();
  }, []);

  const handleUpgrade = async (planId: string) => {
    setActionLoading(planId);
    try {
      const res = await billingApi.checkout(planId);
      if (res.error) {
        alert(res.error);
        return;
      }

      if (res.data?.url) {
        window.location.href = res.data.url;
      }
    } catch (err) {
      console.error("Checkout error:", err);
      alert("Failed to initiate checkout");
    } finally {
      setActionLoading(null);
    }
  };

  const handlePortal = async () => {
    setActionLoading('portal');
    try {
      const res = await billingApi.portal();
      if (res.data?.url) {
        window.location.href = res.data.url;
      }
    } catch (err) {
      console.error("Portal error:", err);
      alert("Failed to open billing portal");
    } finally {
      setActionLoading(null);
    }
  };

  if (loading) {
    return (
      <div className="min-h-screen bg-zinc-950">
        <TopBar title="Billing" />
        <div className="p-8 max-w-7xl mx-auto space-y-8">
          <div className="h-64 bg-zinc-900 animate-pulse rounded-3xl" />
          <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
            {[1, 2, 3].map(i => <div key={i} className="h-96 bg-zinc-900 animate-pulse rounded-3xl" />)}
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-zinc-950">
      <TopBar title="Plans & Billing" />
      
      <div className="p-8 space-y-12 max-w-7xl mx-auto">
        
        {/* Active Plan & Usage Header */}
        <div className="grid grid-cols-1 lg:grid-cols-3 gap-8 items-stretch">
          <Card className="lg:col-span-1 bg-zinc-900 border-zinc-800 relative overflow-hidden">
            <div className="absolute top-0 right-0 p-4 opacity-10">
              <CreditCard className="w-24 h-24" />
            </div>
            <CardHeader>
              <CardDescription className="text-zinc-500 uppercase font-bold tracking-widest text-[10px]">Your Current Plan</CardDescription>
              <CardTitle className="text-3xl font-black text-white flex items-center gap-2">
                {usage?.plan.toUpperCase()}
                {usage?.plan !== 'free' && <ShieldCheck className="w-6 h-6 text-indigo-400" />}
              </CardTitle>
            </CardHeader>
            <CardContent className="space-y-6">
              <div className="space-y-1">
                <p className="text-sm text-zinc-400">Monthly Usage</p>
                <p className="text-2xl font-bold text-white">
                  {subscription?.jobsUsedThisMonth ?? usage?.usage} <span className="text-zinc-600 font-normal text-base">/ {subscription?.jobsLimitThisMonth === null ? "∞" : subscription?.jobsLimitThisMonth ?? usage?.limit} conversions</span>
                </p>
              </div>
              
              {subscription?.renewsAt && (
                <div className="space-y-1">
                  <p className="text-sm text-zinc-400">Next Billing Date</p>
                  <p className="text-sm font-medium text-white">
                    {new Date(subscription.renewsAt).toLocaleDateString()}
                    {subscription.cancelAtPeriodEnd && (
                      <Badge variant="destructive" className="ml-2 text-xs">
                        Cancels at period end
                      </Badge>
                    )}
                  </p>
                </div>
              )}
              
              <Button 
                onClick={handlePortal} 
                disabled={actionLoading === 'portal' || usage?.plan === 'free'}
                className="w-full bg-zinc-800 hover:bg-zinc-700 text-white rounded-xl"
              >
                {actionLoading === 'portal' ? <Loader2 className="w-4 h-4 animate-spin mr-2" /> : <CreditCard className="w-4 h-4 mr-2" />}
                Manage Subscription
              </Button>
            </CardContent>
          </Card>

          <Card className="lg:col-span-2 bg-zinc-900 border-zinc-800">
            <CardHeader className="flex flex-row items-center justify-between">
              <div>
                <CardTitle className="text-lg font-bold">Usage Activity</CardTitle>
                <CardDescription>Daily conversion history for the current billing cycle</CardDescription>
              </div>
            </CardHeader>
            <CardContent className="h-[200px] w-full pt-4">
              <ResponsiveContainer width="100%" height="100%">
                <BarChart data={usageChart.length > 0 ? usageChart : FAKE_CHART_DATA}>
                  <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="#27272a" />
                  <XAxis dataKey={usageChart.length > 0 ? "date" : "name"} stroke="#52525b" fontSize={10} tickLine={false} axisLine={false} />
                  <YAxis stroke="#52525b" fontSize={10} tickLine={false} axisLine={false} />
                  <Tooltip 
                    contentStyle={{ backgroundColor: '#18181b', border: '1px solid #27272a', borderRadius: '8px' }}
                    itemStyle={{ color: '#818cf8', fontWeight: 'bold' }}
                  />
                  <Bar dataKey="jobs" fill="#6366f1" radius={[4, 4, 0, 0]} />
                </BarChart>
              </ResponsiveContainer>
            </CardContent>
          </Card>
        </div>

        {/* Pricing Grid */}
        <section className="space-y-8">
          <div className="text-center space-y-2">
            <h2 className="text-3xl font-black text-white tracking-tight">Scale your distribution</h2>
            <p className="text-zinc-500">Choose the plan that fits your build volume</p>
          </div>

          <div className="grid grid-cols-1 md:grid-cols-3 gap-8">
            {plans.map((plan) => (
              <PricingCard 
                key={plan.id}
                plan={plan}
                currentPlan={subscription?.plan ?? usage?.plan}
                onUpgrade={() => handleUpgrade(plan.id)}
                loading={actionLoading === plan.id}
              />
            ))}
          </div>
        </section>

      </div>
    </div>
  );
}

const FAKE_CHART_DATA: UsageChartData[] = [
  { date: '01 May', jobs: 2 },
  { date: '04 May', jobs: 5 },
  { date: '08 May', jobs: 3 },
  { date: '12 May', jobs: 8 },
  { date: '15 May', jobs: 4 },
  { date: '19 May', jobs: 1 },
  { date: '22 May', jobs: 6 },
];

function getPlanTier(plan: Plan): number {
  switch (plan) {
    case 'free': return 0;
    case 'pro': return 1;
    case 'team': return 2;
    case 'enterprise': return 3;
    default: return 0;
  }
}

function PricingCard({ plan, currentPlan, onUpgrade, loading }: { plan: BillingPlan, currentPlan?: Plan, onUpgrade: () => void, loading: boolean }) {
  const isCurrent = currentPlan === plan.id;
  const isPro = plan.id === 'pro';
  const isTeam = plan.id === 'team';
  const isFree = plan.id === 'free';
  const isEnterprise = plan.id === 'enterprise';
  const isHigherTier = currentPlan && getPlanTier(plan.id) > getPlanTier(currentPlan);
  const isLowerTier = currentPlan && getPlanTier(plan.id) < getPlanTier(currentPlan);

  return (
    <Card className={cn(
      "relative bg-zinc-900 border-zinc-800 transition-all duration-300",
      isPro && "border-indigo-500/50 shadow-[0_0_40px_rgba(99,102,241,0.1)] scale-105 z-10",
      isTeam && "border-cyan-500/30"
    )}>
      {isPro && (
        <div className="absolute top-0 left-1/2 -translate-x-1/2 -translate-y-1/2 px-4 py-1 bg-indigo-500 text-white text-[10px] font-black uppercase tracking-widest rounded-full">
          Recommended
        </div>
      )}
      
      <CardHeader className="text-center pb-8">
        <div className="flex justify-center mb-4">
          <div className={cn(
            "w-14 h-14 rounded-2xl flex items-center justify-center",
            isPro ? "bg-indigo-500/20 text-indigo-400" : 
            isTeam ? "bg-cyan-500/20 text-cyan-400" : 
            isEnterprise ? "bg-emerald-500/20 text-emerald-400" : "bg-zinc-800 text-zinc-500"
          )}>
            {isPro ? <Zap className="w-8 h-8" /> : isTeam ? <Crown className="w-8 h-8" /> : isEnterprise ? <ShieldCheck className="w-8 h-8" /> : <Check className="w-8 h-8" />}
          </div>
        </div>
        <CardTitle className="text-2xl font-black">{plan.name}</CardTitle>
        <div className="mt-4 flex flex-col items-center">
          <div className="flex items-baseline gap-1">
            <span className="text-4xl font-black text-white">${plan.price ?? '?'}</span>
            <span className="text-zinc-500 text-sm">/mo</span>
          </div>
          <p className="text-zinc-600 text-xs mt-1">
            {plan.conversionsPerMonth === 9999 ? "Unlimited" : plan.conversionsPerMonth} conversions / mo
          </p>
        </div>
      </CardHeader>

      <CardContent className="space-y-4 pb-8">
        {plan.features.map((feature, i) => (
          <div key={i} className="flex items-start gap-3">
            <div className="w-5 h-5 rounded-full bg-zinc-800 flex items-center justify-center flex-shrink-0 mt-0.5">
              <Check className="w-3 h-3 text-indigo-400" />
            </div>
            <span className="text-sm text-zinc-400">{feature}</span>
          </div>
        ))}
      </CardContent>

      <CardFooter>
        <Button 
          onClick={onUpgrade}
          disabled={isCurrent || loading || isEnterprise || isFree}
          className={cn(
            "w-full rounded-xl py-6 font-bold transition-all",
            isCurrent ? "bg-emerald-500/10 text-emerald-500 border border-emerald-500/20 cursor-default" :
            isHigherTier ? "bg-indigo-600 hover:bg-indigo-500 text-white shadow-lg" : 
            isLowerTier ? "bg-zinc-700 hover:bg-zinc-600 text-white" :
            "bg-zinc-800 hover:bg-zinc-700 text-white"
          )}
        >
          {loading ? <Loader2 className="w-4 h-4 animate-spin" /> : 
           isCurrent ? "Current Plan" : 
           isFree ? "Included" :
           isEnterprise ? "Contact Sales" : 
           isHigherTier ? `Upgrade to ${plan.name}` :
           isLowerTier ? `Downgrade to ${plan.name}` :
           `Switch to ${plan.name}`}
        </Button>
      </CardFooter>
    </Card>
  );
}
