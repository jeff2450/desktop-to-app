"use client";

import React, { useState } from "react";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useAuthStore } from "@/stores/auth";
import { 
  Card, 
  CardContent, 
  CardHeader, 
  CardTitle, 
  CardDescription,
  CardFooter
} from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { 
  Mail, 
  Lock, 
  Loader2, 
  AlertCircle,
  ArrowRight
} from "lucide-react";

export default function LoginPage() {
  const router = useRouter();
  const { login } = useAuthStore();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setLoading(true);
    setError(null);
    
    try {
      const res = await login(email, password);
      if (res.error) {
        setError(res.error);
      } else {
        router.replace("/dashboard");
      }
    } catch {
      setError("An unexpected error occurred. Please try again.");
    } finally {
      setLoading(false);
    }
  };

  return (
    <Card className="w-full max-w-md bg-[#030720]/50 border-[#8d99c4]/15 backdrop-blur-xl shadow-2xl">
      <CardHeader className="space-y-1 text-center pb-8">
        <CardTitle className="text-2xl font-black text-white tracking-tight">Welcome back</CardTitle>
        <CardDescription className="text-[#8d99c4]">
          Enter your credentials to access your dashboard
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-6">
        <form onSubmit={handleSubmit} className="space-y-4">
          {error && (
            <div className="bg-rose-500/10 border border-rose-500/20 rounded-xl p-3 flex items-center gap-3 text-rose-500 text-sm animate-in fade-in slide-in-from-top-2">
              <AlertCircle className="w-4 h-4 flex-shrink-0" />
              <p>{error}</p>
            </div>
          )}
          
          <div className="space-y-2">
            <Label htmlFor="email" className="text-[#8d99c4]/80 text-xs font-bold uppercase tracking-widest">Email Address</Label>
            <div className="relative">
              <Mail className="w-4 h-4 text-[#8d99c4]/40 absolute left-3 top-1/2 -translate-y-1/2" />
              <Input 
                id="email"
                type="email" 
                placeholder="name@example.com" 
                required
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                className="bg-[#020514] border-[#8d99c4]/15 text-white pl-10 h-11 rounded-xl focus:ring-[#2b72f5]"
              />
            </div>
          </div>

          <div className="space-y-2">
            <div className="flex justify-between items-center">
              <Label htmlFor="password" className="text-[#8d99c4]/80 text-xs font-bold uppercase tracking-widest">Password</Label>
              <Link href="/forgot-password" className="text-[10px] text-[#8d99c4]/60 hover:text-[#2b72f5] font-bold uppercase tracking-widest">Forgot?</Link>
            </div>
            <div className="relative">
              <Lock className="w-4 h-4 text-[#8d99c4]/40 absolute left-3 top-1/2 -translate-y-1/2" />
              <Input 
                id="password"
                type="password" 
                placeholder="••••••••" 
                required
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                className="bg-[#020514] border-[#8d99c4]/15 text-white pl-10 h-11 rounded-xl focus:ring-[#2b72f5]"
              />
            </div>
          </div>

          <Button 
            type="submit" 
            id="login-submit"
            disabled={loading}
            className="w-full bg-[#2b72f5] hover:bg-[#1a5ecc] text-white h-11 rounded-xl shadow-[0_0_20px_rgba(43,114,245,0.3)] transition-all"
          >
            {loading ? <Loader2 className="w-4 h-4 animate-spin" /> : (
              <span className="flex items-center gap-2">
                Sign In <ArrowRight className="w-4 h-4" />
              </span>
            )}
          </Button>
        </form>
      </CardContent>
      <CardFooter className="flex justify-center border-t border-[#8d99c4]/10 pt-6">
        <p className="text-sm text-[#8d99c4]">
          Don&apos;t have an account?{" "}
          <Link href="/register" className="text-[#2b72f5] hover:text-[#1a5ecc] font-bold">Sign up</Link>
        </p>
      </CardFooter>
    </Card>
  );
}
