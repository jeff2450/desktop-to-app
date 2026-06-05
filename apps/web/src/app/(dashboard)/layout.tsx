"use client";

import { Sidebar } from "@/components/layout/Sidebar";
import { useEffect } from "react";
import { useRouter } from "next/navigation";
import { useAuthStore } from "@/stores/auth";

export default function DashboardLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const { user, isLoading } = useAuthStore();
  const router = useRouter();

  useEffect(() => {
    if (!isLoading && !user) {
      router.push("/login");
    }
  }, [user, isLoading, router]);

  if (isLoading || !user) {
    return (
      <div className="min-h-screen bg-[#020514] flex items-center justify-center">
        <div className="w-10 h-10 border-4 border-[#2b72f5]/20 border-t-[#2b72f5] rounded-full animate-spin" />
      </div>
    );
  }

  return (
    <div className="flex min-h-screen bg-[#020514] text-[#dee3f7]">
      <Sidebar />
      <main className="flex-1 pl-64 transition-all duration-300">
        {children}
      </main>
    </div>
  );
}
