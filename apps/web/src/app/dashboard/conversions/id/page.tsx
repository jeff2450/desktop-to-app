"use client";

import { useEffect, useState } from "react";
import { useParams } from "next/navigation";
import { conversionsApi } from "../../../../lib/api-client";
import type { Conversion } from "../../../../types";
import { Sidebar } from "../../../../components/layout/Sidebar";
import { TopBar } from "../../../../components/layout/TopBar";
import { ConversionLog } from "../../../../components/conversion/ConversionLog";
import { DownloadPanel } from "../../../../components/conversion/DownloadPanel";
import { JobStatusCard } from "../../../../components/conversion/JobStatusCard";
import { useConversionJob } from "../../../../hooks/useConversionJob";

export default function ConversionDetailPage() {
  const params = useParams();
  const id = params?.["id"] as string;

  const [conversion, setConversion] = useState<Conversion | null>(null);
  const [loading, setLoading] = useState(true);

  const job = useConversionJob(conversion?.jobId ?? null);

  useEffect(() => {
    if (!id) return;
    conversionsApi.get(id).then((r) => {
      if (r.data) setConversion(r.data);
      setLoading(false);
    });
  }, [id]);

  // Merge live status from SSE into conversion
  const liveStatus = job.status ?? conversion?.status;

  if (loading) {
    return (
      <div className="flex h-full">
        <Sidebar />
        <div className="flex-1 ml-60 flex items-center justify-center">
          <p className="text-gray-600">Loading…</p>
        </div>
      </div>
    );
  }

  if (!conversion) {
    return (
      <div className="flex h-full">
        <Sidebar />
        <div className="flex-1 ml-60 flex items-center justify-center">
          <p className="text-gray-500">Conversion not found.</p>
        </div>
      </div>
    );
  }

  return (
    <div className="flex h-full">
      <Sidebar />
      <div className="flex-1 ml-60 min-h-screen">
        <TopBar title={conversion.name} />
        <div className="p-6 max-w-3xl space-y-5">

          {/* Status card */}
          <JobStatusCard conversion={{ ...conversion, status: liveStatus ?? conversion.status }} />

          {/* Detection result */}
          {conversion.detectionResult && (
            <div className="bg-gray-900 border border-gray-800 rounded-xl p-4">
              <h3 className="text-xs font-medium text-gray-500 uppercase tracking-wider mb-3">Detection</h3>
              <div className="grid grid-cols-2 gap-2 text-sm">
                {[
                  ["Framework", conversion.detectionResult.framework],
                  ["Backend",   conversion.detectionResult.backend],
                  ["Auth",      conversion.detectionResult.auth],
                  ["Tables",    conversion.detectionResult.tables.join(", ") || "none"],
                  ["Confidence", `${(conversion.detectionResult.confidence * 100).toFixed(0)}%`],
                  ["Targets",   conversion.targets.join(", ")],
                ].map(([k, v]) => (
                  <div key={k} className="flex gap-2">
                    <span className="text-gray-500 w-24 flex-shrink-0">{k}</span>
                    <span className="text-gray-200">{v}</span>
                  </div>
                ))}
              </div>
            </div>
          )}

          {/* Live log */}
          {liveStatus && !["done","failed","cancelled"].includes(liveStatus) && (
            <ConversionLog logs={job.logs} isConnected={job.isConnected} />
          )}

          {/* Download */}
          {liveStatus === "done" && (
            <DownloadPanel conversionId={conversion.id} installerSize={conversion.installerSize} />
          )}

          {/* Error */}
          {liveStatus === "failed" && (
            <div className="bg-red-900/20 border border-red-700/50 rounded-xl p-5">
              <h3 className="font-semibold text-white mb-2">Conversion failed</h3>
              <p className="text-sm text-red-300 font-mono">{job.error ?? conversion.errorMessage}</p>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
