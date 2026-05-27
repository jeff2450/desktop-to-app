"use client";

import { useEffect, useRef } from "react";

interface LogLine {
  stage: string;
  message: string;
  ts: number;
}

const STAGE_COLORS: Record<string, string> = {
  "01-detect":    "text-blue-400",
  "02-plan":      "text-cyan-400",
  "03-transform": "text-yellow-400",
  "04-scaffold":  "text-orange-400",
  "05-install":   "text-purple-400",
  "06-build":     "text-pink-400",
  "07-package":   "text-green-400",
  // Worker bracket-tag variants
  "DETECTOR":   "text-blue-400",
  "TRANSFORM":  "text-yellow-400",
  "SCAFFOLD":   "text-orange-400",
  "BUILD":      "text-pink-400",
  "PACKAGE":    "text-green-400",
};

/**
 * Parse a raw log string like:
 *   "[2024-01-01T00:00:00.000Z] [06-build] Running vite build…"
 *   "[2024-01-01T00:00:00.000Z] ▶ Starting build for platform: linux"
 * into a { stage, message, ts } object.
 */
function parseRawLine(raw: string): LogLine {
  // Match leading ISO timestamp
  const tsMatch = raw.match(/^\[(\d{4}-[^\]]+)\]\s*/);
  const ts = tsMatch ? new Date(tsMatch[1]!).getTime() : Date.now();
  const rest = tsMatch ? raw.slice(tsMatch[0].length) : raw;

  // Match optional stage bracket [stage-name] or [STAGE]
  const stageMatch = rest.match(/^\[([^\]]+)\]\s*/);
  const stage = stageMatch ? stageMatch[1]! : "";
  const message = stageMatch ? rest.slice(stageMatch[0].length) : rest;

  return { stage, message: message || rest, ts };
}

function normalizeLog(entry: string | LogLine): LogLine {
  if (typeof entry === "string") return parseRawLine(entry);
  return entry;
}

interface Props {
  logs: (string | LogLine)[];
  isConnected: boolean;
}

export function ConversionLog({ logs, isConnected }: Props) {
  const bottomRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [logs.length]);

  const normalized = logs.map(normalizeLog);

  return (
    <div className="bg-gray-950 border border-gray-800 rounded-xl overflow-hidden">
      <div className="flex items-center justify-between px-4 py-2.5 border-b border-gray-800">
        <span className="text-xs font-medium text-gray-400">Build log</span>
        <span className={`flex items-center gap-1.5 text-xs ${isConnected ? "text-green-400" : "text-gray-600"}`}>
          <span className={`w-1.5 h-1.5 rounded-full ${isConnected ? "bg-green-500 animate-pulse" : "bg-gray-600"}`} />
          {isConnected ? "Live" : "Disconnected"}
        </span>
      </div>
      <div className="h-72 overflow-y-auto font-mono text-xs p-4 space-y-0.5">
        {normalized.length === 0 ? (
          <p className="text-gray-600">Waiting for build output…</p>
        ) : (
          normalized.map((line, i) => (
            <div key={i} className="flex gap-3 leading-5">
              <span className={`flex-shrink-0 w-24 truncate ${STAGE_COLORS[line.stage] ?? "text-gray-500"}`}>
                {line.stage || "pipeline"}
              </span>
              <span className="text-gray-300 break-all">{line.message}</span>
            </div>
          ))
        )}
        <div ref={bottomRef} />
      </div>
    </div>
  );
}
