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

    const portalUrl = await billingService.createPortal(user.id);
    return NextResponse.json({ url: portalUrl });
  } catch (error) {
    console.error("Portal API error:", error);
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}