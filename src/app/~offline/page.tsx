"use client";

import { WifiOff, RefreshCw } from "lucide-react";

export default function OfflinePage() {
  return (
    <div className="min-h-screen bg-cream-100 flex items-center justify-center p-6">
      <div className="text-center max-w-sm">
        <div className="w-16 h-16 rounded-2xl bg-cream-200 flex items-center justify-center mx-auto mb-6">
          <WifiOff className="w-8 h-8 text-warm-400" />
        </div>
        <h1 className="font-serif text-2xl text-warm-700 mb-2">
          You&apos;re Offline
        </h1>
        <p className="text-warm-400 text-sm mb-8">
          It looks like you&apos;ve lost your internet connection. Check your
          connection and try again.
        </p>
        <button
          onClick={() => window.location.reload()}
          className="inline-flex items-center gap-2 px-6 py-3 bg-amber text-white rounded-xl font-medium text-sm shadow-soft hover:bg-amber/90 transition-colors"
        >
          <RefreshCw className="w-4 h-4" />
          Try Again
        </button>
      </div>
    </div>
  );
}
