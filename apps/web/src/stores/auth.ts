import { create } from "zustand";
import { authApi, setClientToken } from "@/lib/api-client";

export interface User {
  id: string;
  email: string;
  name?: string | null;
  plan: "free" | "pro" | "team" | "enterprise";
}

interface AuthState {
  accessToken: string | null;
  user: User | null;
  isLoading: boolean;
  login: (email: string, password: string) => Promise<{ error?: string }>;
  register: (email: string, password: string, name?: string, plan?: string) => Promise<{ error?: string }>;
  logout: () => Promise<void>;
  hydrate: () => Promise<void>;
}

export const useAuthStore = create<AuthState>((set, get) => ({
  accessToken: null,
  user: null,
  isLoading: true,

  login: async (email, password) => {
    set({ isLoading: true });
    const result = await authApi.login(email, password);
    set({ isLoading: false });
    
    if (result.error) return { error: result.error };
    
    if (result.data?.accessToken && result.data?.user) {
      const { accessToken, refreshToken, user } = result.data;
      setClientToken(accessToken);
      set({ accessToken, user });
      
      if (refreshToken) {
        await fetch("/api/auth/cookie", {
          method: "POST",
          body: JSON.stringify({ refreshToken }),
        });
      }
    }
    return {};
  },

  register: async (email, password, name, plan) => {
    set({ isLoading: true });
    const result = await authApi.register(email, password, name, plan);
    set({ isLoading: false });
    
    if (result.error) return { error: result.error };
    
    if (result.data?.accessToken && result.data?.user) {
      const { accessToken, refreshToken, user } = result.data;
      setClientToken(accessToken);
      set({ accessToken, user });

      if (refreshToken) {
        await fetch("/api/auth/cookie", {
          method: "POST",
          body: JSON.stringify({ refreshToken }),
        });
      }
    }
    return {};
  },

  logout: async () => {
    await authApi.logout().catch(() => {});
    await fetch("/api/auth/cookie", { method: "DELETE" });
    setClientToken(null);
    set({ accessToken: null, user: null });
  },

  hydrate: async () => {
    // Only hydrate once
    if (get().user && get().accessToken) {
      set({ isLoading: false });
      return;
    }

    set({ isLoading: true });
    try {
      // 1. Check if we have a refresh token in the cookie
      const cookieRes = await fetch("/api/auth/cookie");
      const { refreshToken } = await cookieRes.json();

      if (refreshToken) {
        // 2. Try to get a new access token
        const refreshRes = await authApi.refresh(refreshToken);
        if (refreshRes.data?.accessToken) {
          setClientToken(refreshRes.data.accessToken);
          set({ accessToken: refreshRes.data.accessToken });
          
          // 3. Fetch user data
          const userRes = await authApi.me();
          if (userRes.data) {
            set({ user: userRes.data });
          }
        }
      }
    } catch (e) {
      console.error("Hydration failed:", e);
    } finally {
      set({ isLoading: false });
    }
  },
}));
