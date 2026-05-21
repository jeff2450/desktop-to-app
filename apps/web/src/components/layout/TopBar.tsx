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
    <header className="h-16 border-b border-zinc-800 bg-zinc-950/50 backdrop-blur-xl flex items-center justify-between px-8 sticky top-0 z-40">
      <div className="flex items-center gap-4">
        <h1 className="text-lg font-semibold text-white tracking-tight">{title}</h1>
      </div>

      <div className="flex items-center gap-6">
        {/* Search - Decorative for now */}
        <div className="hidden md:flex items-center relative">
          <Search className="w-4 h-4 text-zinc-500 absolute left-3" />
          <input 
            type="text" 
            placeholder="Search jobs..." 
            className="bg-zinc-900 border border-zinc-800 rounded-full py-1.5 pl-10 pr-4 text-sm text-zinc-300 focus:outline-none focus:ring-1 focus:ring-indigo-500 transition-all w-64"
          />
        </div>

        <button className="relative text-zinc-400 hover:text-white transition-colors">
          <Bell className="w-5 h-5" />
          <span className="absolute top-0 right-0 w-2 h-2 bg-indigo-500 rounded-full border-2 border-zinc-950" />
        </button>

        <div className="h-8 w-[1px] bg-zinc-800" />

        <Link href="/settings" className="flex items-center gap-3 hover:opacity-80 transition-opacity cursor-pointer">
          <div className="flex flex-col items-end hidden sm:flex">
            <span className="text-sm font-medium text-white">{user?.name || user?.email?.split('@')[0]}</span>
            <span className="text-[10px] text-zinc-500">{user?.email}</span>
          </div>
          <div className="w-9 h-9 rounded-full bg-indigo-600/20 border border-indigo-500/20 flex items-center justify-center text-indigo-400 font-bold text-sm">
            {user?.email?.[0]?.toUpperCase() || "U"}
          </div>
        </Link>
      </div>
    </header>
  );
}
