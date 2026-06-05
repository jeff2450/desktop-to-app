"use client";

import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { 
  LayoutDashboard, 
  Files, 
  CreditCard, 
  Settings, 
  LogOut, 
  ChevronRight,
  Plus
} from "lucide-react";
import { useAuthStore } from "@/stores/auth";
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";

const NAV_ITEMS = [
  { href: "/dashboard", label: "Dashboard", icon: LayoutDashboard },
  { href: "/jobs", label: "My Jobs", icon: Files },
  { href: "/billing", label: "Billing", icon: CreditCard },
  { href: "/settings", label: "Settings", icon: Settings },
];

export function Sidebar() {
  const pathname = usePathname();
  const router = useRouter();
  const { user, logout } = useAuthStore();

  const handleLogout = () => {
    logout();
    router.push("/login");
  };

  return (
    <aside className="fixed inset-y-0 left-0 w-64 bg-[#030720]/50 border-r border-[#8d99c4]/10 backdrop-blur-xl flex flex-col z-50">
      {/* Logo */}
      <div className="px-6 py-8">
        <Link href="/" className="flex items-center gap-3 group">
          <div className="w-9 h-9 rounded-xl bg-[#2b72f5] flex items-center justify-center text-white font-bold text-lg shadow-[0_0_15px_rgba(43,114,245,0.4)] group-hover:scale-110 transition-transform">
            W
          </div>
          <span className="font-bold text-xl tracking-tight text-white">WebToApp</span>
        </Link>
      </div>

      {/* New Job Button */}
      <div className="px-4 mb-6">
        <Button 
          asChild 
          className="w-full bg-[#2b72f5] hover:bg-[#1a5ecc] text-white shadow-[0_0_20px_rgba(43,114,245,0.35)]"
        >
          <Link href="/jobs/new" className="flex items-center gap-2">
            <Plus className="w-4 h-4" />
            New Conversion
          </Link>
        </Button>
      </div>

      {/* Navigation */}
      <nav className="flex-1 px-3 space-y-1">
        {NAV_ITEMS.map((item) => {
          const isActive = item.href === "/dashboard" 
            ? pathname === "/dashboard" 
            : pathname.startsWith(item.href);
          
          return (
            <Link
              key={item.href}
              href={item.href}
              className={cn(
                "flex items-center justify-between px-3 py-2.5 rounded-xl text-sm font-medium transition-all group",
                isActive 
                  ? "bg-[#2b72f5]/15 text-[#2b72f5] font-semibold border-l-2 border-[#2b72f5]" 
                  : "text-[#8d99c4] hover:text-white hover:bg-[#030720]/50"
              )}
            >
              <div className="flex items-center gap-3">
                <item.icon className={cn("w-5 h-5", isActive ? "text-[#2b72f5]" : "text-[#8d99c4]/65 group-hover:text-white")} />
                {item.label}
              </div>
              {isActive && <ChevronRight className="w-4 h-4" />}
            </Link>
          );
        })}
      </nav>

      {/* User & Footer */}
      <div className="p-4 border-t border-[#8d99c4]/10 bg-[#030720]/20">
        <Link href="/settings" className="flex items-center gap-3 px-2 py-3 mb-2 hover:bg-[#030720]/50 rounded-xl transition-colors cursor-pointer">
          <div className="w-8 h-8 rounded-full bg-gradient-to-tr from-[#2b72f5] to-[#fcc8b7] flex items-center justify-center text-white text-xs font-bold">
            {(user?.name ?? user?.email)?.[0]?.toUpperCase() || "U"}
          </div>
          <div className="flex-1 min-w-0">
            <p className="text-sm font-medium text-white truncate">{user?.name || user?.email}</p>
            <p className="text-[10px] font-bold text-[#fcc8b7] uppercase tracking-wider">{user?.plan || "FREE"} PLAN</p>
          </div>
        </Link>
        
        <button
          onClick={handleLogout}
          className="flex items-center gap-3 px-3 py-2 w-full rounded-xl text-sm font-medium text-[#8d99c4] hover:text-rose-400 hover:bg-rose-500/5 transition-all group"
        >
          <LogOut className="w-5 h-5 group-hover:translate-x-1 transition-transform" />
          Sign Out
        </button>
      </div>
    </aside>
  );
}
