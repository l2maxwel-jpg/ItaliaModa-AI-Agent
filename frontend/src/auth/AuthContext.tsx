import React, { createContext, useCallback, useContext, useEffect, useMemo, useState } from "react";
import { apiFetch, setOnUnauthorized } from "./apiClient";

export interface AuthUser {
  id: string;
  username: string;
  role: "admin" | "user";
  isActive: boolean;
  createdAt: string;
  failedLoginAttempts: number;
  lockedUntil?: string;
  lastLoginAt?: string;
}

interface NeedsSetupResponse { needsSetup: boolean }
interface MeResponse { user: AuthUser }
interface LoginResponse { user: AuthUser; error?: string }
interface ErrorResponse { error?: string }

interface AuthContextValue {
  isInitializing: boolean;
  needsSetup: boolean;
  user: AuthUser | null;
  login: (username: string, password: string) => Promise<{ ok: true } | { ok: false; error: string }>;
  setupAdmin: (username: string, password: string) => Promise<{ ok: true } | { ok: false; error: string }>;
  logout: () => Promise<void>;
  refresh: () => Promise<void>;
}

const AuthContext = createContext<AuthContextValue | null>(null);

async function safeJsonResponse<T extends ErrorResponse>(response: Response): Promise<T> {
  try {
    return await response.json() as T;
  } catch {
    return { error: `HTTP ${response.status}` } as T;
  }
}

export const AuthProvider: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  const [isInitializing, setIsInitializing] = useState<boolean>(true);
  const [needsSetup, setNeedsSetup] = useState<boolean>(false);
  const [user, setUser] = useState<AuthUser | null>(null);

  const refresh = useCallback(async (): Promise<void> => {
    try {
      const setupRes = await apiFetch("/api/auth/needs-setup");
      const setupData = await safeJsonResponse<NeedsSetupResponse & ErrorResponse>(setupRes);
      const setupRequired = setupData.needsSetup === true;
      setNeedsSetup(setupRequired);
      if (setupRequired) {
        setUser(null);
        return;
      }
      const meRes = await apiFetch("/api/auth/me");
      if (meRes.ok) {
        const meData = await safeJsonResponse<MeResponse & ErrorResponse>(meRes);
        setUser(meData.user ?? null);
      } else {
        setUser(null);
      }
    } catch {
      setUser(null);
    }
  }, []);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      await refresh();
      if (!cancelled) setIsInitializing(false);
    })();
    return () => { cancelled = true; };
  }, [refresh]);

  // Wire global 401 handler so any apiFetch in the app triggers re-auth.
  useEffect(() => {
    const handler = (): void => {
      setUser(null);
    };
    setOnUnauthorized(handler);
    return () => setOnUnauthorized(null);
  }, []);

  const login = useCallback(async (username: string, password: string) => {
    const response = await apiFetch("/api/auth/login", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ username, password }),
    });
    const data = await safeJsonResponse<LoginResponse>(response);
    if (response.ok && data.user) {
      setUser(data.user);
      setNeedsSetup(false);
      return { ok: true as const };
    }
    return { ok: false as const, error: data.error || "Не удалось войти" };
  }, []);

  const setupAdmin = useCallback(async (username: string, password: string) => {
    const response = await apiFetch("/api/auth/setup", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ username, password }),
    });
    const data = await safeJsonResponse<LoginResponse>(response);
    if (response.ok && data.user) {
      setUser(data.user);
      setNeedsSetup(false);
      return { ok: true as const };
    }
    return { ok: false as const, error: data.error || "Не удалось создать администратора" };
  }, []);

  const logout = useCallback(async (): Promise<void> => {
    try {
      await apiFetch("/api/auth/logout", { method: "POST" });
    } catch {
      /* ignore network errors on logout */
    } finally {
      setUser(null);
    }
  }, []);

  const value = useMemo<AuthContextValue>(() => ({
    isInitializing,
    needsSetup,
    user,
    login,
    setupAdmin,
    logout,
    refresh,
  }), [isInitializing, needsSetup, user, login, setupAdmin, logout, refresh]);

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
};

export const useAuth = (): AuthContextValue => {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error("useAuth must be used inside <AuthProvider>");
  return ctx;
};
