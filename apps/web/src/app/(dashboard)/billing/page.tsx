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
  Zap, 
  ShieldCheck, 
  Crown,
  Loader2,
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
  DialogFooter,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";

export default function BillingPage() {
  const [usage, setUsage] = useState<UsageStats | null>(null);
  const [subscription, setSubscription] = useState<SubscriptionInfo | null>(null);
  const [usageChart, setUsageChart] = useState<UsageChartData[]>([]);
  const [plans, setPlans] = useState<BillingPlan[]>([]);
  const [loading, setLoading] = useState(true);
  const [actionLoading, setActionLoading] = useState<string | null>(null);
  
  const [config, setConfig] = useState<{ credit: boolean; stripe: boolean; paypal: boolean; clickpesa: boolean; mpesa: boolean; mongike: boolean; mock: boolean } | null>(null);
  const [modalOpen, setModalOpen] = useState(false);
  const [selectedPlan, setSelectedPlan] = useState<Plan | null>(null);
  const [phone, setPhone] = useState("");
  const [phoneError, setPhoneError] = useState<string | null>(null);
  const [pendingModal, setPendingModal] = useState(false);
  const [pendingMessage, setPendingMessage] = useState("");
  const [activeTxRef, setActiveTxRef] = useState<string | null>(null);

  useEffect(() => {
    async function fetchData() {
      try {
        const [u, s, uc, p, cfg] = await Promise.all([
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
        if (cfg.data) setConfig(cfg.data);
      } catch (err) {
        console.error("Failed to fetch billing data:", err);
      } finally {
        setLoading(false);
      }
    }
    fetchData();
  }, []);

  const handleUpgradeClick = async (planId: Plan) => {
    if (config?.mongike) {
      // Show mobile money modal
      setSelectedPlan(planId);
      setPhone("");
      setPhoneError(null);
      setModalOpen(true);
    } else {
      // Fallback: mock checkout
      setActionLoading(planId);
      try {
        const result = await billingApi.checkout(planId, "mock");
        if (result.data && "url" in result.data && result.data.url) {
          window.location.href = result.data.url;
          return;
        }
        alert(result.error || "Failed to start checkout");
      } catch (err) {
        console.error("Checkout error:", err);
        alert("Failed to start checkout");
      } finally {
        setActionLoading(null);
      }
    }
  };

  const handleMobileSubmit = async () => {
    if (!selectedPlan) return;
    const cleaned = phone.replace(/\D/g, "");
    if (cleaned.length < 9) {
      setPhoneError("Please enter a valid mobile number (e.g. 0712345678)");
      return;
    }
    setPhoneError(null);
    setModalOpen(false);
    setActionLoading(selectedPlan);

    try {
      setActiveTxRef(null);
      const result = await billingApi.checkout(selectedPlan, "mongike", phone);
      if (!result.data) {
        alert(result.error || "Failed to initiate payment");
        return;
      }
      if ("pending" in result.data && result.data.pending) {
        const txRef = result.data.orderReference as string;
        setActiveTxRef(txRef);
        setPendingMessage(result.data.message as string || "Check your phone for the payment prompt.");
        setPendingModal(true);
        // Poll every 3s, timeout after 3 min
        const interval = setInterval(async () => {
          try {
            const v = await billingApi.verifyPayment("", txRef, selectedPlan, "mongike");
            if (v.data?.success) {
              clearInterval(interval);
              setPendingModal(false);
              window.location.href = `/billing/success?plan=${selectedPlan}&txRef=${txRef}&gateway=mongike`;
            } else if (v.data && !v.data.success && v.data.message?.includes("failed")) {
              clearInterval(interval);
              setPendingModal(false);
              alert(v.data.message || "Payment failed.");
            }
          } catch { /* keep polling */ }
        }, 3000);
        setTimeout(() => {
          clearInterval(interval);
          setPendingModal(prev => { if (prev) alert("Payment timed out. Please try again."); return false; });
        }, 180_000);
      } else if ("url" in result.data && result.data.url) {
        window.location.href = result.data.url;
      }
    } catch (err) {
      console.error("Checkout error:", err);
      alert("Failed to initiate payment");
    } finally {
      setActionLoading(null);
    }
  };

  if (loading) {
    return (
      <div className="min-h-screen bg-[#020514]">
        <TopBar title="Billing" />
        <div className="p-8 max-w-7xl mx-auto space-y-8">
          <div className="h-64 bg-[#080d28]/60 border border-[#8d99c4]/15 animate-pulse rounded-3xl" />
          <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
            {[1, 2, 3].map(i => <div key={i} className="h-96 bg-[#080d28]/60 border border-[#8d99c4]/15 animate-pulse rounded-3xl" />)}
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-[#020514]">
      <TopBar title="Plans & Billing" />

      <div className="p-8 space-y-12 max-w-7xl mx-auto">
        
        {/* Active Plan & Usage Header */}
        <div className="grid grid-cols-1 lg:grid-cols-3 gap-8 items-stretch">
          <Card className="lg:col-span-1 bg-[#080d28]/60 border-[#8d99c4]/15 relative overflow-hidden backdrop-blur-md">
            <div className="absolute top-0 right-0 p-4 opacity-10">
              <Zap className="w-24 h-24 text-[#2b72f5]" />
            </div>
            <CardHeader>
              <CardDescription className="text-[#8d99c4]/70 uppercase font-bold tracking-widest text-[10px]">Your Current Plan</CardDescription>
              <CardTitle className="text-3xl font-black text-white flex items-center gap-2">
                {usage?.plan.toUpperCase()}
                {usage?.plan !== 'free' && <ShieldCheck className="w-6 h-6 text-[#2b72f5]" />}
              </CardTitle>
            </CardHeader>
            <CardContent className="space-y-6">
              <div className="space-y-1">
                <p className="text-sm text-[#8d99c4]">Monthly Usage</p>
                <p className="text-2xl font-bold text-white">
                  {subscription?.jobsUsedThisMonth ?? usage?.usage} <span className="text-[#8d99c4]/50 font-normal text-base">/ {subscription?.jobsLimitThisMonth === null ? "∞" : subscription?.jobsLimitThisMonth ?? usage?.limit} conversions</span>
                </p>
              </div>
              
              {subscription?.renewsAt && (
                <div className="space-y-1">
                  <p className="text-sm text-[#8d99c4]">Next Billing Date</p>
                  <p className="text-sm font-medium text-white">
                    {new Date(subscription.renewsAt).toLocaleDateString()}
                    {subscription.cancelAtPeriodEnd && (
                      <Badge variant="destructive" className="ml-2 text-xs bg-rose-500/10 text-rose-400 border border-rose-500/20">
                        Cancels at period end
                      </Badge>
                    )}
                  </p>
                </div>
              )}
            </CardContent>
          </Card>

          <Card className="lg:col-span-2 bg-[#080d28]/60 border-[#8d99c4]/15 backdrop-blur-md">
            <CardHeader className="flex flex-row items-center justify-between">
              <div>
                <CardTitle className="text-lg font-bold text-[#dee3f7]">Usage Activity</CardTitle>
                <CardDescription className="text-[#8d99c4]/80">Daily conversion history for the current billing cycle</CardDescription>
              </div>
            </CardHeader>
            <CardContent className="h-[200px] w-full pt-4">
              <ResponsiveContainer width="100%" height="100%">
                <BarChart data={usageChart.length > 0 ? usageChart : FAKE_CHART_DATA}>
                  <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="rgba(141, 153, 196, 0.1)" />
                  <XAxis dataKey={usageChart.length > 0 ? "date" : "name"} stroke="#8d99c4" fontSize={10} tickLine={false} axisLine={false} />
                  <YAxis stroke="#8d99c4" fontSize={10} tickLine={false} axisLine={false} />
                  <Tooltip 
                    contentStyle={{ backgroundColor: '#080d28', border: '1px solid rgba(141, 153, 196, 0.15)', borderRadius: '12px' }}
                    itemStyle={{ color: '#2b72f5', fontWeight: 'bold' }}
                  />
                  <Bar dataKey="jobs" fill="#2b72f5" radius={[4, 4, 0, 0]} />
                </BarChart>
              </ResponsiveContainer>
            </CardContent>
          </Card>
        </div>

        {/* Pricing Grid */}
        <section className="space-y-8">
          <div className="text-center space-y-2">
            <h2 className="text-3xl font-black text-white tracking-tight">Scale your distribution</h2>
            <p className="text-[#8d99c4]">Choose the plan that fits your build volume</p>
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

      </div>

      {/* Mobile Money Modal */}
      <Dialog open={modalOpen} onOpenChange={setModalOpen}>
        <DialogContent className="bg-[#080d28] border-[#8d99c4]/15 text-white rounded-3xl max-w-sm p-6">
          <DialogHeader>
            <div className="flex items-center gap-3 mb-1">
              <div className="w-10 h-10 rounded-2xl bg-[#2b72f5]/15 flex items-center justify-center">
                <Smartphone className="w-5 h-5 text-[#2b72f5]" />
              </div>
              <DialogTitle className="text-xl font-black">Mobile Money</DialogTitle>
            </div>
            <DialogDescription className="text-[#8d99c4]/80 text-sm">
              Upgrading to <span className="text-[#2b72f5] font-bold uppercase">{selectedPlan}</span> plan via Tanzania Mobile Money (M-Pesa, Tigo, Airtel, Halopesa).
            </DialogDescription>
          </DialogHeader>

          <div className="space-y-3 my-4">
            <Label htmlFor="mobile-phone" className="text-xs font-bold text-[#8d99c4] uppercase tracking-wider">
              Phone Number
            </Label>
            <Input
              id="mobile-phone"
              type="tel"
              placeholder="e.g. 0712 345 678"
              value={phone}
              onChange={e => { setPhone(e.target.value); setPhoneError(null); }}
              onKeyDown={e => e.key === "Enter" && handleMobileSubmit()}
              className="bg-[#020514] border-[#8d99c4]/20 rounded-xl focus-visible:ring-[#2b72f5] focus-visible:ring-1 text-white text-base py-5"
            />
            {phoneError && <p className="text-xs text-rose-400 font-medium">{phoneError}</p>}
            <p className="text-xs text-[#8d99c4]/60">You will receive a USSD push prompt on your phone to confirm the payment.</p>
          </div>

          <DialogFooter className="flex gap-2 mt-2">
            <Button
              variant="ghost"
              onClick={() => setModalOpen(false)}
              className="rounded-xl border border-[#8d99c4]/20 hover:bg-[#8d99c4]/10 text-[#8d99c4] hover:text-white"
            >
              Cancel
            </Button>
            <Button
              onClick={handleMobileSubmit}
              className="bg-[#2b72f5] hover:bg-[#1e5ecc] text-white rounded-xl font-bold px-6 shadow-[0_0_20px_rgba(43,114,245,0.3)]"
            >
              Send Payment Prompt
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* USSD Pending Modal */}
      <Dialog open={pendingModal} onOpenChange={setPendingModal}>
        <DialogContent className="bg-[#080d28] border-[#8d99c4]/15 text-white rounded-3xl max-w-sm p-8 text-center animate-in fade-in zoom-in-95 duration-200">
          <div className="flex justify-center mb-5">
            <div className="relative w-16 h-16 rounded-full bg-[#2b72f5]/10 flex items-center justify-center">
              <Loader2 className="w-8 h-8 text-[#2b72f5] animate-spin" />
              <div className="absolute inset-0 rounded-full bg-[#2b72f5]/20 animate-ping" />
            </div>
          </div>
          <DialogHeader>
            <DialogTitle className="text-xl font-black text-white text-center">Awaiting Payment</DialogTitle>
            <DialogDescription className="text-[#8d99c4] text-center mt-2 text-sm leading-relaxed">
              {pendingMessage}
            </DialogDescription>
          </DialogHeader>
          <div className="mt-5 p-4 bg-[#020514] border border-[#8d99c4]/15 rounded-2xl text-left text-xs text-[#8d99c4] space-y-1.5">
            <p className="font-bold text-[#dee3f7]">Steps:</p>
            <ol className="list-decimal pl-4 space-y-1">
              <li>Wait for the USSD prompt on your phone.</li>
              <li>Enter your Mobile Money PIN to confirm.</li>
              <li>This page will update automatically.</li>
            </ol>
          </div>
          {process.env.NODE_ENV === "development" && activeTxRef && (
            <div className="mt-6 pt-4 border-t border-[#8d99c4]/10 flex flex-col gap-2">
              <div className="text-[10px] text-yellow-500 font-bold uppercase tracking-widest">Dev Simulation Tool</div>
              <Button
                variant="outline"
                size="sm"
                onClick={async () => {
                  try {
                    const res = await fetch("http://localhost:3001/billing/webhooks/mongike", {
                      method: "POST",
                      headers: { "Content-Type": "application/json" },
                      body: JSON.stringify({
                        order_id: activeTxRef,
                        payment_status: "COMPLETED",
                        reference: "dev_mock_ref"
                      })
                    });
                    if (res.ok) {
                      console.log("Simulated webhook trigger success");
                    } else {
                      alert("Failed to trigger webhook simulation");
                    }
                  } catch (err: any) {
                    alert("Error: " + err.message);
                  }
                }}
                className="w-full bg-yellow-500/10 hover:bg-yellow-500/20 text-yellow-500 border-yellow-500/30 hover:border-yellow-500/50 font-bold py-2 text-xs rounded-xl"
              >
                Simulate Webhook Trigger
              </Button>
            </div>
          )}
        </DialogContent>
      </Dialog>

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
      "relative bg-[#080d28]/60 border-[#8d99c4]/15 transition-all duration-300 backdrop-blur-md flex flex-col justify-between",
      isPro && "border-[#2b72f5] shadow-[0_0_40px_rgba(43,114,245,0.25)] scale-105 z-10",
      isTeam && "border-[#fcc8b7]/40 shadow-[0_0_40px_rgba(252,200,183,0.1)]"
    )}>
      {isPro && (
        <div className="absolute top-0 left-1/2 -translate-x-1/2 -translate-y-1/2 px-4 py-1 bg-[#2b72f5] text-white text-[10px] font-black uppercase tracking-widest rounded-full shadow-[0_0_20px_rgba(43,114,245,0.4)]">
          Recommended
        </div>
      )}
      
      <CardHeader className="text-center pb-8">
        <div className="flex justify-center mb-4">
          <div className={cn(
            "w-14 h-14 rounded-2xl flex items-center justify-center",
            isPro ? "bg-[#2b72f5]/20 text-[#2b72f5]" : 
            isTeam ? "bg-[#fcc8b7]/25 text-[#fcc8b7]" : 
            isUltra ? "bg-[#2b72f5]/25 text-[#dee3f7]" : "bg-[#8d99c4]/10 text-[#8d99c4]"
          )}>
            {isPro ? <Zap className="w-8 h-8" /> : isTeam ? <Crown className="w-8 h-8" /> : isUltra ? <ShieldCheck className="w-8 h-8" /> : <Check className="w-8 h-8" />}
          </div>
        </div>
        <CardTitle className="text-2xl font-black text-[#dee3f7]">{plan.name}</CardTitle>
        <div className="mt-4 flex flex-col items-center">
          <div className="flex items-baseline gap-1">
            <span className="text-3xl font-black text-white">
              {plan.price === 0 ? "Free" : plan.price ? `${plan.price.toLocaleString()} TZS` : "Custom"}
            </span>
            {plan.price && plan.price > 0 ? <span className="text-[#8d99c4]/70 text-xs">/mo</span> : null}
          </div>
          <p className="text-[#8d99c4]/50 text-xs mt-1">
            {plan.conversionsPerMonth === 9999 ? "Unlimited" : plan.conversionsPerMonth} conversions / mo
          </p>
        </div>
      </CardHeader>

      <CardContent className="space-y-4 pb-8">
        {plan.features.map((feature, i) => (
          <div key={i} className="flex items-start gap-3">
            <div className="w-5 h-5 rounded-full bg-[#2b72f5]/10 flex items-center justify-center flex-shrink-0 mt-0.5">
              <Check className="w-3 h-3 text-[#fcc8b7]" />
            </div>
            <span className="text-sm text-[#8d99c4]">{feature}</span>
          </div>
        ))}
      </CardContent>

      <CardFooter>
        <Button 
          onClick={onUpgrade}
          disabled={isCurrent || loading || isFree}
          className={cn(
            "w-full rounded-xl py-6 font-bold transition-all",
            isCurrent ? "bg-[#2b72f5]/10 text-[#dee3f7] border border-[#2b72f5]/30 cursor-default" :
            isHigherTier ? "bg-[#2b72f5] hover:bg-[#1e5ecc] text-white shadow-[0_0_20px_rgba(43,114,245,0.3)]" : 
            isLowerTier ? "bg-[#8d99c4]/15 hover:bg-[#8d99c4]/25 text-[#dee3f7]" :
            "bg-[#8d99c4]/10 hover:bg-[#8d99c4]/20 text-[#dee3f7]"
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
