"use client";

import { useState, FormEvent } from "react";
import { useRouter } from "next/navigation";
import { conversionsApi } from "../../lib/api-client";

const DESKTOP_TARGETS = [
  { id: "windows", label: "Windows", icon: "⊞", ext: ".exe" },
  { id: "linux",   label: "Linux",   icon: "🐧", ext: ".AppImage" },
  { id: "mac",     label: "macOS",   icon: "🍎", ext: ".dmg" },
];

const MOBILE_TARGETS = [
  { id: "android", label: "Android", icon: "🤖", ext: ".apk" },
  { id: "ios",     label: "iOS",     icon: "📱", ext: ".ipa" },
];

export function ConversionWizard() {
  const router = useRouter();
  const [name, setName] = useState("");
  const [sourceUrl, setSourceUrl] = useState("");
  const [targets, setTargets] = useState<string[]>(["windows", "linux"]);
  const [appId, setAppId] = useState("");
  const [version, setVersion] = useState("1.0.0");
  const [mode, setMode] = useState<"offline" | "online" | "hybrid">("offline");
  const [androidVariant, setAndroidVariant] = useState<"debug" | "release">("debug");
  const [iosTeamId, setIosTeamId] = useState("");
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);

  const hasMobile = targets.some((t) => t === "android" || t === "ios");
  const hasIos = targets.includes("ios");

  function toggleTarget(id: string) {
    setTargets((prev) =>
      prev.includes(id) ? prev.filter((t) => t !== id) : [...prev, id]
    );
  }

  // Auto-fill name from GitHub URL
  function handleUrlChange(url: string) {
    setSourceUrl(url);
    if (!name && url.includes("github.com")) {
      const parts = url.split("/");
      const repo = parts[parts.length - 1]?.replace(/\.git$/, "");
      if (repo) {
        setName(repo.replace(/-/g, " ").replace(/\b\w/g, (c) => c.toUpperCase()));
        setAppId(`com.github.${repo.toLowerCase()}`);
      }
    }
  }

  async function handleSubmit(e: FormEvent) {
    e.preventDefault();
    setError("");

    if (targets.length === 0) {
      setError("Select at least one target platform.");
      return;
    }

    setLoading(true);
    const result = await conversionsApi.create({
      name,
      sourceUrl,
      sourceType: "github",
      targets,
      appId: appId || `com.webtoapp.${name.toLowerCase().replace(/\s+/g, "")}`,
      version,
      mode,
      ...(hasMobile && {
        mobile: {
          ...(targets.includes("android") && {
            android: { buildVariant: androidVariant },
          }),
          ...(hasIos && iosTeamId && {
            ios: { developmentTeam: iosTeamId },
          }),
        },
      }),
    });
    setLoading(false);

    if (result.error) {
      setError(result.error);
      return;
    }

    router.push(`/dashboard/conversions/${result.data?.id}`);
  }

  return (
    <form onSubmit={handleSubmit} className="max-w-xl space-y-6">
      {error && (
        <div className="bg-red-900/40 border border-red-700 text-red-300 px-4 py-3 rounded-lg text-sm">
          {error}
        </div>
      )}

      {/* GitHub URL */}
      <div>
        <label className="block text-sm font-medium text-gray-300 mb-1.5">
          GitHub repository URL <span className="text-red-400">*</span>
        </label>
        <input
          type="url"
          required
          value={sourceUrl}
          onChange={(e) => handleUrlChange(e.target.value)}
          placeholder="https://github.com/your-org/your-app"
          className="w-full px-3 py-2.5 bg-gray-900 border border-gray-700 rounded-lg text-white placeholder-gray-600 focus:outline-none focus:border-indigo-500 text-sm"
        />
        <p className="text-xs text-gray-600 mt-1">Must be a public repo, or add a GitHub token in settings for private repos.</p>
      </div>

      {/* App name */}
      <div>
        <label className="block text-sm font-medium text-gray-300 mb-1.5">App name <span className="text-red-400">*</span></label>
        <input
          type="text"
          required
          value={name}
          onChange={(e) => setName(e.target.value)}
          placeholder="My Awesome App"
          className="w-full px-3 py-2.5 bg-gray-900 border border-gray-700 rounded-lg text-white placeholder-gray-600 focus:outline-none focus:border-indigo-500 text-sm"
        />
      </div>

      {/* Version + App ID */}
      <div className="grid grid-cols-2 gap-4">
        <div>
          <label className="block text-sm font-medium text-gray-300 mb-1.5">Version</label>
          <input
            type="text"
            value={version}
            onChange={(e) => setVersion(e.target.value)}
            placeholder="1.0.0"
            className="w-full px-3 py-2.5 bg-gray-900 border border-gray-700 rounded-lg text-white placeholder-gray-600 focus:outline-none focus:border-indigo-500 text-sm"
          />
        </div>
        <div>
          <label className="block text-sm font-medium text-gray-300 mb-1.5">App ID</label>
          <input
            type="text"
            value={appId}
            onChange={(e) => setAppId(e.target.value)}
            placeholder="com.example.myapp"
            className="w-full px-3 py-2.5 bg-gray-900 border border-gray-700 rounded-lg text-white placeholder-gray-600 focus:outline-none focus:border-indigo-500 text-sm"
          />
        </div>
      </div>


      {/* Mode selector */}
      <div>
        <label className="block text-sm font-medium text-gray-300 mb-2">Connectivity mode</label>
        <div className="grid grid-cols-3 gap-3">
          {([
            { id: "offline", label: "Offline", icon: "📴", desc: "Works without internet. All data stored locally." },
            { id: "online",  label: "Online",  icon: "🌐", desc: "Requires internet. Cloud backend untouched." },
            { id: "hybrid",  label: "Hybrid",  icon: "⚡", desc: "Works offline, syncs to cloud when online." },
          ] as const).map(({ id, label, icon, desc }) => (
            <button
              key={id}
              type="button"
              onClick={() => setMode(id)}
              className={`flex flex-col items-center gap-1 py-3 px-2 rounded-lg border text-center transition-colors ${
                mode === id
                  ? "border-indigo-500 bg-indigo-600/20 text-indigo-300"
                  : "border-gray-700 bg-gray-900 text-gray-400 hover:border-gray-600"
              }`}
            >
              <span className="text-xl">{icon}</span>
              <span className="font-medium text-sm">{label}</span>
              <span className="text-xs opacity-60 leading-tight">{desc}</span>
            </button>
          ))}
        </div>
        {mode === "hybrid" && (
          <p className="text-xs text-yellow-400/80 mt-2">
            ⚡ Hybrid mode keeps your Supabase/Firebase account active for cloud sync.
          </p>
        )}
        {mode === "online" && (
          <p className="text-xs text-blue-400/80 mt-2">
            🌐 Online mode requires internet — no code transformation happens.
          </p>
        )}
      </div>

      {/* Targets */}
      <div>
        <label className="block text-sm font-medium text-gray-300 mb-2">Target platforms</label>

        {/* Desktop */}
        <p className="text-xs text-gray-500 mb-1.5 uppercase tracking-wide">Desktop</p>
        <div className="flex gap-3 mb-3">
          {DESKTOP_TARGETS.map(({ id, label, icon, ext }) => (
            <button
              key={id}
              type="button"
              onClick={() => toggleTarget(id)}
              className={`flex-1 flex flex-col items-center gap-1.5 py-3 rounded-lg border text-sm transition-colors ${
                targets.includes(id)
                  ? "border-indigo-500 bg-indigo-600/20 text-indigo-300"
                  : "border-gray-700 bg-gray-900 text-gray-400 hover:border-gray-600"
              }`}
            >
              <span className="text-xl">{icon}</span>
              <span className="font-medium">{label}</span>
              <span className="text-xs opacity-60">{ext}</span>
            </button>
          ))}
        </div>

        {/* Mobile */}
        <p className="text-xs text-gray-500 mb-1.5 uppercase tracking-wide">Mobile</p>
        <div className="flex gap-3">
          {MOBILE_TARGETS.map(({ id, label, icon, ext }) => (
            <button
              key={id}
              type="button"
              onClick={() => toggleTarget(id)}
              className={`flex-1 flex flex-col items-center gap-1.5 py-3 rounded-lg border text-sm transition-colors ${
                targets.includes(id)
                  ? "border-green-500 bg-green-600/20 text-green-300"
                  : "border-gray-700 bg-gray-900 text-gray-400 hover:border-gray-600"
              }`}
            >
              <span className="text-xl">{icon}</span>
              <span className="font-medium">{label}</span>
              <span className="text-xs opacity-60">{ext}</span>
            </button>
          ))}
        </div>

        {/* Mobile requirement notices */}
        {targets.includes("android") && (
          <p className="text-xs text-yellow-400/80 mt-2">
            🤖 Android requires Java JDK 17+ and Android Studio (ANDROID_HOME set).
          </p>
        )}
        {targets.includes("ios") && (
          <p className="text-xs text-blue-400/80 mt-2">
            📱 iOS requires macOS with Xcode and CocoaPods installed.
          </p>
        )}
      </div>

      {/* Mobile-specific options (shown only when a mobile target is selected) */}
      {hasMobile && (
        <div className="rounded-lg border border-gray-700 bg-gray-900/60 p-4 space-y-4">
          <p className="text-sm font-medium text-gray-300">Mobile options</p>

          {targets.includes("android") && (
            <div>
              <label className="block text-xs text-gray-400 mb-1.5">Android build variant</label>
              <div className="flex gap-3">
                {(["debug", "release"] as const).map((v) => (
                  <button
                    key={v}
                    type="button"
                    onClick={() => setAndroidVariant(v)}
                    className={`flex-1 py-2 rounded-lg border text-sm font-medium transition-colors ${
                      androidVariant === v
                        ? "border-green-500 bg-green-600/20 text-green-300"
                        : "border-gray-700 text-gray-400 hover:border-gray-600"
                    }`}
                  >
                    {v === "debug" ? "🐛 Debug (.apk)" : "🚀 Release (.apk)"}
                  </button>
                ))}
              </div>
              {androidVariant === "release" && (
                <p className="text-xs text-yellow-400/80 mt-1.5">
                  Release builds require a keystore. You can sign manually after conversion.
                </p>
              )}
            </div>
          )}

          {hasIos && (
            <div>
              <label className="block text-xs text-gray-400 mb-1.5">
                Apple Development Team ID <span className="text-gray-600">(optional)</span>
              </label>
              <input
                type="text"
                value={iosTeamId}
                onChange={(e) => setIosTeamId(e.target.value)}
                placeholder="ABCD1234EF"
                className="w-full px-3 py-2 bg-gray-800 border border-gray-700 rounded-lg text-white placeholder-gray-600 focus:outline-none focus:border-indigo-500 text-sm font-mono"
              />
              <p className="text-xs text-gray-600 mt-1">
                Found in Xcode → Signing & Capabilities. Required for device deployment.
              </p>
            </div>
          )}
        </div>
      )}

      <button
        type="submit"
        disabled={loading || targets.length === 0}
        className="w-full py-3 bg-indigo-600 hover:bg-indigo-500 disabled:opacity-50 disabled:cursor-not-allowed text-white font-medium rounded-lg text-sm transition-colors"
      >
        {loading ? "Starting conversion…" : "Start conversion →"}
      </button>
    </form>
  );
}
