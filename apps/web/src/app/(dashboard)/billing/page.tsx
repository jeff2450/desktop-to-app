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
  Loader2,
  X,
  Wallet,
  Smartphone
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
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
} from "@/components/ui/dialog";

export default function BillingPage() {
  const [usage, setUsage] = useState<UsageStats | null>(null);
  const [subscription, setSubscription] = useState<SubscriptionInfo | null>(null);
  const [usageChart, setUsageChart] = useState<UsageChartData[]>([]);
  const [plans, setPlans] = useState<BillingPlan[]>([]);
  const [loading, setLoading] = useState(true);
  const [actionLoading, setActionLoading] = useState<string | null>(null);

  // States for embedded checkout
  const [activeCheckoutUrl, setActiveCheckoutUrl] = useState<string | null>(null);
  const [iframeLoading, setIframeLoading] = useState(true);

  // Gateway availability configurations
  const [gateways, setGateways] = useState<{ stripe: boolean; paypal: boolean; clickpesa: boolean }>({
    stripe: false,
    paypal: false,
    clickpesa: false
  });
  const [selectedUpgradePlan, setSelectedUpgradePlan] = useState<Plan | null>(null);
  const [showPaymentSelector, setShowPaymentSelector] = useState(false);

  // Frame detection: redirect parent if loaded inside an iframe (e.g. cancellation)
  useEffect(() => {
    if (typeof window !== "undefined" && window.top && window.top !== window.self) {
      try {
        window.top.location.href = window.location.href;
      } catch (e) {
        console.error("Failed to redirect parent window on iframe cancel:", e);
      }
    }
  }, []);

  useEffect(() => {
    async function fetchData() {
      try {
        const [u, s, uc, p, gConfig] = await Promise.all([
          billingApi.usage(),
          billingApi.subscription(),
          billingApi.usageChart(),
          billingApi.plans(),
          billingApi.config()
        ]);
        if (u.data) setUsage(u.data);
        if (s.data) setSubscription(s.data);
        if (uc.data) setUsageChart(uc.data);
        if (p.data) setPlans(p.data);
        if (gConfig.data) setGateways(gConfig.data);
      } catch (err) {
        console.error("Failed to fetch billing data:", err);
      } finally {
        setLoading(false);
      }
    }
    fetchData();
  }, []);

  const handleUpgradeClick = (planId: Plan) => {
    const active = Object.entries(gateways)
      .filter(([_, enabled]) => enabled)
      .map(([name]) => name);

    if (active.length <= 1) {
      handleUpgrade(planId, active[0]);
    } else {
      setSelectedUpgradePlan(planId);
      setShowPaymentSelector(true);
    }
  };

  const handleUpgrade = async (planId: Plan, gateway?: string) => {
    setActionLoading(planId);
    setShowPaymentSelector(false);
    try {
      const result = await billingApi.checkout(planId, gateway);
      if (result.data?.url) {
        const url = result.data.url;
        const isClickPesa = url.includes("clickpesa") || gateway === "clickpesa";
        if (isClickPesa) {
          setIframeLoading(true);
          setActiveCheckoutUrl(url);
        } else {
          window.location.href = url;
        }
        return;
      }
      alert(result.error || "Failed to start checkout");
    } catch (err) {
      console.error("Checkout error:", err);
      alert("Failed to start checkout");
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
                onUpgrade={() => handleUpgradeClick(plan.id)}
                loading={actionLoading === plan.id}
              />
            ))}
          </div>
        </section>

        {/* Payment Method Selector Dialog */}
        <Dialog open={showPaymentSelector} onOpenChange={setShowPaymentSelector}>
          <DialogContent className="bg-zinc-900 border-zinc-800 text-white rounded-3xl max-w-md p-6 shadow-[0_0_50px_rgba(99,102,241,0.15)]">
            <DialogHeader className="space-y-3">
              <DialogTitle className="text-2xl font-black tracking-tight text-white flex items-center gap-2">
                <Zap className="w-6 h-6 text-indigo-400" />
                Select Payment Method
              </DialogTitle>
              <DialogDescription className="text-zinc-400 text-sm">
                Choose your preferred payment method to upgrade to the{" "}
                <span className="text-indigo-400 font-bold uppercase">
                  {selectedUpgradePlan}
                </span>{" "}
                plan.
              </DialogDescription>
            </DialogHeader>

            <div className="mt-6 space-y-4">
              {gateways.stripe && (
                <button
                  onClick={() => selectedUpgradePlan && handleUpgrade(selectedUpgradePlan, "stripe")}
                  className="w-full flex items-center justify-between p-4 rounded-2xl bg-zinc-950/50 border border-zinc-800 hover:border-indigo-500/50 hover:bg-zinc-800/30 transition-all duration-300 group"
                >
                  <div className="flex items-center gap-4">
                    <div className="w-12 h-12 rounded-xl bg-indigo-500/10 text-indigo-400 flex items-center justify-center group-hover:bg-indigo-500 group-hover:text-white transition-all duration-300">
                      <CreditCard className="w-6 h-6" />
                    </div>
                    <div className="text-left">
                      <p className="font-bold text-white text-sm">Card / Google Pay</p>
                      <p className="text-zinc-500 text-xs">Pay securely via Stripe (Supports Google Pay & Apple Pay)</p>
                    </div>
                  </div>
                  <Check className="w-5 h-5 text-indigo-500 opacity-0 group-hover:opacity-100 transition-opacity duration-300" />
                </button>
              )}

              {gateways.paypal && (
                <button
                  onClick={() => selectedUpgradePlan && handleUpgrade(selectedUpgradePlan, "paypal")}
                  className="w-full flex items-center justify-between p-4 rounded-2xl bg-zinc-950/50 border border-zinc-800 hover:border-amber-500/50 hover:bg-zinc-800/30 transition-all duration-300 group"
                >
                  <div className="flex items-center gap-4">
                    <div className="w-12 h-12 rounded-xl bg-amber-500/10 text-amber-400 flex items-center justify-center group-hover:bg-amber-500 group-hover:text-white transition-all duration-300">
                      <Wallet className="w-6 h-6" />
                    </div>
                    <div className="text-left">
                      <p className="font-bold text-white text-sm">PayPal</p>
                      <p className="text-zinc-500 text-xs">Pay with your PayPal account or card</p>
                    </div>
                  </div>
                  <Check className="w-5 h-5 text-amber-500 opacity-0 group-hover:opacity-100 transition-opacity duration-300" />
                </button>
              )}

              {gateways.clickpesa && (
                <button
                  onClick={() => selectedUpgradePlan && handleUpgrade(selectedUpgradePlan, "clickpesa")}
                  className="w-full flex items-center justify-between p-4 rounded-2xl bg-zinc-950/50 border border-zinc-800 hover:border-emerald-500/50 hover:bg-zinc-800/30 transition-all duration-300 group"
                >
                  <div className="flex items-center gap-4">
                    <div className="w-12 h-12 rounded-xl bg-emerald-500/10 text-emerald-400 flex items-center justify-center group-hover:bg-emerald-500 group-hover:text-white transition-all duration-300">
                      <Smartphone className="w-6 h-6" />
                    </div>
                    <div className="text-left">
                      <p className="font-bold text-white text-sm">Mobile Money</p>
                      <p className="text-zinc-500 text-xs">Pay via ClickPesa Mobile Checkout</p>
                    </div>
                  </div>
                  <Check className="w-5 h-5 text-emerald-500 opacity-0 group-hover:opacity-100 transition-opacity duration-300" />
                </button>
              )}
            </div>
          </DialogContent>
        </Dialog>

        {/* ClickPesa Embedded Payment Modal */}
        {activeCheckoutUrl && (
          <div className="fixed inset-0 z-50 flex items-center justify-center bg-zinc-950/80 backdrop-blur-sm p-4 animate-in fade-in duration-200">
            <div className="bg-zinc-900 border border-zinc-800 rounded-3xl w-full max-w-2xl overflow-hidden relative shadow-[0_0_50px_rgba(99,102,241,0.15)] flex flex-col h-[80vh] sm:h-[650px] animate-in zoom-in-95 slide-in-from-bottom-4 duration-300">
              
              {/* Modal Header */}
              <div className="flex items-center justify-between px-6 py-4 border-b border-zinc-800 bg-zinc-900/50 backdrop-blur-md sticky top-0 z-10">
                <div>
                  <h3 className="text-lg font-bold text-white flex items-center gap-2">
                    <Zap className="w-5 h-5 text-indigo-400" />
                    Complete Secure Payment
                  </h3>
                  <p className="text-zinc-500 text-xs">ClickPesa Embedded Checkout</p>
                </div>
                <button 
                  onClick={() => setActiveCheckoutUrl(null)}
                  className="w-8 h-8 rounded-full bg-zinc-800 hover:bg-zinc-700 text-zinc-400 hover:text-white flex items-center justify-center transition-colors"
                >
                  <X className="w-4 h-4" />
                </button>
              </div>

              {/* Modal Content - Iframe */}
              <div className="flex-1 relative bg-zinc-950">
                {iframeLoading && (
                  <div className="absolute inset-0 flex flex-col items-center justify-center bg-zinc-950 gap-4">
                    <Loader2 className="w-8 h-8 text-indigo-500 animate-spin" />
                    <p className="text-zinc-500 text-sm animate-pulse">Loading secure payment widget...</p>
                  </div>
                )}
                <iframe
                  src={activeCheckoutUrl}
                  onLoad={() => setIframeLoading(false)}
                  className="w-full h-full border-0"
                  allow="payment"
                />
              </div>

              {/* Modal Footer / Security Info */}
              <div className="bg-zinc-900/50 border-t border-zinc-800 px-6 py-3 flex items-center justify-between text-[10px] text-zinc-500">
                <span className="flex items-center gap-1.5">
                  <ShieldCheck className="w-3.5 h-3.5 text-emerald-500" />
                  PCI-DSS Compliant & SSL Encrypted
                </span>
                <span>Powered by ClickPesa</span>
              </div>
            </div>
          </div>
        )}

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
    case 'ultra': return 3;

    default: return 0;
  }
}

function PricingCard({ plan, currentPlan, onUpgrade, loading }: { plan: BillingPlan, currentPlan?: Plan, onUpgrade: () => void, loading: boolean }) {
  const isCurrent = currentPlan === plan.id;
  const isPro = plan.id === 'pro';
  const isTeam = plan.id === 'team';
  const isFree = plan.id === 'free';
  const isUltra = plan.id === 'ultra';

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
            isUltra ? "bg-purple-500/20 text-purple-400" : "bg-zinc-800 text-zinc-500"

          )}>
            {isPro ? <Zap className="w-8 h-8" /> : isTeam ? <Crown className="w-8 h-8" /> : isUltra ? <ShieldCheck className="w-8 h-8" /> : <Check className="w-8 h-8" />}

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
          disabled={isCurrent || loading || isFree}

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
           isHigherTier ? `Upgrade to ${plan.name}` :

           isLowerTier ? `Downgrade to ${plan.name}` :
           `Switch to ${plan.name}`}
        </Button>
      </CardFooter>
    </Card>
  );
}
