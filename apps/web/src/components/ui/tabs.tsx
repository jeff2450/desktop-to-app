"use client";

import * as React from "react";
import { cn } from "@/lib/utils";

interface TabsContextProps {
  activeTab: string;
  setActiveTab: (id: string) => void;
}

const TabsContext = React.createContext<TabsContextProps | undefined>(undefined);

export function Tabs({ defaultValue, children, className }: { defaultValue: string, children: React.ReactNode, className?: string }) {
  const [activeTab, setActiveTab] = React.useState(defaultValue);
  return (
    <TabsContext.Provider value={{ activeTab, setActiveTab }}>
      <div className={cn("space-y-6", className)}>{children}</div>
    </TabsContext.Provider>
  );
}

export function TabsList({ children, className }: { children: React.ReactNode, className?: string }) {
  return (
    <div className={cn("flex items-center gap-1 p-1 bg-zinc-900/50 border border-zinc-800 rounded-2xl w-fit", className)}>
      {children}
    </div>
  );
}

export function TabsTrigger({ value, label, icon: Icon }: { value: string, label: string, icon?: any }) {
  const context = React.useContext(TabsContext);
  if (!context) return null;
  
  const isActive = context.activeTab === value;
  
  return (
    <button
      onClick={() => context.setActiveTab(value)}
      className={cn(
        "flex items-center gap-2 px-4 py-2 rounded-xl text-sm font-bold transition-all",
        isActive 
          ? "bg-zinc-800 text-white shadow-lg" 
          : "text-zinc-500 hover:text-zinc-300"
      )}
    >
      {Icon && <Icon className="w-4 h-4" />}
      {label}
    </button>
  );
}

export function TabsContent({ value, children }: { value: string, children: React.ReactNode }) {
  const context = React.useContext(TabsContext);
  if (!context || context.activeTab !== value) return null;
  return <div className="animate-in fade-in slide-in-from-bottom-2 duration-300">{children}</div>;
}
