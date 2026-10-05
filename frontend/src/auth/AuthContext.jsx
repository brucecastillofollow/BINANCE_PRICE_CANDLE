import { createContext, useCallback, useContext, useEffect, useMemo, useState } from "react";
import { API_BASE } from "../api.js";

const AuthContext = createContext(null);
const HUB_AUTH_URL = "https://weienwong.online";

export function AuthProvider({ children }) {
  const [user, setUser] = useState(null);
  const [linkRequired, setLinkRequired] = useState(null);
  const [logoutError, setLogoutError] = useState("");
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
        const error = new Error(data.message || data.detail || res.statusText);
        error.code = data.code;
        error.email = data.email;
        throw error;
      }
      return data;
    },
    [apiBase]
  );

  const refreshUser = useCallback(async () => {
    try {
      const data = await authFetch("/auth/me");
      setUser(data);
      setLinkRequired(null);
      return data;
    } catch (error) {
      setUser(null);
      setLinkRequired(error.code === "link_required" ? { email: error.email } : null);
      throw error;
    }
  }, [authFetch]);

  const linkLegacyAccount = useCallback(async (password) => {
    await authFetch("/auth/link", { method: "POST", json: { password } });
    return refreshUser();
  }, [authFetch, refreshUser]);

  const loginLocal = useCallback(async (email, password) => {
    const data = await authFetch("/auth/local/login", {
      method: "POST",
      json: { email, password },
    });
    setUser(data.user);
    setLinkRequired(null);
    return data.user;
  }, [authFetch]);

  const registerLocal = useCallback(async (email, password) => {
    const data = await authFetch("/auth/local/register", {
      method: "POST",
      json: { email, password },
    });
    setUser(data.user);
    setLinkRequired(null);
    return data.user;
  }, [authFetch]);

  const setLocalPassword = useCallback(async (password, currentPassword) => {
    await authFetch("/auth/local/password", {
      method: "POST",
      json: { password, ...(currentPassword ? { currentPassword } : {}) },
    });
    return refreshUser();
  }, [authFetch, refreshUser]);

  const logout = useCallback(async () => {
    setLogoutError("");
    // Start optional Hub revocation before the local response clears its cookie.
    // It must not hold up signing out of Binance when the Hub is unavailable.
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 1500);
    fetch(`${HUB_AUTH_URL}/api/identity/logout`, {
      method: "POST",
      credentials: "include",
      signal: controller.signal,
    }).catch(() => null).finally(() => clearTimeout(timeout));
    try {
      await authFetch("/auth/local/logout", { method: "POST" });
    } catch (_) {
      setLogoutError("Could not sign out of Binance. Please try again.");
      return false;
    }
    setUser(null);
    setLinkRequired(null);
    return true;
  }, [authFetch]);

  const sendInvite = useCallback(
    async (email) => authFetch("/auth/invites", { method: "POST", json: { email } }),
    [authFetch]
  );

  useEffect(() => {
    refreshUser()
      .catch(() => {})
      .finally(() => setBooting(false));
  }, [refreshUser]);

  const value = useMemo(
    () => ({
      apiBase,
      hubAuthUrl: HUB_AUTH_URL,
      // Empty token → rely on credentials: "include" + hub cookie.
      token: "",
      user,
      linkRequired,
      logoutError,
      setUser,
      logout,
      loginLocal,
      registerLocal,
      setLocalPassword,
      refreshUser,
      linkLegacyAccount,
      sendInvite,
      authFetch,
      booting,
      isAuthenticated: Boolean(user),
    }),
    [apiBase, user, linkRequired, logoutError, logout, loginLocal, registerLocal, setLocalPassword, refreshUser, linkLegacyAccount, sendInvite, authFetch, booting]
  );

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth() {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error("useAuth must be used within AuthProvider");
  return ctx;
}
