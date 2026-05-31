"use client";

import { useEffect, useState, Suspense } from "react";
import { useSearchParams } from "next/navigation";
import { TopBar } from "@/components/layout/TopBar";
import { billingApi } from "@/lib/api-client";
import type { Plan } from "@/types";
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
  CheckCircle2, 
  ArrowRight, 
  PartyPopper,
  Sparkles,
  Loader2,
  XCircle
} from "lucide-react";
import Link from "next/link";

export default function BillingSuccessPage() {
  return (
    <Suspense fallback={
      <div className="min-h-screen bg-zinc-950 flex items-center justify-center">
        <div className="w-full max-w-lg h-96 bg-zinc-900 border border-zinc-800 rounded-2xl animate-pulse" />
      </div>
    }>
      <BillingSuccessContent />
    </Suspense>
  );
}

function BillingSuccessContent() {
  const searchParams = useSearchParams();
  const plan = (searchParams.get("plan") || "pro") as Plan;
  const txRef =
    searchParams.get("txRef") ||
    searchParams.get("orderReference") ||
    searchParams.get("order_reference");
  const transactionId =
    searchParams.get("transactionId") ||
    searchParams.get("paymentReference") ||
    searchParams.get("payment_reference") ||
    txRef;

  const [message, setMessage] = useState("Your payment was processed successfully.");
  const [isChecking, setIsChecking] = useState(Boolean(txRef));
  const [isFailed, setIsFailed] = useState(false);

  useEffect(() => {
    if (!txRef || !transactionId) return;

    let cancelled = false;

    async function verifyClickPesaPayment() {
      setIsChecking(true);
      setIsFailed(false);

      const result = await billingApi.verifyPayment(transactionId!, txRef!, plan);

      if (cancelled) return;

      if (result.data?.success) {
        setMessage(result.data.message || "Your payment was processed successfully.");
        setIsFailed(false);
      } else {
        setMessage(result.error || result.data?.message || "We could not verify the payment yet.");
        setIsFailed(true);
      }

      setIsChecking(false);
    }

    verifyClickPesaPayment();

    return () => {
      cancelled = true;
    };
  }, [plan, transactionId, txRef]);

  return (
    <div className="min-h-screen bg-zinc-950">
      <TopBar title={isFailed ? "Payment Not Verified" : "Upgrade Successful"} />
      
      <div className="p-8 flex items-center justify-center min-h-[80vh]">
        <Card className="w-full max-w-lg bg-zinc-900 border-zinc-800 text-center p-8 overflow-hidden relative">
          <div className={`absolute top-0 left-0 w-full h-1 ${isFailed ? "bg-rose-500" : "bg-gradient-to-r from-indigo-500 via-cyan-500 to-emerald-500"}`} />
          
          <div className="flex justify-center mb-6">
            <div className={`w-20 h-20 rounded-full flex items-center justify-center relative ${
              isFailed ? "bg-rose-500/10 text-rose-500" : "bg-emerald-500/10 text-emerald-500"
            }`}>
              {isChecking ? (
                <Loader2 className="w-12 h-12 animate-spin" />
              ) : isFailed ? (
                <XCircle className="w-12 h-12" />
              ) : (
                <CheckCircle2 className="w-12 h-12" />
              )}
              {!isChecking && !isFailed && <div className="absolute inset-0 animate-ping bg-emerald-500/20 rounded-full" />}
            </div>
          </div>

          <CardHeader>
            <div className="flex justify-center gap-2 mb-2">
               <PartyPopper className="w-5 h-5 text-amber-500" />
               <span className="text-xs font-bold text-amber-500 uppercase tracking-[0.2em]">
                {isChecking ? "Verifying Payment" : isFailed ? "Action Needed" : "Payment Received"}
               </span>
               <Sparkles className="w-5 h-5 text-amber-500" />
            </div>
            <CardTitle className="text-3xl font-black text-white">
              {isChecking ? "One moment..." : isFailed ? "We could not verify it" : "You're all set!"}
            </CardTitle>
            <CardDescription className="text-zinc-500 mt-2 text-base">
              {isChecking || isFailed ? message : (
                <>
                  Your account has been upgraded to the <span className="text-indigo-400 font-bold">{plan.toUpperCase()}</span> plan.
                  You now have increased limits and premium features.
                </>
              )}
            </CardDescription>
          </CardHeader>

          <CardContent className="py-8">
            <div className="bg-zinc-950 border border-zinc-800 rounded-2xl p-6 text-left space-y-4">
              <h4 className="text-xs font-bold text-zinc-500 uppercase tracking-widest">Next Steps</h4>
              <ul className="space-y-3">
                <li className="flex items-center gap-3 text-sm text-zinc-400">
                  <div className="w-5 h-5 rounded-full bg-emerald-500/10 flex items-center justify-center text-[10px] font-bold text-emerald-500">1</div>
                  Check your inbox for the receipt.
                </li>
                <li className="flex items-center gap-3 text-sm text-zinc-400">
                  <div className="w-5 h-5 rounded-full bg-emerald-500/10 flex items-center justify-center text-[10px] font-bold text-emerald-500">2</div>
                  Head to the dashboard to start a new job.
                </li>
                <li className="flex items-center gap-3 text-sm text-zinc-400">
                  <div className="w-5 h-5 rounded-full bg-emerald-500/10 flex items-center justify-center text-[10px] font-bold text-emerald-500">3</div>
                  Download your premium artifacts!
                </li>
              </ul>
            </div>
          </CardContent>

          <CardFooter className="flex flex-col gap-3">
            <Button asChild disabled={isChecking} className="w-full bg-indigo-600 hover:bg-indigo-500 text-white rounded-xl py-6 font-bold shadow-lg">
              <Link href="/dashboard" className="flex items-center gap-2">
                {isFailed ? "Return to Dashboard" : "Go to Dashboard"} <ArrowRight className="w-4 h-4" />
              </Link>
            </Button>
            <Button variant="ghost" asChild className="text-zinc-500 hover:text-white">
              <Link href="/billing">View Billing Settings</Link>
            </Button>
          </CardFooter>
        </Card>
      </div>
    </div>
  );
}
