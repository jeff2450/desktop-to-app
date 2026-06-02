"use client";

import { useEffect, useRef, useState } from "react";

const LINES = [
  { text: "$ npx webtoapp convert",              color: "text-zinc-400",  delay: 0    },
  { text: "✔ Stack detected: React + Supabase",  color: "text-zinc-300",  delay: 600  },
  { text: "✔ Planning Electron wrapper...", color: "text-zinc-300", delay: 1300 },
  { text: "✔ Preserving cloud backend config...", color: "text-zinc-300",  delay: 2100 },
  { text: "⚙ Building for Windows...",           color: "text-cyan-400",  delay: 3000 },
  { text: "  [vite] bundle generated in 1250ms", color: "text-zinc-500",  delay: 3800 },
  { text: "  [electron-builder] creating setup.exe", color: "text-zinc-500", delay: 4400 },
  { text: "✨ Success! webtoapp_setup.exe ready.", color: "text-green-400 font-bold", delay: 5200 },
];

const RESTART_DELAY = 8000; // ms after last line before looping

function runAnimation(setVisibleCount: (n: number) => void): () => void {
  const timers: ReturnType<typeof setTimeout>[] = [];

  LINES.forEach((line, i) => {
    timers.push(
      setTimeout(() => setVisibleCount(i + 1), line.delay)
    );
  });

  return () => timers.forEach(clearTimeout);
}

export function TerminalAnimation() {
  const [visibleCount, setVisibleCount] = useState(0);
  const [showCursor, setShowCursor]     = useState(true);
  const cleanupRef = useRef<(() => void) | null>(null);

  // Run the initial animation on mount
  useEffect(() => {
    cleanupRef.current = runAnimation(setVisibleCount);
    return () => cleanupRef.current?.();
  }, []);

  // When the last line appears, schedule a restart
  useEffect(() => {
    if (visibleCount < LINES.length) return;

    const restartTimer = setTimeout(() => {
      // Clear any lingering timers
      cleanupRef.current?.();
      // Reset to empty
      setVisibleCount(0);
      // Small delay so the reset renders before re-animating
      const startTimer = setTimeout(() => {
        cleanupRef.current = runAnimation(setVisibleCount);
      }, 120);
      return () => clearTimeout(startTimer);
    }, RESTART_DELAY);

    return () => clearTimeout(restartTimer);
  }, [visibleCount]);

  // Blinking cursor
  useEffect(() => {
    const id = setInterval(() => setShowCursor((v) => !v), 530);
    return () => clearInterval(id);
  }, []);

  return (
    <div className="p-6 font-mono text-sm leading-relaxed h-[280px] overflow-hidden relative">
      {LINES.map((line, i) => (
        <div
          key={i}
          className={[
            line.color,
            "transition-all duration-300",
            i < visibleCount ? "opacity-100 translate-y-0" : "opacity-0 translate-y-2",
            i === 4 || i === 7 ? "mt-4" : "mt-1",
          ].join(" ")}
        >
          {line.text}

          {/* blinking cursor on the most-recently revealed line */}
          {i === visibleCount - 1 && visibleCount < LINES.length && (
            <span
              className={[
                "inline-block w-2 h-4 bg-indigo-400 ml-1 align-middle transition-opacity duration-100",
                showCursor ? "opacity-100" : "opacity-0",
              ].join(" ")}
            />
          )}
        </div>
      ))}

      {/* Idle prompt after all lines */}
      {visibleCount >= LINES.length && (
        <div className="mt-3 text-zinc-500">
          ${" "}
          <span
            className={[
              "inline-block w-2 h-4 bg-zinc-400 ml-0.5 align-middle transition-opacity duration-100",
              showCursor ? "opacity-100" : "opacity-0",
            ].join(" ")}
          />
        </div>
      )}
    </div>
  );
}
