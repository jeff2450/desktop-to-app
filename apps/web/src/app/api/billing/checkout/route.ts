import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { billingService } from "@/lib/billing-service";

export const dynamic = "force-dynamic";

export async function POST(request: NextRequest) {
  try {
    const user = await auth(request);
    if (!user) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const { plan } = await request.json();
    if (!plan) {
      return NextResponse.json({ error: "Plan is required" }, { status: 400 });
    }

    const checkoutUrl = await billingService.createCheckout(user.id, plan);
    return NextResponse.json({ url: checkoutUrl });
  } catch (error) {
    console.error("Checkout API error:", error);
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}