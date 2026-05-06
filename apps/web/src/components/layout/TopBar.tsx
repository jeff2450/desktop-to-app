"use client";

import Link from "next/link";

interface TopBarProps {
  title: string;
  action?: { label: string; href: string };
}

export function TopBar({ title, action }: TopBarProps) {
  return (
    <header className="h-14 border-b border-gray-800 bg-gray-950/80 backdrop-blur flex items-center justify-between px-6 sticky top-0 z-10">
      <h1 className="font-semibold text-white text-sm">{title}</h1>
      {action && (
        <Link
          href={action.href}
          className="px-3 py-1.5 bg-indigo-600 hover:bg-indigo-500 text-white text-xs font-medium rounded-lg transition-colors"
        >
          {action.label}
        </Link>
      )}
    </header>
  );
}
