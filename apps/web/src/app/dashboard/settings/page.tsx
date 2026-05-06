"use client";

import { useEffect, useState, FormEvent } from "react";
import { authApi } from "../../../lib/api-client";
import type { User } from "../../../types";
import { Sidebar } from "../../../components/layout/Sidebar";
import { TopBar } from "../../../components/layout/TopBar";

const API_BASE = process.env["NEXT_PUBLIC_API_URL"] ?? "http://localhost:3000";

export default function SettingsPage() {
  const [user, setUser] = useState<User | null>(null);
  const [name, setName] = useState("");
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);
  const [apiKeys, setApiKeys] = useState<Array<{ id: string; name: string; keyPrefix: string; createdAt: string }>>([]);
  const [newKeyName, setNewKeyName] = useState("");
  const [newKey, setNewKey] = useState<string | null>(null);
  const [keyLoading, setKeyLoading] = useState(false);

  useEffect(() => {
    authApi.me().then((r) => {
      if (r.data) { setUser(r.data); setName(r.data.name ?? ""); }
    });
    fetchKeys();
  }, []);

  async function fetchKeys() {
    const { authHeaders } = await import("../../../lib/auth");
    const res = await fetch(`${API_BASE}/api/users/keys`, { headers: authHeaders() });
    const json = await res.json() as { data?: typeof apiKeys };
    if (json.data) setApiKeys(json.data);
  }

  async function handleSave(e: FormEvent) {
    e.preventDefault();
    setSaving(true);
    const { authHeaders } = await import("../../../lib/auth");
    await fetch(`${API_BASE}/api/users/me`, {
      method: "PUT",
      headers: { "Content-Type": "application/json", ...authHeaders() },
      body: JSON.stringify({ name }),
    });
    setSaving(false);
    setSaved(true);
    setTimeout(() => setSaved(false), 2000);
  }

  async function createKey() {
    if (!newKeyName.trim()) return;
    setKeyLoading(true);
    const { authHeaders } = await import("../../../lib/auth");
    const res = await fetch(`${API_BASE}/api/users/keys`, {
      method: "POST",
      headers: { "Content-Type": "application/json", ...authHeaders() },
      body: JSON.stringify({ name: newKeyName }),
    });
    const json = await res.json() as { data?: { key: string } };
    setKeyLoading(false);
    if (json.data?.key) {
      setNewKey(json.data.key);
      setNewKeyName("");
      fetchKeys();
    }
  }

  async function deleteKey(id: string) {
    const { authHeaders } = await import("../../../lib/auth");
    await fetch(`${API_BASE}/api/users/keys/${id}`, { method: "DELETE", headers: authHeaders() });
    setApiKeys((prev) => prev.filter((k) => k.id !== id));
  }

  return (
    <div className="flex h-full">
      <Sidebar userEmail={user?.email} />
      <div className="flex-1 ml-60 min-h-screen">
        <TopBar title="Settings" />
        <div className="p-6 max-w-2xl space-y-8">

          {/* Profile */}
          <section className="bg-gray-900 border border-gray-800 rounded-xl p-5">
            <h2 className="font-semibold text-white mb-4">Profile</h2>
            <form onSubmit={handleSave} className="space-y-4">
              <div>
                <label className="block text-sm font-medium text-gray-300 mb-1">Email</label>
                <input
                  value={user?.email ?? ""}
                  disabled
                  className="w-full px-3 py-2 bg-gray-800 border border-gray-700 rounded-lg text-gray-500 text-sm cursor-not-allowed"
                />
              </div>
              <div>
                <label className="block text-sm font-medium text-gray-300 mb-1">Display name</label>
                <input
                  value={name}
                  onChange={(e) => setName(e.target.value)}
                  placeholder="Your name"
                  className="w-full px-3 py-2 bg-gray-800 border border-gray-700 rounded-lg text-white placeholder-gray-600 focus:outline-none focus:border-indigo-500 text-sm"
                />
              </div>
              <button
                type="submit"
                disabled={saving}
                className="px-4 py-2 bg-indigo-600 hover:bg-indigo-500 disabled:opacity-50 text-white text-sm font-medium rounded-lg transition-colors"
              >
                {saved ? "Saved ✓" : saving ? "Saving…" : "Save changes"}
              </button>
            </form>
          </section>

          {/* API Keys */}
          <section className="bg-gray-900 border border-gray-800 rounded-xl p-5">
            <h2 className="font-semibold text-white mb-1">API Keys</h2>
            <p className="text-sm text-gray-500 mb-4">Used by the CLI to authenticate. Keys are shown only once.</p>

            {newKey && (
              <div className="bg-green-900/20 border border-green-700/50 rounded-lg p-4 mb-4">
                <p className="text-xs text-green-400 mb-1 font-medium">Copy this key — it won't be shown again.</p>
                <code className="text-sm text-green-300 break-all">{newKey}</code>
                <button
                  onClick={() => { navigator.clipboard.writeText(newKey); }}
                  className="mt-2 text-xs text-green-500 hover:text-green-400 block"
                >
                  Copy to clipboard
                </button>
              </div>
            )}

            <div className="space-y-2 mb-4">
              {apiKeys.map((k) => (
                <div key={k.id} className="flex items-center justify-between py-2.5 px-3 bg-gray-800 rounded-lg">
                  <div>
                    <span className="text-sm text-white">{k.name}</span>
                    <span className="text-xs text-gray-500 ml-2 font-mono">{k.keyPrefix}</span>
                  </div>
                  <button
                    onClick={() => deleteKey(k.id)}
                    className="text-xs text-red-400 hover:text-red-300 transition-colors"
                  >
                    Revoke
                  </button>
                </div>
              ))}
              {apiKeys.length === 0 && (
                <p className="text-sm text-gray-600 py-2">No API keys yet.</p>
              )}
            </div>

            <div className="flex gap-2">
              <input
                value={newKeyName}
                onChange={(e) => setNewKeyName(e.target.value)}
                placeholder="Key name (e.g. My Laptop)"
                className="flex-1 px-3 py-2 bg-gray-800 border border-gray-700 rounded-lg text-white placeholder-gray-600 focus:outline-none focus:border-indigo-500 text-sm"
              />
              <button
                onClick={createKey}
                disabled={keyLoading || !newKeyName.trim()}
                className="px-4 py-2 bg-indigo-600 hover:bg-indigo-500 disabled:opacity-50 text-white text-sm font-medium rounded-lg transition-colors"
              >
                {keyLoading ? "Creating…" : "Create key"}
              </button>
            </div>
          </section>
        </div>
      </div>
    </div>
  );
}
