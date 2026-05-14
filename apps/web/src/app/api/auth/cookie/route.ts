import { cookies } from "next/headers";
import { NextResponse } from "next/server";

export async function POST(request: Request) {
  const { refreshToken } = await request.json();

  if (refreshToken) {
    cookies().set("webtoapp_refresh_token", refreshToken, {
      httpOnly: true,
      secure: process.env.NODE_ENV === "production",
      sameSite: "strict",
      maxAge: 7 * 24 * 60 * 60, // 7 days
      path: "/",
    });
  }

  return NextResponse.json({ success: true });
}

export async function DELETE() {
  cookies().delete("webtoapp_refresh_token");
  return NextResponse.json({ success: true });
}

export async function GET() {
  const token = cookies().get("webtoapp_refresh_token")?.value;
  return NextResponse.json({ refreshToken: token || null });
}
