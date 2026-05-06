"use client";

import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { clearToken } from "../../lib/auth";

const NAV = [
  { href: "/dashboard",             label: "Dashboard",    icon: "⊞" },
  { href: "/dashboard/conversions", label: "Conversions",  icon: "⇄" },
  { href: "/dashboard/billing",     label: "Billing",      icon: "₿" },
  { href: "/dashboard/settings",    label: "Settings",     icon: "⚙" },
];

export function Sidebar({ userEmail }: { userEmail?: string }) {
  const pathname = usePathname();
  const router = useRouter();

  function logout() {
    clearToken();
    router.push("/auth/login");
  }

  return (
    <aside className="fixed inset-y-0 left-0 w-60 bg-gray-900 border-r border-gray-800 flex flex-col z-10">
      {/* Logo */}
      <div className="px-4 py-5 border-b border-gray-800">
        <div className="flex items-center gap-2">
          <div className="w-7 h-7 rounded-md bg-indigo-600 flex items-center justify-center text-white font-bold text-xs">W</div>
          <span className="font-semibold text-sm text-white">WebToApp</span>
        </div>
      </div>

      {/* Nav */}
      <nav className="flex-1 px-3 py-4 space-y-0.5 overflow-y-auto">
        {NAV.map(({ href, label, icon }) => {
          const active = href === "/dashboard" ? pathname === href : pathname.startsWith(href);
          return (
            <Link
              key={href}
              href={href}
              className={`flex items-center gap-3 px-3 py-2 rounded-lg text-sm transition-colors ${
                active
                  ? "bg-indigo-600/20 text-indigo-400 font-medium"
                  : "text-gray-400 hover:text-gray-200 hover:bg-gray-800"
              }`}
            >
              <span className="text-base leading-none">{icon}</span>
              {label}
            </Link>
          );
        })}
      </nav>

      {/* User */}
      <div className="px-3 py-4 border-t border-gray-800">
        {userEmail && (
          <p className="text-xs text-gray-500 px-3 mb-2 truncate">{userEmail}</p>
        )}
        <button
          onClick={logout}
          className="flex items-center gap-3 px-3 py-2 rounded-lg text-sm text-gray-400 hover:text-gray-200 hover:bg-gray-800 w-full transition-colors"
        >
          <span className="text-base leading-none">→</span>
          Sign out
        </button>
      </div>
    </aside>
  );
}
