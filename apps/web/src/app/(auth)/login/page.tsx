"use client";

import { useState } from "react";
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
  GitBranch as Github, 
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
        router.push("/dashboard");
      }
    } catch (err) {
      setError("An unexpected error occurred. Please try again.");
    } finally {
      setLoading(false);
    }
  };

  return (
    <Card className="w-full max-w-md bg-zinc-900/50 border-zinc-800 backdrop-blur-xl shadow-2xl">
      <CardHeader className="space-y-1 text-center pb-8">
        <CardTitle className="text-2xl font-black text-white tracking-tight">Welcome back</CardTitle>
        <CardDescription className="text-zinc-500">
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
            <Label htmlFor="email" className="text-zinc-400 text-xs font-bold uppercase tracking-widest">Email Address</Label>
            <div className="relative">
              <Mail className="w-4 h-4 text-zinc-600 absolute left-3 top-1/2 -translate-y-1/2" />
              <Input 
                id="email"
                type="email" 
                placeholder="name@example.com" 
                required
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                className="bg-zinc-950 border-zinc-800 text-white pl-10 h-11 rounded-xl focus:ring-indigo-500"
              />
            </div>
          </div>

          <div className="space-y-2">
            <div className="flex justify-between items-center">
              <Label htmlFor="password" className="text-zinc-400 text-xs font-bold uppercase tracking-widest">Password</Label>
              <Link href="/forgot-password" className="text-[10px] text-zinc-500 hover:text-indigo-400 font-bold uppercase tracking-widest">Forgot?</Link>
            </div>
            <div className="relative">
              <Lock className="w-4 h-4 text-zinc-600 absolute left-3 top-1/2 -translate-y-1/2" />
              <Input 
                id="password"
                type="password" 
                placeholder="••••••••" 
                required
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                className="bg-zinc-950 border-zinc-800 text-white pl-10 h-11 rounded-xl focus:ring-indigo-500"
              />
            </div>
          </div>

          <Button 
            type="submit" 
            disabled={loading}
            className="w-full bg-indigo-600 hover:bg-indigo-500 text-white h-11 rounded-xl shadow-[0_0_20px_rgba(99,102,241,0.3)] transition-all"
          >
            {loading ? <Loader2 className="w-4 h-4 animate-spin" /> : (
              <span className="flex items-center gap-2">
                Sign In <ArrowRight className="w-4 h-4" />
              </span>
            )}
          </Button>
        </form>

        <div className="relative my-6">
          <div className="absolute inset-0 flex items-center">
            <span className="w-full border-t border-zinc-800"></span>
          </div>
          <div className="relative flex justify-center text-xs uppercase">
            <span className="bg-transparent px-2 text-zinc-600 font-bold tracking-widest">Or continue with</span>
          </div>
        </div>

        <Button variant="outline" className="w-full border-zinc-800 bg-zinc-950 text-zinc-400 hover:text-white hover:bg-zinc-900 h-11 rounded-xl">
          <Github className="w-4 h-4 mr-2" />
          GitHub
        </Button>
      </CardContent>
      <CardFooter className="flex justify-center border-t border-zinc-800/50 pt-6">
        <p className="text-sm text-zinc-500">
          Don&apos;t have an account?{" "}
          <Link href="/register" className="text-indigo-400 hover:text-indigo-300 font-bold">Sign up</Link>
        </p>
      </CardFooter>
    </Card>
  );
}
