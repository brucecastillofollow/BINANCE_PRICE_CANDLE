import { createContext, useCallback, useContext, useMemo, useState } from "react";
import { API_BASE } from "../api.js";

const AuthContext = createContext(null);

const TOKEN_KEY = "binance_candle_token";

export function AuthProvider({ children }) {
  const [token, setTokenState] = useState(() => localStorage.getItem(TOKEN_KEY) || "");
  const [user, setUser] = useState(null);

  const apiBase = API_BASE || "";

  const setToken = useCallback((value) => {
    if (value) localStorage.setItem(TOKEN_KEY, value);
    else localStorage.removeItem(TOKEN_KEY);
    setTokenState(value || "");
  }, []);

  const authFetch = useCallback(
    async (path, options = {}) => {
      const headers = { ...(options.headers || {}) };
      if (options.json) {
        headers["Content-Type"] = "application/json";
        options.body = JSON.stringify(options.json);
        delete options.json;
      }
      if (token) headers.Authorization = `Bearer ${token}`;
      const res = await fetch(`${apiBase}${path}`, { ...options, headers });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(data.message || data.detail || res.statusText);
      return data;
    },
    [apiBase, token]
  );

  const login = useCallback(
    async (email, password) => {
      const data = await authFetch("/auth/login", { method: "POST", json: { email, password } });
      setToken(data.token);
      setUser(data.user);
      return data.user;
    },
    [authFetch, setToken]
  );

  const register = useCallback(
    async (email, password) => {
      const data = await authFetch("/auth/register", {
        method: "POST",
        json: { email, password },
      });
      setToken(data.token);
      setUser(data.user);
      return data.user;
    },
    [authFetch, setToken]
  );

  const logout = useCallback(() => {
    setToken("");
    setUser(null);
  }, [setToken]);

  const refreshUser = useCallback(async () => {
    if (!token) return null;
    const data = await authFetch("/auth/me");
    setUser(data);
    return data;
  }, [authFetch, token]);

  const sendInvite = useCallback(
    async (email) => authFetch("/auth/invites", { method: "POST", json: { email } }),
    [authFetch]
  );

  const value = useMemo(
    () => ({
      apiBase,
      token,
      user,
      setToken,
      setUser,
      login,
      register,
      logout,
      refreshUser,
      sendInvite,
      authFetch,
      isAuthenticated: Boolean(token),
    }),
    [apiBase, token, user, setToken, login, register, logout, refreshUser, sendInvite, authFetch]
  );

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth() {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error("useAuth must be used within AuthProvider");
  return ctx;
}
