import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/lib/server-auth";
import type { Plan } from "@/types";
import { billingService } from "@/lib/billing-service";

export const dynamic = "force-dynamic";

const purchasablePlans: Plan[] = ["pro", "team"];

export async function POST(request: NextRequest) {
  try {
    const user = await auth(request);
    if (!user) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const { plan } = (await request.json()) as { plan?: Plan };
    if (!plan) {
      return NextResponse.json({ error: "Plan is required" }, { status: 400 });
    }

    if (!purchasablePlans.includes(plan)) {
      return NextResponse.json({ error: "This plan cannot be purchased through checkout" }, { status: 400 });
    }

    const checkoutUrl = await billingService.createCheckout(user, plan);
    return NextResponse.json({ url: checkoutUrl });
  } catch (error) {
    console.error("Checkout API error:", error);
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}
