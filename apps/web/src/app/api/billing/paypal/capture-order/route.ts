import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/lib/server-auth";
import { billingService } from "@/lib/billing-service";
import type { Plan } from "@/types";

export async function POST(request: NextRequest) {
  try {
    const user = await auth(request);
    if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

    const { orderID, plan } = await request.json();
    if (!orderID || !plan) return NextResponse.json({ error: "Missing required fields" }, { status: 400 });

    const authHeader = request.headers.get("authorization");
    const result = await billingService.capturePaypalOrder(user.id, orderID, plan as Plan, authHeader);
    return NextResponse.json(result);
  } catch (error) {
    console.error("PayPal Capture Order Error:", error);
    return NextResponse.json({ error: "Failed to capture order" }, { status: 500 });
  }
}
