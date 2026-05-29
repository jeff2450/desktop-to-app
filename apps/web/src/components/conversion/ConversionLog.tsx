"use client";

import { useEffect, useRef, useState, useMemo } from "react";
import { Search, Copy, Check, Download, Maximize2, Minimize2, AlignLeft as AlignLeftIcon } from "lucide-react";

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
 * Regex to scrub ANSI escape codes.
 */
function stripAnsi(str: string): string {
  const ansiRegex = /[\u001b\u009b]\[[()#;?]*(?:[0-9]{1,4}(?:;[0-9]{0,4})*)?[0-9A-ORZcf-nqry=><]/g;
  return str.replace(ansiRegex, "");
}

/**
 * Parse a raw log string like:
 *   "[2024-01-01T00:00:00.000Z] [06-build] Running vite build…"
 *   "[2024-01-01T00:00:00.000Z] ▶ Starting build for platform: linux"
 * into a { stage, message, ts } object.
 */
function parseRawLine(raw: string): LogLine {
  const cleanRaw = stripAnsi(raw);

  // Match leading ISO timestamp
  const tsMatch = cleanRaw.match(/^\[(\d{4}-[^\]]+)\]\s*/);
  const ts = tsMatch ? new Date(tsMatch[1]!).getTime() : Date.now();
  const rest = tsMatch ? cleanRaw.slice(tsMatch[0].length) : cleanRaw;

  // Match optional stage bracket [stage-name] or [STAGE]
  const stageMatch = rest.match(/^\[([^\]]+)\]\s*/);
  const stage = stageMatch ? stageMatch[1]! : "";
  const message = stageMatch ? rest.slice(stageMatch[0].length) : rest;

  return { stage, message: message || rest, ts };
}

function normalizeLog(entry: string | LogLine): LogLine {
  if (typeof entry === "string") return parseRawLine(entry);
  return {
    stage: stripAnsi(entry.stage),
    message: stripAnsi(entry.message),
    ts: entry.ts,
  };
}

interface Props {
  logs: (string | LogLine)[];
  isConnected: boolean;
}

function HighlightText({ text, search }: { text: string; search: string }) {
  if (!search.trim()) return <>{text}</>;
  // Escape regex special characters
  const escapedSearch = search.replace(/[-/\\^$*+?.()|[\]{}]/g, "\\$&");
  const parts = text.split(new RegExp(`(${escapedSearch})`, "gi"));
  return (
    <>
      {parts.map((part, i) =>
        part.toLowerCase() === search.toLowerCase() ? (
          <mark key={i} className="bg-yellow-500/30 text-yellow-200 px-0.5 rounded font-medium">
            {part}
          </mark>
        ) : (
          part
        )
      )}
    </>
  );
}

export function ConversionLog({ logs, isConnected }: Props) {
  const bottomRef = useRef<HTMLDivElement>(null);
  const [searchQuery, setSearchQuery] = useState("");
  const [isExpanded, setIsExpanded] = useState(false);
  const [isWrapped, setIsWrapped] = useState(true);
  const [copySuccess, setCopySuccess] = useState(false);

  // Auto-scroll when new logs arrive, but only if they are not filtered
  useEffect(() => {
    if (!searchQuery) {
      bottomRef.current?.scrollIntoView({ behavior: "smooth" });
    }
  }, [logs.length, searchQuery]);

  const normalized = useMemo(() => logs.map(normalizeLog), [logs]);

  const filtered = useMemo(() => {
    if (!searchQuery.trim()) return normalized;
    const q = searchQuery.toLowerCase();
    return normalized.filter(
      (line) =>
        line.message.toLowerCase().includes(q) ||
        line.stage.toLowerCase().includes(q)
    );
  }, [normalized, searchQuery]);

  const getRawLogsText = () => {
    return normalized
      .map((line) => {
        const tsString = new Date(line.ts).toISOString();
        const stageString = line.stage ? ` [${line.stage}]` : "";
        return `[${tsString}]${stageString} ${line.message}`;
      })
      .join("\n");
  };

  const handleCopy = async () => {
    try {
      const text = getRawLogsText();
      await navigator.clipboard.writeText(text);
      setCopySuccess(true);
      setTimeout(() => setCopySuccess(false), 2000);
    } catch (err) {
      console.error("Failed to copy logs:", err);
    }
  };

  const handleDownload = () => {
    const text = getRawLogsText();
    const blob = new Blob([text], { type: "text/plain;charset=utf-8" });
    const url = URL.createObjectURL(blob);
    const link = document.createElement("a");
    link.href = url;
    link.download = `build-log-${Date.now()}.txt`;
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
    URL.revokeObjectURL(url);
  };

  return (
    <div className="bg-zinc-950 border border-zinc-800 rounded-xl overflow-hidden shadow-2xl flex flex-col transition-all duration-300">
      {/* Top Header Controls */}
      <div className="flex flex-wrap items-center justify-between gap-3 px-4 py-3 border-b border-zinc-800 bg-zinc-900/40 backdrop-blur-md">
        <div className="flex items-center gap-3">
          <span className="text-xs font-bold text-zinc-400 uppercase tracking-widest">Build log</span>
          <span
            className={`flex items-center gap-1.5 text-[10px] font-bold px-2 py-0.5 rounded-full border transition-all ${
              isConnected
                ? "text-emerald-400 bg-emerald-500/10 border-emerald-500/20"
                : "text-zinc-500 bg-zinc-900/50 border-zinc-800"
            }`}
          >
            <span
              className={`w-1.5 h-1.5 rounded-full transition-all ${
                isConnected ? "bg-emerald-500 animate-pulse" : "bg-zinc-600"
              }`}
            />
            {isConnected ? "Live" : "Offline"}
          </span>
        </div>

        {/* Action Toolbar */}
        <div className="flex items-center gap-2 flex-wrap">
          {/* Search bar */}
          <div className="relative flex items-center">
            <Search className="w-3.5 h-3.5 text-zinc-500 absolute left-2.5 pointer-events-none" />
            <input
              type="text"
              placeholder="Search / Filter..."
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              className="pl-8 pr-6 py-1 h-8 text-xs bg-zinc-900/80 border border-zinc-800 rounded-lg text-zinc-300 placeholder-zinc-500 focus:outline-none focus:border-indigo-500 focus:ring-1 focus:ring-indigo-500 w-36 sm:w-48 transition-all duration-200"
            />
            {searchQuery && (
              <button
                onClick={() => setSearchQuery("")}
                className="absolute right-2 text-zinc-500 hover:text-zinc-300 text-sm font-bold focus:outline-none"
              >
                ×
              </button>
            )}
          </div>

          {/* Wrap Toggle */}
          <button
            onClick={() => setIsWrapped(!isWrapped)}
            title={isWrapped ? "Disable Word Wrap" : "Enable Word Wrap"}
            className={`p-2 rounded-lg border text-zinc-400 hover:text-white hover:border-zinc-700 transition-all duration-150 h-8 flex items-center gap-1.5 text-[10px] font-bold ${
              isWrapped ? "bg-indigo-500/10 border-indigo-500/30 text-indigo-400" : "bg-zinc-900/50 border-zinc-800"
            }`}
          >
            <AlignLeftIcon className="w-3.5 h-3.5" />
            <span className="hidden sm:inline">Wrap</span>
          </button>

          {/* Height Expand Toggle */}
          <button
            onClick={() => setIsExpanded(!isExpanded)}
            title={isExpanded ? "Collapse height" : "Expand height"}
            className="p-2 bg-zinc-900/50 border border-zinc-800 rounded-lg text-zinc-400 hover:text-white hover:border-zinc-700 transition-all duration-150 h-8 flex items-center gap-1.5 text-[10px] font-bold"
          >
            {isExpanded ? <Minimize2 className="w-3.5 h-3.5" /> : <Maximize2 className="w-3.5 h-3.5" />}
            <span className="hidden sm:inline">{isExpanded ? "Collapse" : "Expand"}</span>
          </button>

          {/* Copy Button */}
          <button
            onClick={handleCopy}
            title="Copy all logs"
            className="p-2 bg-zinc-900/50 border border-zinc-800 rounded-lg text-zinc-400 hover:text-white hover:border-zinc-700 transition-all duration-150 h-8 flex items-center gap-1.5 text-[10px] font-bold"
          >
            {copySuccess ? <Check className="w-3.5 h-3.5 text-emerald-400" /> : <Copy className="w-3.5 h-3.5" />}
            <span className="hidden sm:inline">{copySuccess ? "Copied" : "Copy"}</span>
          </button>

          {/* Download Button */}
          <button
            onClick={handleDownload}
            title="Download log file"
            className="p-2 bg-zinc-900/50 border border-zinc-800 rounded-lg text-zinc-400 hover:text-white hover:border-zinc-700 transition-all duration-150 h-8 flex items-center gap-1.5 text-[10px] font-bold"
          >
            <Download className="w-3.5 h-3.5" />
            <span className="hidden sm:inline">Download</span>
          </button>
        </div>
      </div>

      {/* Logs View Panel */}
      <div
        className={`overflow-y-auto font-mono text-[11px] p-4 space-y-1 bg-zinc-950/90 transition-all duration-300 ${
          isExpanded ? "h-[550px]" : "h-80"
        }`}
      >
        {filtered.length === 0 ? (
          <div className="flex flex-col items-center justify-center h-full text-zinc-500 py-12">
            {searchQuery ? (
              <>
                <p className="font-semibold text-zinc-400">No logs match your filter: "{searchQuery}"</p>
                <button
                  onClick={() => setSearchQuery("")}
                  className="mt-2 text-indigo-400 hover:text-indigo-300 font-medium underline text-xs transition-colors"
                >
                  Clear filter
                </button>
              </>
            ) : (
              <p className="animate-pulse">Waiting for build output…</p>
            )}
          </div>
        ) : (
          <>
            {searchQuery && (
              <div className="text-[10px] text-zinc-500 pb-2 border-b border-zinc-900/80 mb-3 flex justify-between items-center">
                <span>
                  Showing <strong>{filtered.length}</strong> of <strong>{normalized.length}</strong> lines matching filter
                </span>
                <button
                  onClick={() => setSearchQuery("")}
                  className="text-zinc-400 hover:text-zinc-200 transition-colors"
                >
                  Clear
                </button>
              </div>
            )}
            {filtered.map((line, i) => (
              <div
                key={i}
                className={`flex gap-3 leading-5 py-0.5 hover:bg-zinc-900/30 rounded transition-colors px-1.5 ${
                  isWrapped ? "flex-col sm:flex-row" : "flex-row"
                }`}
              >
                {/* Stage tag */}
                <span className={`flex-shrink-0 w-24 truncate font-bold select-none ${STAGE_COLORS[line.stage] ?? "text-zinc-500"}`}>
                  {line.stage || "pipeline"}
                </span>

                {/* Log message */}
                <span
                  className={`text-zinc-300 flex-1 ${
                    isWrapped ? "whitespace-pre-wrap break-all" : "whitespace-pre break-normal overflow-x-auto"
                  }`}
                >
                  <HighlightText text={line.message} search={searchQuery} />
                </span>
              </div>
            ))}
          </>
        )}
        <div ref={bottomRef} />
      </div>
    </div>
  );
}
