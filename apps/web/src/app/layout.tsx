import type { Metadata } from "next";
import { Inter } from "next/font/google";
import "./globals.css";

const inter = Inter({ subsets: ["latin"] });

export const metadata: Metadata = {
  title: "WebToApp — Convert Web Apps to Desktop",
  description: "Convert AI-generated web apps to offline desktop apps automatically.",
  icons: { icon: "/favicon.ico" },
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
