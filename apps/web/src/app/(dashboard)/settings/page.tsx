"use client";

import { useState, useEffect } from "react";
import { useRouter } from "next/navigation";
import { TopBar } from "@/components/layout/TopBar";
import { 
  Card, 
  CardContent, 
  CardHeader, 
  CardTitle, 
  CardDescription,
} from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { useAuthStore } from "@/stores/auth";
import { 
  User, 
  Lock, 
  Bell, 
  Shield, 
  Key,
  Trash2,
  Mail,
  Smartphone,
  CreditCard,
  Copy,
  Eye,
  EyeOff
} from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Tabs, TabsList, TabsTrigger, TabsContent } from "@/components/ui/tabs";
import { Checkbox } from "@/components/ui/checkbox";

const NOTIFICATION_OPTIONS = [
  { id: "build", label: "Build Completions", desc: "Notify me when a mobile or desktop build is finished." },
  { id: "errors", label: "Error Alerts", desc: "Critical alerts if a conversion fails processing." },
  { id: "billing", label: "Billing & Invoices", desc: "Monthly subscription and payment confirmations." },
  { id: "updates", label: "Product Updates", desc: "News about new templates and features." },
] as const;

type NotificationId = (typeof NOTIFICATION_OPTIONS)[number]["id"];
type NotificationPrefs = Record<NotificationId, boolean>;

const DEFAULT_NOTIFICATIONS: NotificationPrefs = {
  build: true,
  errors: true,
  billing: true,
  updates: true,
};

const AVATAR_COLORS = [
  "bg-indigo-500/20 border-indigo-500 text-indigo-400",
  "bg-cyan-500/20 border-cyan-500 text-cyan-400",
  "bg-emerald-500/20 border-emerald-500 text-emerald-400",
  "bg-amber-500/20 border-amber-500 text-amber-400",
];

export default function SettingsPage() {
  const router = useRouter();
  const { user, logout, updateUser } = useAuthStore();
  const [profile, setProfile] = useState({ name: "", email: "" });
  const [notice, setNotice] = useState<string | null>(null);
  const [avatarColorIndex, setAvatarColorIndex] = useState(0);
  const [showPasswordForm, setShowPasswordForm] = useState(false);
  const [showPassword, setShowPassword] = useState(false);
  const [passwordForm, setPasswordForm] = useState({ current: "", next: "", confirm: "" });
  const [twoFactorEnabled, setTwoFactorEnabled] = useState(false);
  const [apiKeys, setApiKeys] = useState<{ id: string; secret: string; createdAt: string }[]>([]);
  const [notifications, setNotifications] = useState<NotificationPrefs>(DEFAULT_NOTIFICATIONS);
  const [deleteConfirm, setDeleteConfirm] = useState("");

  const plan = user?.plan ?? "free";
  const canUseApiKeys = ["pro", "team", "enterprise"].includes(plan);

  useEffect(() => {
    if (user) {
      setProfile({ name: user.name || "", email: user.email || "" });
    }
  }, [user]);

  useEffect(() => {
    if (!user?.id) return;

    const stored = window.localStorage.getItem(`webtoapp-settings-${user.id}`);
    if (!stored) return;

    try {
      const parsed = JSON.parse(stored) as {
        avatarColorIndex?: number;
        twoFactorEnabled?: boolean;
        apiKeys?: { id: string; secret: string; createdAt: string }[];
        notifications?: Partial<NotificationPrefs>;
      };

      setAvatarColorIndex(parsed.avatarColorIndex ?? 0);
      setTwoFactorEnabled(Boolean(parsed.twoFactorEnabled));
      setApiKeys(parsed.apiKeys ?? []);
      setNotifications({ ...DEFAULT_NOTIFICATIONS, ...parsed.notifications });
    } catch {
      setNotifications(DEFAULT_NOTIFICATIONS);
    }
  }, [user?.id]);

  useEffect(() => {
    if (!user?.id) return;

    window.localStorage.setItem(
      `webtoapp-settings-${user.id}`,
      JSON.stringify({ avatarColorIndex, twoFactorEnabled, apiKeys, notifications })
    );
  }, [apiKeys, avatarColorIndex, notifications, twoFactorEnabled, user?.id]);

  function showNotice(message: string) {
    setNotice(message);
    window.setTimeout(() => setNotice(null), 3000);
  }

  function handleSaveProfile() {
    updateUser({ name: profile.name.trim() || null });
    showNotice("Profile updated.");
  }

  function handleChangePassword() {
    if (passwordForm.next.length < 8) {
      showNotice("New password must be at least 8 characters.");
      return;
    }

    if (passwordForm.next !== passwordForm.confirm) {
      showNotice("Password confirmation does not match.");
      return;
    }

    setPasswordForm({ current: "", next: "", confirm: "" });
    setShowPasswordForm(false);
    showNotice("Password change saved for this session.");
  }

  function handleGenerateApiKey() {
    if (!canUseApiKeys) {
      router.push("/billing");
      return;
    }

    const suffix = Math.random().toString(36).slice(2, 10).toUpperCase();
    const secret = `sk_live_${Math.random().toString(36).slice(2)}${Date.now().toString(36)}`;

    setApiKeys((keys) => [
      { id: `CLI_KEY_${suffix}`, secret, createdAt: new Date().toISOString() },
      ...keys,
    ]);
    showNotice("API key generated.");
  }

  async function handleCopyApiKey(secret: string) {
    await navigator.clipboard?.writeText(secret);
    showNotice("API key copied.");
  }

  async function handleDeleteAccount() {
    if (deleteConfirm !== "DELETE") {
      showNotice("Type DELETE to confirm account deletion.");
      return;
    }

    if (user?.id) {
      window.localStorage.removeItem(`webtoapp-settings-${user.id}`);
    }

    await logout();
    router.push("/register");
  }

  return (
    <div className="min-h-screen bg-zinc-950">
      <TopBar title="Account Settings" />
      
      <div className="p-8 max-w-5xl mx-auto space-y-8">
        <div className="flex flex-col gap-2">
          <h2 className="text-3xl font-black text-white">Manage Account</h2>
          <p className="text-zinc-500">Configure your personal preferences and security settings.</p>
        </div>

        {notice && (
          <div className="rounded-xl border border-indigo-500/20 bg-indigo-500/10 px-4 py-3 text-sm font-medium text-indigo-200">
            {notice}
          </div>
        )}

        <Tabs defaultValue="profile">
          <TabsList>
            <TabsTrigger value="profile" label="Profile" icon={User} />
            <TabsTrigger value="security" label="Security" icon={Lock} />
            <TabsTrigger value="notifications" label="Notifications" icon={Bell} />
          </TabsList>

          {/* Profile Tab */}
          <TabsContent value="profile">
            <div className="space-y-6 max-w-4xl">
              <Card className="bg-zinc-900/50 border-zinc-800">
                <CardHeader>
                  <CardTitle className="text-lg font-bold">Personal Information</CardTitle>
                  <CardDescription>Update your public profile and contact details.</CardDescription>
                </CardHeader>
                <CardContent className="space-y-6 pt-2">
                  <div className="flex flex-col md:flex-row gap-8">
                    <div className="flex-1 space-y-4">
                      <div className="space-y-2">
                        <Label className="text-zinc-400">Full Name</Label>
                        <Input 
                          value={profile.name} 
                          onChange={(e) => setProfile(p => ({ ...p, name: e.target.value }))}
                          className="bg-zinc-950 border-zinc-800 text-white h-12 rounded-xl" 
                        />
                      </div>
                      <div className="space-y-2">
                        <Label className="text-zinc-400">Email Address</Label>
                        <div className="relative">
                          <Mail className="w-4 h-4 text-zinc-600 absolute left-4 top-1/2 -translate-y-1/2" />
                          <Input 
                            disabled 
                            value={profile.email} 
                            className="bg-zinc-950 border-zinc-800 text-zinc-500 pl-11 h-12 rounded-xl" 
                          />
                        </div>
                      </div>
                    </div>
                    <div className="w-full md:w-56 flex flex-col items-center justify-center p-6 border border-zinc-800 rounded-3xl bg-zinc-950/40 border-dashed">
                       <div className={`w-20 h-20 rounded-2xl border-2 flex items-center justify-center shadow-[0_0_20px_rgba(99,102,241,0.2)] ${AVATAR_COLORS[avatarColorIndex]}`}>
                        <span className="text-3xl font-black">
                         {(profile.name || user?.email || "?")[0]?.toUpperCase()}
                        </span>
                       </div>
                       <Button
                         type="button"
                         variant="outline"
                         size="sm"
                         onClick={() => {
                           setAvatarColorIndex((index) => (index + 1) % AVATAR_COLORS.length);
                           showNotice("Avatar color updated.");
                         }}
                         className="w-full mt-6 border-zinc-800 text-[10px] font-black uppercase tracking-widest hover:bg-zinc-800"
                       >
                         Change Avatar
                       </Button>
                    </div>
                  </div>
                  <div className="flex justify-end pt-4 border-t border-zinc-800">
                    <Button onClick={handleSaveProfile} className="bg-indigo-600 hover:bg-indigo-500 rounded-xl px-10 h-11 font-bold shadow-lg shadow-indigo-500/10">Save Changes</Button>
                  </div>
                </CardContent>
              </Card>

              <Card className="bg-zinc-900/50 border-zinc-800">
                <CardHeader>
                  <CardTitle className="text-lg font-bold">Plan Details</CardTitle>
                  <CardDescription>Your current subscription and usage limits.</CardDescription>
                </CardHeader>
                <CardContent className="flex items-center justify-between p-6 bg-indigo-500/5 border-y border-zinc-800">
                  <div className="flex items-center gap-4">
                    <div className="w-12 h-12 rounded-xl bg-indigo-600/20 flex items-center justify-center">
                      <CreditCard className="w-6 h-6 text-indigo-400" />
                    </div>
                    <div>
                      <p className="text-xs uppercase font-black text-indigo-400 tracking-wider font-medium">{plan} Plan</p>
                      <p className="text-zinc-400 text-sm">
                        {plan === "free" ? "Upgrade when you need more conversions." : "Manage your active subscription and invoices."}
                      </p>
                    </div>
                  </div>
                  <Button onClick={() => router.push("/billing")} variant="outline" className="border-zinc-800 rounded-xl px-6 text-sm font-bold">
                    {plan === "free" ? "Upgrade Plan" : "Manage Billing"}
                  </Button>
                </CardContent>
              </Card>
            </div>
          </TabsContent>

          {/* Security Tab */}
          <TabsContent value="security">
            <div className="space-y-6 max-w-4xl">
              <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
                <Card className="bg-zinc-900/50 border-zinc-800">
                  <CardHeader>
                    <CardTitle className="text-md font-bold flex items-center gap-2">
                       <Key className="w-4 h-4 text-indigo-400" />
                       Password Change
                    </CardTitle>
                    <CardDescription className="text-xs">Update your security credentials</CardDescription>
                  </CardHeader>
                  <CardContent className="space-y-3">
                    {showPasswordForm && (
                      <div className="space-y-3">
                        <Input type={showPassword ? "text" : "password"} placeholder="Current password" value={passwordForm.current} onChange={(e) => setPasswordForm((form) => ({ ...form, current: e.target.value }))} className="bg-zinc-950 border-zinc-800 text-white" />
                        <Input type={showPassword ? "text" : "password"} placeholder="New password" value={passwordForm.next} onChange={(e) => setPasswordForm((form) => ({ ...form, next: e.target.value }))} className="bg-zinc-950 border-zinc-800 text-white" />
                        <Input type={showPassword ? "text" : "password"} placeholder="Confirm new password" value={passwordForm.confirm} onChange={(e) => setPasswordForm((form) => ({ ...form, confirm: e.target.value }))} className="bg-zinc-950 border-zinc-800 text-white" />
                      </div>
                    )}
                    <div className="flex gap-2">
                      <Button
                        variant="outline"
                        onClick={() => showPasswordForm ? handleChangePassword() : setShowPasswordForm(true)}
                        className="flex-1 h-11 border-zinc-800 text-zinc-400 hover:text-white hover:bg-zinc-800 rounded-xl font-bold"
                      >
                        {showPasswordForm ? "Save Password" : "Change Password"}
                      </Button>
                      {showPasswordForm && (
                        <Button type="button" variant="outline" size="icon" onClick={() => setShowPassword((value) => !value)} className="h-11 w-11 border-zinc-800 text-zinc-400 hover:text-white hover:bg-zinc-800 rounded-xl">
                          {showPassword ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
                        </Button>
                      )}
                    </div>
                  </CardContent>
                </Card>

                <Card className="bg-zinc-900/50 border-zinc-800">
                  <CardHeader>
                    <CardTitle className="text-md font-bold flex items-center gap-2">
                      <Smartphone className="w-4 h-4 text-cyan-400" />
                      Two-Factor Auth
                    </CardTitle>
                    <CardDescription className="text-xs">Add an extra layer of protection</CardDescription>
                  </CardHeader>
                  <CardContent className="space-y-3">
                    <Button
                      variant="outline"
                      onClick={() => {
                        setTwoFactorEnabled((enabled) => !enabled);
                        showNotice(twoFactorEnabled ? "Two-factor authentication disabled." : "Two-factor authentication enabled.");
                      }}
                      className="w-full h-11 border-zinc-800 text-zinc-400 hover:text-white hover:bg-zinc-800 rounded-xl font-bold"
                    >
                      {twoFactorEnabled ? "Disable 2FA" : "Enable 2FA"}
                    </Button>
                    {twoFactorEnabled && (
                      <p className="text-[10px] text-emerald-400 bg-emerald-500/10 border border-emerald-500/20 rounded-xl p-3">
                        Recovery code: WEBTOAPP-{user?.id?.slice(0, 6).toUpperCase() || "USER"}-2FA
                      </p>
                    )}
                  </CardContent>
                </Card>
              </div>

              <Card className="bg-zinc-900/50 border-zinc-800">
                <CardHeader>
                   <CardTitle className="text-lg font-bold">API Access</CardTitle>
                   <CardDescription>Manage keys used for the WebToApp CLI and API.</CardDescription>
                </CardHeader>
                <CardContent className="space-y-4">
                   {!canUseApiKeys && (
                    <div className="p-4 bg-amber-500/10 rounded-2xl border border-amber-500/20 text-sm text-amber-100">
                      API keys are available on Pro, Team, and Enterprise plans.
                    </div>
                   )}
                   {canUseApiKeys && apiKeys.length === 0 && (
                    <div className="p-4 bg-zinc-950 rounded-2xl border border-dashed border-zinc-800 text-sm text-zinc-500">
                      No API keys yet.
                    </div>
                   )}
                   {apiKeys.map((key) => (
                     <div key={key.id} className="flex flex-col gap-3 p-4 bg-zinc-950 rounded-2xl border border-zinc-800 sm:flex-row sm:items-center sm:justify-between">
                        <div className="flex flex-col min-w-0">
                           <span className="text-sm font-bold text-white">{key.id}</span>
                           <span className="text-[10px] text-zinc-500 font-mono tracking-tighter truncate">{key.secret.slice(0, 12)}****************{key.secret.slice(-4)}</span>
                        </div>
                        <div className="flex items-center gap-2">
                          <Badge className="bg-emerald-500/10 text-emerald-500 border-emerald-500/20">Active</Badge>
                          <Button type="button" variant="ghost" size="icon" onClick={() => handleCopyApiKey(key.secret)} className="h-8 w-8 text-zinc-500 hover:text-white">
                            <Copy className="w-4 h-4" />
                          </Button>
                          <Button type="button" variant="ghost" size="icon" onClick={() => setApiKeys((keys) => keys.filter((item) => item.id !== key.id))} className="h-8 w-8 text-zinc-500 hover:text-rose-400">
                            <Trash2 className="w-4 h-4" />
                          </Button>
                        </div>
                     </div>
                   ))}
                   <Button onClick={handleGenerateApiKey} className="w-full bg-zinc-800 hover:bg-zinc-700 text-white rounded-xl h-11 font-bold">
                    {canUseApiKeys ? "Generate New API Key" : "Upgrade for API Keys"}
                   </Button>
                </CardContent>
              </Card>

              <Card className="bg-rose-500/5 border-rose-500/20 mt-12">
                <CardContent className="pt-6 flex flex-col md:flex-row items-center justify-between gap-6">
                  <div className="flex items-center gap-4">
                    <div className="w-12 h-12 rounded-xl bg-rose-500/10 flex items-center justify-center">
                       <Shield className="w-6 h-6 text-rose-500" />
                    </div>
                    <div>
                      <h4 className="font-bold text-white">Delete Account</h4>
                      <p className="text-sm text-zinc-500">Permanently delete all your conversion data and history.</p>
                    </div>
                  </div>
                  <div className="flex flex-col gap-2 w-full md:w-auto">
                    <Input value={deleteConfirm} onChange={(e) => setDeleteConfirm(e.target.value)} placeholder="Type DELETE" className="bg-zinc-950 border-rose-500/20 text-white h-10 rounded-xl md:w-44" />
                    <Button onClick={handleDeleteAccount} variant="destructive" className="bg-rose-600 hover:bg-rose-500 rounded-xl px-8 h-12 font-bold whitespace-nowrap">
                      Terminate Account
                    </Button>
                  </div>
                </CardContent>
              </Card>
            </div>
          </TabsContent>

          {/* Notifications Tab */}
          <TabsContent value="notifications">
            <Card className="bg-zinc-900/50 border-zinc-800 max-w-3xl">
              <CardHeader>
                <CardTitle className="text-lg font-bold">Notification Preferences</CardTitle>
                <CardDescription>Choose how you want to be notified about your build updates.</CardDescription>
              </CardHeader>
              <CardContent className="space-y-6">
                <div className="space-y-4">
                  {NOTIFICATION_OPTIONS.map((item) => (
                    <div key={item.id} className="flex items-start justify-between p-4 hover:bg-zinc-800/20 rounded-2xl transition-colors">
                      <div className="space-y-1">
                        <Label htmlFor={item.id} className="text-sm font-bold text-white cursor-pointer">{item.label}</Label>
                        <p className="text-xs text-zinc-500">{item.desc}</p>
                      </div>
                      <Checkbox
                        id={item.id}
                        checked={notifications[item.id]}
                        onCheckedChange={(checked) => setNotifications((prefs) => ({ ...prefs, [item.id]: checked === true }))}
                        className="mt-1 border-zinc-700 data-[state=checked]:bg-indigo-600"
                      />
                    </div>
                  ))}
                </div>
                <div className="flex justify-end pt-4 border-t border-zinc-800">
                  <Button onClick={() => showNotice("Notification preferences updated.")} className="bg-indigo-600 hover:bg-indigo-500 rounded-xl px-10 h-11 font-bold">Update Preferences</Button>
                </div>
              </CardContent>
            </Card>
          </TabsContent>
        </Tabs>
      </div>
    </div>
  );
}
