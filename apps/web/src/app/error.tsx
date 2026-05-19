"use client";

import { useEffect } from "react";

export default function Error({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  useEffect(() => {
    console.error("PAGE ERROR BOUNDARY CAUGHT ERROR:", error);
  }, [error]);

  return (
    <div className="p-8 text-white bg-red-900 min-h-screen">
      <h2 className="text-2xl font-bold">Something went wrong!</h2>
      <pre className="mt-4 p-4 bg-black/50 overflow-auto">{error.stack || error.message}</pre>
      <button
        onClick={() => reset()}
        className="mt-4 px-4 py-2 bg-white text-black rounded"
      >
        Try again
      </button>
    </div>
  );
}
