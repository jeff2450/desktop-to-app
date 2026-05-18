import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";

// Define route categories
const protectedRoutes = ["/dashboard", "/jobs", "/billing", "/settings"];
const authRoutes = ["/login", "/register"];

export function middleware(request: NextRequest) {
  const { pathname } = request.nextUrl;
  const hasRefreshToken = request.cookies.has("webtoapp_refresh_token");

  // Check if trying to access a protected route
  const isProtectedRoute = protectedRoutes.some((route) =>
    pathname.startsWith(route)
  );

  if (isProtectedRoute && !hasRefreshToken) {
    // Redirect to login if accessing protected route without token
    const url = new URL("/login", request.url);
    url.searchParams.set("from", pathname);
    return NextResponse.redirect(url);
  }

  // Check if trying to access auth routes while already logged in
  const isAuthRoute = authRoutes.some((route) => pathname.startsWith(route));

  if (isAuthRoute && hasRefreshToken) {
    // Redirect to dashboard if trying to login/register while authenticated
    return NextResponse.redirect(new URL("/dashboard", request.url));
  }

  return NextResponse.next();
}

export const config = {
  matcher: [
    // Apply middleware to these routes
    "/dashboard/:path*",
    "/jobs/:path*",
    "/billing/:path*",
    "/settings/:path*",
    "/login",
    "/register",
  ],
};
