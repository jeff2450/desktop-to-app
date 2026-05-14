import { NextRequest, NextResponse } from "next/server";
import { billingService } from "@/lib/billing-service";

export async function GET(request: NextRequest) {
  try {
    const plans = await billingService.getPlans();
    return NextResponse.json(plans);
  } catch (error) {
    console.error("Plans API error:", error);
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}