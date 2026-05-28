"use client";

import React, { useEffect, useRef, useState } from "react";
import { Loader2, AlertCircle, CheckCircle2, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { getClientToken } from "@/lib/api-client";

interface PayPalCheckoutProps {
  planId: string;
  planName: string;
  price: number;
  onClose: () => void;
  onSuccess: () => void;
}

declare global {
  interface Window {
    paypal?: any;
  }
}

export function PayPalCheckout({ planId, planName, price, onClose, onSuccess }: PayPalCheckoutProps) {
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [scriptLoaded, setScriptLoaded] = useState(false);
  const containerRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    // Check if script is already loaded
    if (window.paypal) {
      setScriptLoaded(true);
      setLoading(false);
      return;
    }

    const script = document.createElement("script");
    const clientId = process.env.NEXT_PUBLIC_PAYPAL_CLIENT_ID || "test";
    script.src = `https://www.paypal.com/sdk/js?client-id=${clientId}&currency=USD&intent=capture&components=buttons`;
    script.async = true;
    script.onload = () => {
      setScriptLoaded(true);
      setLoading(false);
    };
    script.onerror = () => {
      setError("Failed to load PayPal SDK. Please check your internet connection.");
      setLoading(false);
    };
    document.body.appendChild(script);

    return () => {
      // We don't necessarily want to remove the script if the user closes the modal
      // as it might be used again. But we definitely want to stop rendering.
    };
  }, []);

  useEffect(() => {
    if (scriptLoaded && window.paypal && containerRef.current) {
      // Clear container before rendering
      containerRef.current.innerHTML = "";
      
      window.paypal.Buttons({
        style: {
          layout: 'vertical',
          color:  'gold',
          shape:  'rect',
          label:  'paypal'
        },
        createOrder: async () => {
          try {
            // getClientToken() holds the in-memory access token set after login/refresh.
            // On hard page refresh the memory is cleared — read from auth store state as fallback.
            const token = getClientToken();
            const res = await fetch("/api/billing/paypal/create-order", {
              method: "POST",
              headers: {
                "Content-Type": "application/json",
                ...(token ? { "Authorization": `Bearer ${token}` } : {}),
              },
              body: JSON.stringify({ plan: planId }),
            });

            if (!res.ok) {
              const errorBody = await res.text();
              console.error("Create order failed:", res.status, errorBody);
              // Surfacing the real server error helps diagnose auth/plan issues
              let friendlyMsg = "Failed to create PayPal order";
              try {
                const parsed = JSON.parse(errorBody);
                if (parsed?.error) friendlyMsg = parsed.error;
              } catch { /* ignore JSON parse errors */ }
              setError(friendlyMsg);
              throw new Error(friendlyMsg);
            }

            const data = await res.json();
            console.log("PayPal create-order response:", data);

            if (!data.id) {
              const msg = "No PayPal order ID returned from server";
              setError(msg);
              throw new Error(msg);
            }

            return data.id;
          } catch (err) {
            console.error("Create order error:", err);
            throw err;
          }
        },
        onApprove: async (data: any) => {
          try {
            const token = getClientToken();
            const res = await fetch("/api/billing/paypal/capture-order", {
              method: "POST",
              headers: {
                "Content-Type": "application/json",
                ...(token ? { "Authorization": `Bearer ${token}` } : {}),
              },
              body: JSON.stringify({ orderID: data.orderID, plan: planId }),
            });
            const result = await res.json();
            if (result.status === "COMPLETED") {
              onSuccess();
            } else {
              setError("Payment capture failed. Please contact support.");
            }
          } catch (err) {
            console.error("Capture order error:", err);
            setError("Something went wrong during payment verification.");
          }
        },
        onError: (err: any) => {
          console.error("PayPal Error:", err);
          setError("PayPal encountered an error. Please try again.");
        }
      }).render(containerRef.current);
    }
  }, [scriptLoaded, planId, onSuccess]);

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/80 backdrop-blur-sm p-4">
      <Card className="bg-white w-full max-w-md rounded-3xl overflow-hidden shadow-2xl animate-in zoom-in-95 duration-200">
        <div className="p-6 flex justify-between items-center border-b border-zinc-100">
          <div>
            <h3 className="text-xl font-black text-zinc-900">Complete Purchase</h3>
            <p className="text-sm text-zinc-500">{planName} Subscription • ${price}/mo</p>
          </div>
          <button 
            onClick={onClose}
            className="text-zinc-400 hover:text-zinc-600 transition-colors"
          >
            <X className="w-6 h-6" />
          </button>
        </div>

        <div className="p-8">
          {loading && (
            <div className="flex flex-col items-center justify-center py-12 space-y-4">
              <Loader2 className="w-8 h-8 animate-spin text-indigo-600" />
              <p className="text-sm text-zinc-500 font-medium">Initializing secure checkout...</p>
            </div>
          )}

          {error && (
            <div className="bg-red-50 border border-red-100 rounded-2xl p-6 text-center space-y-4 mb-6">
              <AlertCircle className="w-10 h-10 text-red-500 mx-auto" />
              <div className="space-y-1">
                <p className="text-red-900 font-bold">Checkout Error</p>
                <p className="text-red-700 text-sm">{error}</p>
              </div>
              <Button 
                onClick={onClose}
                className="w-full bg-red-600 hover:bg-red-700 text-white rounded-xl"
              >
                Close & Try Again
              </Button>
            </div>
          )}

          <div 
            className={loading || error ? "hidden" : "block min-h-[300px]"} 
            id="paypal-button-container" 
            ref={containerRef}
          />
        </div>

        <div className="bg-zinc-50 p-4 border-t border-zinc-100 flex items-center justify-center gap-2">
          <CheckCircle2 className="w-4 h-4 text-emerald-500" />
          <span className="text-[10px] uppercase font-black tracking-widest text-zinc-400">Secure Payment powered by PayPal</span>
        </div>
      </Card>
    </div>
  );
}
