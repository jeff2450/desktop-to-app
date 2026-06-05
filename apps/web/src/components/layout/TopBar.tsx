"use client";

import { useAuthStore } from "@/stores/auth";
import { Bell, Search } from "lucide-react";
import { cn } from "@/lib/utils";
import Link from "next/link";

interface TopBarProps {
  title: string;
}

export function TopBar({ title }: TopBarProps) {
  const { user } = useAuthStore();

  return (
    <header className="h-16 border-b border-[#8d99c4]/10 bg-[#020514]/80 backdrop-blur-md flex items-center justify-between px-8 sticky top-0 z-40">
      <div className="flex items-center gap-4">
        <h1 className="text-lg font-semibold text-white tracking-tight">{title}</h1>
      </div>

      <div className="flex items-center gap-6">
        {/* Search - Decorative for now */}
        <div className="hidden md:flex items-center relative">
          <Search className="w-4 h-4 text-[#8d99c4]/60 absolute left-3" />
          <input 
            type="text" 
            placeholder="Search jobs..." 
            className="bg-[#030720]/50 border border-[#8d99c4]/15 rounded-full py-1.5 pl-10 pr-4 text-sm text-[#dee3f7]/80 placeholder-[#8d99c4]/40 focus:outline-none focus:ring-1 focus:ring-[#2b72f5] transition-all w-64"
          />
        </div>

        <button 
          type="button"
          onClick={() => alert("You have no new notifications.")}
          className="relative text-[#8d99c4] hover:text-white transition-colors"
        >
          <Bell className="w-5 h-5" />
          <span className="absolute top-0 right-0 w-2 h-2 bg-[#2b72f5] rounded-full border-2 border-[#020514]" />
        </button>

        <div className="h-8 w-[1px] bg-[#8d99c4]/10" />

        <Link href="/settings" className="flex items-center gap-3 hover:opacity-80 transition-opacity cursor-pointer">
          <div className="flex flex-col items-end hidden sm:flex">
            <span className="text-sm font-medium text-white">{user?.name || user?.email?.split('@')[0]}</span>
            <span className="text-[10px] text-[#8d99c4]">{user?.email}</span>
          </div>
          <div className="w-9 h-9 rounded-full bg-[#2b72f5]/15 border border-[#2b72f5]/20 flex items-center justify-center text-[#2b72f5] font-bold text-sm">
            {user?.email?.[0]?.toUpperCase() || "U"}
          </div>
        </Link>
      </div>
    </header>
  );
}
