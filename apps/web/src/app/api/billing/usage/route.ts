import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/lib/server-auth";
import { billingService } from "@/lib/billing-service";

export const dynamic = "force-dynamic";

export async function GET(request: NextRequest) {
  try {
    const user = await auth(request);
    if (!user) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const usage = await billingService.getUsage(user.id);
    return NextResponse.json(usage);
  } catch (error) {
    console.error("Usage API error:", error);
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}