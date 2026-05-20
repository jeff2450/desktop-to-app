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

    const { transactionId, txRef, plan } = (await request.json()) as {
      transactionId?: string;
      txRef?: string;
      plan?: Plan;
    };

    if (!transactionId || !txRef || !plan) {
      return NextResponse.json(
        { error: "Transaction ID, transaction reference, and plan are required" },
        { status: 400 }
      );
    }

    if (!purchasablePlans.includes(plan)) {
      return NextResponse.json({ error: "This plan cannot be verified through checkout" }, { status: 400 });
    }

    const result = await billingService.verifyPayment(user.id, transactionId, txRef, plan);
    return NextResponse.json(result, { status: result.success ? 200 : 400 });
  } catch (error) {
    console.error("Payment verification API error:", error);
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}
