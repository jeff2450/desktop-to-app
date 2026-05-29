"use client";

import Link from "next/link";
import type { Conversion, ConversionStatus } from "../../types";

const STATUS_CONFIG: Record<
  ConversionStatus,
  { label: string; color: string; dot: string }
> = {
  queued: { label: "Queued", color: "text-gray-400", dot: "bg-gray-500" },
  running: {
    label: "Running",
    color: "text-blue-400",
    dot: "bg-blue-500 animate-pulse",
  },
  detecting: {
    label: "Detecting",
    color: "text-blue-400",
    dot: "bg-blue-500 animate-pulse",
  },
  planning: {
    label: "Planning",
    color: "text-blue-400",
    dot: "bg-blue-500 animate-pulse",
  },
  transforming: {
    label: "Transforming",
    color: "text-yellow-400",
    dot: "bg-yellow-500 animate-pulse",
  },
  scaffolding: {
    label: "Scaffolding",
    color: "text-yellow-400",
    dot: "bg-yellow-500 animate-pulse",
  },
  installing: {
    label: "Installing",
    color: "text-orange-400",
    dot: "bg-orange-500 animate-pulse",
  },
  building: {
    label: "Building",
    color: "text-orange-400",
    dot: "bg-orange-500 animate-pulse",
  },
  packaging: {
    label: "Packaging",
    color: "text-purple-400",
    dot: "bg-purple-500 animate-pulse",
  },
  done: { label: "Done", color: "text-green-400", dot: "bg-green-500" },
  failed: { label: "Failed", color: "text-red-400", dot: "bg-red-500" },
  cancelled: { label: "Cancelled", color: "text-gray-500", dot: "bg-gray-600" },
};

const STAGE_PROGRESS: Record<ConversionStatus, number> = {
  queued: 0,
  running: 40,
  detecting: 12,
  planning: 25,
  transforming: 38,
  scaffolding: 50,
  installing: 62,
  building: 75,
  packaging: 88,
  done: 100,
  failed: 0,
  cancelled: 0,
};

interface Props {
  conversion: Conversion;
  compact?: boolean;
}

export function JobStatusCard({ conversion, compact = false }: Props) {
  const cfg = STATUS_CONFIG[conversion.status] ?? STATUS_CONFIG.queued;
  const progress = typeof conversion.progress === "number"
    ? conversion.progress
    : STAGE_PROGRESS[conversion.status] ?? 0;
  const isActive = !["done", "failed", "cancelled"].includes(conversion.status);

  if (compact) {
    return (
      <Link
        href={`/dashboard/conversions/${conversion.id}`}
        className="flex items-center gap-3 px-4 py-3 bg-gray-900 border border-gray-800 rounded-lg hover:border-gray-700 transition-colors"
      >
        <span className={`w-2 h-2 rounded-full flex-shrink-0 ${cfg.dot}`} />
        <span className="flex-1 text-sm text-white truncate">
          {conversion.name}
        </span>
        <span className={`text-xs ${cfg.color}`}>{cfg.label} {isActive && `(${progress}%)`}</span>
        <span className="text-xs text-gray-600">
          {conversion.targets.join(", ")}
        </span>
      </Link>
    );
  }

  return (
    <Link
      href={`/dashboard/conversions/${conversion.id}`}
      className="block bg-gray-900 border border-gray-800 rounded-xl p-4 hover:border-gray-700 transition-colors"
    >
      <div className="flex items-start justify-between mb-3">
        <div>
          <h3 className="font-medium text-white text-sm">{conversion.name}</h3>
          <p className="text-xs text-gray-500 mt-0.5">
            {conversion.sourceUrl ?? conversion.sourceType} ·{" "}
            {conversion.targets.join(", ")}
          </p>
        </div>
        <span
          className={`flex items-center gap-1.5 text-xs font-medium ${cfg.color}`}
        >
          <span className={`w-1.5 h-1.5 rounded-full ${cfg.dot}`} />
          {cfg.label}
        </span>
      </div>

      {isActive && (
        <div className="space-y-1.5">
          <div className="h-1.5 bg-gray-800 rounded-full overflow-hidden">
            <div
              className="h-full bg-indigo-500 rounded-full transition-all duration-700"
              style={{ width: `${progress}%` }}
            />
          </div>
          <div className="flex justify-between items-center text-[10px] text-gray-500 font-mono">
            <span>Progress</span>
            <span>{progress}%</span>
          </div>
        </div>
      )}

      {conversion.status === "failed" && conversion.errorMessage && (
        <p className="text-xs text-red-400 mt-2 truncate">
          {conversion.errorMessage}
        </p>
      )}

      {conversion.status === "done" && conversion.durationMs && (
        <p className="text-xs text-gray-500 mt-2">
          Completed in {(conversion.durationMs / 1000).toFixed(0)}s
        </p>
      )}
    </Link>
  );
}
