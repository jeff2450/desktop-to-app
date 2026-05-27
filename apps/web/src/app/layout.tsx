import type { Metadata, Viewport } from "next";
import { Inter } from "next/font/google";
import "./globals.css";

const inter = Inter({ subsets: ["latin"] });

export const metadata: Metadata = {
  metadataBase: new URL(process.env["NEXT_PUBLIC_SITE_URL"] ?? "http://localhost:3000"),
  title: {
    default: "WebToApp — Convert Web Apps to Desktop",
    template: "%s | WebToApp",
  },
  description:
    "Convert AI-generated web apps to offline-capable native desktop installers automatically. Supports React, Next.js, Supabase and more.",
  icons: {
    icon: [
      { url: "/favicon.png", type: "image/png" },
      { url: "/favicon.ico" },
    ],
  },
  openGraph: {
    type: "website",
    siteName: "WebToApp",
    title: "WebToApp — Convert Web Apps to Desktop",
    description:
      "Turn your React, Supabase, and Next.js projects into native desktop apps in 60 seconds.",
    images: [{ url: "/og-image.png", width: 1200, height: 630, alt: "WebToApp" }],
  },
  twitter: {
    card: "summary_large_image",
    title: "WebToApp — Convert Web Apps to Desktop",
    description:
      "Turn your React, Supabase, and Next.js projects into native desktop apps in 60 seconds.",
    images: ["/og-image.png"],
  },
};

export const viewport: Viewport = {
  themeColor: "#09090b",
  width: "device-width",
  initialScale: 1,
};

import { Providers } from "@/components/providers";

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en" className="h-full" suppressHydrationWarning>
      <body className={`${inter.className} h-full bg-zinc-950 text-zinc-100 antialiased`}>
        <Providers attribute="class" defaultTheme="dark" enableSystem={false}>
          {children}
        </Providers>
      </body>
    </html>
  );
}
