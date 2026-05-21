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
  updateUser: (user: Partial<User>) => void;
}

let authMutationVersion = 0;

function setAuthenticatedSession(accessToken: string, user: User) {
  setClientToken(accessToken);
  useAuthStore.setState({ accessToken, user, isLoading: false });
}

async function clearAuthSession() {
  setClientToken(null);
  useAuthStore.setState({ accessToken: null, user: null, isLoading: false });
  await fetchAuthCookie("/api/auth/cookie", { method: "DELETE" });
}

async function fetchAuthCookie(path: string, options?: RequestInit) {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 5000);

  try {
    return await fetch(path, {
      ...options,
      signal: controller.signal,
    });
  } catch {
    return null;
  } finally {
    clearTimeout(timeout);
  }
}

async function saveRefreshToken(refreshToken: string) {
  const response = await fetchAuthCookie("/api/auth/cookie", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ refreshToken }),
  });

  return Boolean(response?.ok);
}

export const useAuthStore = create<AuthState>((set) => ({
  accessToken: null,
  user: null,
  isLoading: true,

  login: async (email, password) => {
    authMutationVersion += 1;

    try {
      const result = await authApi.login(email, password);

      if (result.error) {
        set({ isLoading: false });
        return { error: result.error };
      }

      if (result.data?.accessToken && result.data?.user) {
        const { accessToken, refreshToken, user } = result.data;
        if (refreshToken) {
          const cookieSaved = await saveRefreshToken(refreshToken);
          if (!cookieSaved) {
            set({ isLoading: false });
            return { error: "Unable to save your session. Please try again." };
          }
        }

        setAuthenticatedSession(accessToken, user);
      }

      return {};
    } catch {
      set({ isLoading: false });
      return { error: "Unable to sign in. Please try again." };
    }
  },

  register: async (email, password, name, plan) => {
    authMutationVersion += 1;

    try {
      const result = await authApi.register(email, password, name, plan);

      if (result.error) {
        set({ isLoading: false });
        return { error: result.error };
      }

      if (result.data?.accessToken && result.data?.user) {
        const { accessToken, refreshToken, user } = result.data;
        if (refreshToken) {
          const cookieSaved = await saveRefreshToken(refreshToken);
          if (!cookieSaved) {
            set({ isLoading: false });
            return { error: "Unable to save your session. Please try again." };
          }
        }

        setAuthenticatedSession(accessToken, user);
      }

      return {};
    } catch {
      set({ isLoading: false });
      return { error: "Unable to create your account. Please try again." };
    }
  },

  logout: async () => {
    authMutationVersion += 1;
    await authApi.logout().catch(() => {});
    await clearAuthSession();
  },

  updateUser: (nextUser) => {
    set((state) => ({
      user: state.user ? { ...state.user, ...nextUser } : state.user,
    }));
  },
}));

// Bootstrap once when this module is first imported.
(async () => {
  const bootstrapVersion = authMutationVersion;

  const isStaleBootstrap = () => authMutationVersion !== bootstrapVersion;

  try {
    const cookieRes = await fetchAuthCookie("/api/auth/cookie");
    if (isStaleBootstrap()) {
      return;
    }

    if (!cookieRes) {
      return;
    }

    const { refreshToken } = await cookieRes.json();
    if (isStaleBootstrap()) {
      return;
    }

    if (!refreshToken) {
      return;
    }

    const refreshRes = await authApi.refresh(refreshToken);
    if (isStaleBootstrap()) {
      return;
    }

    if (refreshRes.error || !refreshRes.data?.accessToken) {
      await clearAuthSession();
      return;
    }

    setClientToken(refreshRes.data.accessToken);
    useAuthStore.setState({ accessToken: refreshRes.data.accessToken });

    const userRes = await authApi.me();
    if (isStaleBootstrap()) {
      return;
    }

    if (userRes.error || !userRes.data) {
      await clearAuthSession();
      return;
    }

    useAuthStore.setState({ user: userRes.data, isLoading: false });
  } catch (e) {
    if (isStaleBootstrap()) {
      return;
    }

    console.error("Auth bootstrap failed:", e);
    await clearAuthSession();
  } finally {
    if (!isStaleBootstrap()) {
      useAuthStore.setState({ isLoading: false });
    }
  }
})();
