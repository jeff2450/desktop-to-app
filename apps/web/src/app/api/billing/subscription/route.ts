import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { billingService } from "@/lib/billing-service";

export const dynamic = "force-dynamic";

export async function GET(request: NextRequest) {
  try {
    const user = await auth(request);
    if (!user) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const subscription = await billingService.getSubscription(user.id);
    return NextResponse.json(subscription);
  } catch (error) {
    console.error("Subscription API error:", error);
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}