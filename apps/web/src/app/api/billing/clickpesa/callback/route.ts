import { NextRequest, NextResponse } from "next/server";
import { billingService } from "@/lib/billing-service";

export const dynamic = "force-dynamic";

async function handleCallback(request: NextRequest) {
  const orderReference = request.nextUrl.searchParams.get("orderReference");

  if (!orderReference) {
    return NextResponse.json({ error: "Order reference is required" }, { status: 400 });
  }

  try {
    const result = await billingService.handleClickPesaCallback(orderReference);
    return NextResponse.json(result, { status: result.success ? 200 : 202 });
  } catch (error) {
    console.error("ClickPesa callback error:", error);
    return NextResponse.json({ error: "Unable to verify ClickPesa payment" }, { status: 500 });
  }
}

export async function GET(request: NextRequest) {
  return handleCallback(request);
}

export async function POST(request: NextRequest) {
  return handleCallback(request);
}
