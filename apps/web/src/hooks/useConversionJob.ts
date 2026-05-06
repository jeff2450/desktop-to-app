"use client";

import { useEffect, useRef, useState, useCallback } from "react";
import type { SseEvent, ConversionStatus } from "../types";
import { getToken } from "../lib/auth";

const API_BASE = process.env["NEXT_PUBLIC_API_URL"] ?? "http://localhost:3000";

export interface JobState {
  status: ConversionStatus | null;
  logs: Array<{ stage: string; message: string; ts: number }>;
  installerUrl: string | null;
  error: string | null;
  isConnected: boolean;
}

/**
 * Hook that opens an SSE connection to /api/conversions/:id/logs
 * and maintains live job state (status, logs, installer URL).
 *
 * Automatically reconnects on disconnect (up to 5 attempts).
 * Stops connecting once the job reaches a terminal state (done/failed/cancelled).
 */
export function useConversionJob(conversionId: string | null): JobState {
  const [state, setState] = useState<JobState>({
    status: null,
    logs: [],
    installerUrl: null,
    error: null,
    isConnected: false,
  });

  const esRef = useRef<EventSource | null>(null);
  const reconnectRef = useRef(0);
  const maxReconnects = 5;

  const isTerminal = (status: ConversionStatus | null) =>
    status === "done" || status === "failed" || status === "cancelled";

  const connect = useCallback(() => {
    if (!conversionId) return;

    const token = getToken();
    const url = `${API_BASE}/api/conversions/${conversionId}/logs${token ? `?token=${token}` : ""}`;

    const es = new EventSource(url);
    esRef.current = es;

    es.onopen = () => {
      setState((s) => ({ ...s, isConnected: true }));
      reconnectRef.current = 0;
    };

    es.onmessage = (e: MessageEvent<string>) => {
      const event = JSON.parse(e.data) as SseEvent;

      if (event.type === "ping") return;

      setState((s) => {
        const next = { ...s };

        if (event.type === "status" && event.status) {
          next.status = event.status;
        }

        if (event.type === "log" && event.message) {
          next.logs = [
            ...s.logs,
            { stage: event.stage ?? "", message: event.message, ts: Date.now() },
          ].slice(-500); // keep last 500 lines
        }

        if (event.type === "completed") {
          next.status = "done";
          next.installerUrl = event.installerUrl ?? null;
          es.close();
          next.isConnected = false;
        }

        if (event.type === "failed") {
          next.status = "failed";
          next.error = event.error ?? "Conversion failed";
          es.close();
          next.isConnected = false;
        }

        return next;
      });
    };

    es.onerror = () => {
      es.close();
      setState((s) => ({ ...s, isConnected: false }));

      // Reconnect with backoff unless terminal
      setState((s) => {
        if (!isTerminal(s.status) && reconnectRef.current < maxReconnects) {
          const delay = Math.min(1000 * 2 ** reconnectRef.current, 30_000);
          reconnectRef.current++;
          setTimeout(connect, delay);
        }
        return s;
      });
    };
  }, [conversionId]);

  useEffect(() => {
    if (!conversionId) return;
    connect();
    return () => {
      esRef.current?.close();
    };
  }, [conversionId, connect]);

  return state;
}
