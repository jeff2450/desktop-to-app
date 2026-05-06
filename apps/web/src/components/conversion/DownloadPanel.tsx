"use client";

import { useState } from "react";
import { downloadsApi } from "../../lib/api-client";

interface Props {
  conversionId: string;
  installerSize?: number;
}

export function DownloadPanel({ conversionId, installerSize }: Props) {
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");

  async function handleDownload() {
    setLoading(true);
    setError("");
    const result = await downloadsApi.getUrl(conversionId);
    setLoading(false);

    if (result.error) {
      setError(result.error);
      return;
    }

    // Open download URL
    if (result.data?.downloadUrl) window.open(result.data.downloadUrl, "_blank");
  }

  const sizeMb = installerSize ? (installerSize / 1024 / 1024).toFixed(0) : null;

  return (
    <div className="bg-green-900/20 border border-green-700/50 rounded-xl p-5">
      <div className="flex items-center gap-3 mb-4">
        <div className="w-10 h-10 rounded-lg bg-green-600/20 flex items-center justify-center text-green-400 text-xl">✓</div>
        <div>
          <h3 className="font-semibold text-white">Conversion complete</h3>
          <p className="text-sm text-gray-400">Your installer is ready to download</p>
        </div>
      </div>

      {error && (
        <p className="text-sm text-red-400 mb-3">{error}</p>
      )}

      <button
        onClick={handleDownload}
        disabled={loading}
        className="flex items-center gap-2 px-4 py-2.5 bg-green-600 hover:bg-green-500 disabled:opacity-50 text-white font-medium rounded-lg text-sm transition-colors"
      >
        <span>↓</span>
        {loading ? "Generating link…" : `Download installer${sizeMb ? ` (${sizeMb}MB)` : ""}`}
      </button>

      <p className="text-xs text-gray-600 mt-3">
        Download link expires in 1 hour. Return here to generate a new one.
      </p>
    </div>
  );
}
