import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/lib/server-auth";
import { billingService } from "@/lib/billing-service";
import type { Plan } from "@/types";

export async function POST(request: NextRequest) {
  try {
    const user = await auth(request);
    if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

    const { plan } = await request.json();
    if (!plan) return NextResponse.json({ error: "Plan is required" }, { status: 400 });

    const authHeader = request.headers.get("authorization");
    const order = await billingService.createPaypalOrder(user.id, plan as Plan, authHeader);
    return NextResponse.json(order);
  } catch (error) {
    console.error("PayPal Create Order Error:", error);
    return NextResponse.json({ error: "Failed to create order" }, { status: 500 });
  }
}
