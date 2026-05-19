"use client";

import { useState, useEffect } from "react";
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
  Smartphone
} from "lucide-react";
import { Badge } from "@/components/ui/badge";

export default function SettingsPage() {
  const { user } = useAuthStore();
  const [loading, setLoading] = useState(false);

  const [profile, setProfile] = useState({
    name: "",
    email: ""
  });

  useEffect(() => {
    if (user) {
      setProfile({
        name: user.name || "",
        email: user.email || ""
      });
    }
  }, [user]);

  return (
    <div className="min-h-screen bg-zinc-950">
      <TopBar title="Account Settings" />
      
      <div className="p-8 space-y-8 max-w-4xl mx-auto">
        
        {/* Profile Settings */}
        <section className="space-y-4">
          <div className="flex items-center gap-2 mb-2">
            <User className="w-4 h-4 text-indigo-400" />
            <h3 className="text-sm font-bold uppercase tracking-widest text-zinc-500">Profile Information</h3>
          </div>
          
          <Card className="bg-zinc-900/50 border-zinc-800">
            <CardContent className="pt-6 space-y-6">
              <div className="flex flex-col md:flex-row gap-6">
                <div className="flex-1 space-y-4">
                  <div className="space-y-2">
                    <Label className="text-zinc-400">Full Name</Label>
                    <Input 
                      value={profile.name} 
                      onChange={(e) => setProfile(p => ({ ...p, name: e.target.value }))}
                      className="bg-zinc-950 border-zinc-800 text-white" 
                    />
                  </div>
                  <div className="space-y-2">
                    <Label className="text-zinc-400">Email Address</Label>
                    <div className="relative">
                      <Mail className="w-4 h-4 text-zinc-600 absolute left-3 top-1/2 -translate-y-1/2" />
                      <Input 
                        disabled 
                        value={profile.email} 
                        className="bg-zinc-950 border-zinc-800 text-zinc-500 pl-10" 
                      />
                    </div>
                  </div>
                </div>
                <div className="w-full md:w-48 flex flex-col items-center justify-center p-6 border border-zinc-800 rounded-2xl bg-zinc-950/50">
                   <div className="w-16 h-16 rounded-full bg-indigo-500/20 border-2 border-indigo-500 flex items-center justify-center">
                    <span className="text-2xl font-bold text-indigo-400">
                     {user?.email?.[0]?.toUpperCase()}
                    </span>
                   </div>
                   <Button variant="outline" size="sm" className="w-full mt-4 border-zinc-800 text-xs font-bold uppercase">Change Avatar</Button>
                </div>
              </div>
              <div className="flex justify-end">
                <Button className="bg-indigo-600 hover:bg-indigo-500 rounded-xl px-8">Save Changes</Button>
              </div>
            </CardContent>
          </Card>
        </section>

        {/* Security Settings */}
        <section className="space-y-4">
          <div className="flex items-center gap-2 mb-2">
            <Lock className="w-4 h-4 text-indigo-400" />
            <h3 className="text-sm font-bold uppercase tracking-widest text-zinc-500">Security & Access</h3>
          </div>
          
          <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
            <Card className="bg-zinc-900/50 border-zinc-800">
              <CardHeader>
                <CardTitle className="text-sm font-bold">Password</CardTitle>
                <CardDescription className="text-xs">Update your account password</CardDescription>
              </CardHeader>
              <CardContent>
                <Button variant="outline" className="w-full border-zinc-800 text-zinc-400 hover:text-white hover:bg-zinc-800 rounded-xl">
                  Update Password
                </Button>
              </CardContent>
            </Card>

            <Card className="bg-zinc-900/50 border-zinc-800">
              <CardHeader>
                <CardTitle className="text-sm font-bold">API Keys</CardTitle>
                <CardDescription className="text-xs">Manage keys for CLI authentication</CardDescription>
              </CardHeader>
              <CardContent>
                <Button variant="outline" className="w-full border-zinc-800 text-zinc-400 hover:text-white hover:bg-zinc-800 rounded-xl">
                  Manage API Keys
                </Button>
              </CardContent>
            </Card>
          </div>
        </section>

        {/* Danger Zone */}
        <section className="space-y-4 pt-8">
          <div className="flex items-center gap-2 mb-2">
            <Shield className="w-4 h-4 text-rose-500" />
            <h3 className="text-sm font-bold uppercase tracking-widest text-rose-500">Danger Zone</h3>
          </div>
          
          <Card className="bg-rose-500/5 border-rose-500/20">
            <CardContent className="pt-6 flex flex-col md:flex-row items-center justify-between gap-6">
              <div>
                <h4 className="font-bold text-white">Delete Account</h4>
                <p className="text-sm text-zinc-500">Permanently remove all your data and job history. This action is irreversible.</p>
              </div>
              <Button variant="destructive" className="bg-rose-600 hover:bg-rose-500 rounded-xl px-8 whitespace-nowrap">
                <Trash2 className="w-4 h-4 mr-2" /> Delete Account
              </Button>
            </CardContent>
          </Card>
        </section>

      </div>
    </div>
  );
}
