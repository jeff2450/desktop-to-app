import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/lib/server-auth";
import { billingService } from "@/lib/billing-service";
import type { Plan } from "@/types";

export async function POST(request: NextRequest) {
  try {
    const user = await auth(request);
    if (!user) {
      return NextResponse.json(
        { error: "You must be logged in to complete this purchase" },
        { status: 401 }
      );
    }

    const body = await request.json();
    const { plan } = body;
    if (!plan) return NextResponse.json({ error: "Plan is required" }, { status: 400 });

    const authHeader = request.headers.get("authorization");
    console.log("[paypal/create-order] userId:", user.id, "plan:", plan, "hasAuth:", !!authHeader);

    const order = await billingService.createPaypalOrder(user.id, plan as Plan, authHeader);
    return NextResponse.json(order);
  } catch (error: any) {
    const message = error?.message ?? "Failed to create PayPal order";
    console.error("PayPal Create Order Error:", message, error);
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
