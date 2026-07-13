import { createContext, useCallback, useContext, useEffect, useMemo, useState } from "react";
import { API_BASE } from "../api.js";

const AuthContext = createContext(null);
const HUB_AUTH_URL = "https://weienwong.online";

export function AuthProvider({ children }) {
  const [user, setUser] = useState(null);
  const [booting, setBooting] = useState(true);

  const apiBase = API_BASE || "";

  const authFetch = useCallback(
    async (path, options = {}) => {
      const headers = { ...(options.headers || {}) };
      if (options.json) {
        headers["Content-Type"] = "application/json";
        options.body = JSON.stringify(options.json);
        delete options.json;
      }
      const res = await fetch(`${apiBase}${path}`, {
        ...options,
        headers,
        credentials: "include",
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        const isSessionProbe = path === "/auth/me";
        if (data.redirect && !isSessionProbe) {
          window.location.href = data.redirect.includes("return_to=")
            ? data.redirect
            : `${data.redirect}${data.redirect.includes("?") ? "&" : "?"}return_to=${encodeURIComponent(window.location.href)}`;
          throw new Error("Redirecting to hub sign in…");
        }
        throw new Error(data.message || data.detail || res.statusText);
      }
      return data;
    },
    [apiBase]
  );

  const refreshUser = useCallback(async () => {
    const data = await authFetch("/auth/me");
    setUser(data);
    return data;
  }, [authFetch]);

  const logout = useCallback(async () => {
    try {
      await fetch(`${HUB_AUTH_URL}/api/identity/logout`, {
        method: "POST",
        credentials: "include",
      });
    } catch (_) {
      /* ignore */
    }
    setUser(null);
  }, []);

  const sendInvite = useCallback(
    async (email) => authFetch("/auth/invites", { method: "POST", json: { email } }),
    [authFetch]
  );

  useEffect(() => {
    refreshUser()
      .catch(() => setUser(null))
      .finally(() => setBooting(false));
  }, [refreshUser]);

  const value = useMemo(
    () => ({
      apiBase,
      hubAuthUrl: HUB_AUTH_URL,
      // Empty token → rely on credentials: "include" + hub cookie.
      token: "",
      user,
      setUser,
      logout,
      refreshUser,
      sendInvite,
      authFetch,
      booting,
      isAuthenticated: Boolean(user),
    }),
    [apiBase, user, logout, refreshUser, sendInvite, authFetch, booting]
  );

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth() {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error("useAuth must be used within AuthProvider");
  return ctx;
}
