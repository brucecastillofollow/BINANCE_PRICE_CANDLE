import { useEffect, useState } from "react";
import { Outlet } from "react-router-dom";
import { AuthProvider, useAuth } from "../auth/AuthContext.jsx";
import { handleFormEnterKeyDown } from "../lib/formEnter.js";
import SiteBrand from "../components/SiteBrand.jsx";

function AuthGate() {
  const { token, user, refreshUser, login, register, logout, sendInvite } = useAuth();
  const [mode, setMode] = useState("login");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [inviteEmail, setInviteEmail] = useState("");
  const [inviteLink, setInviteLink] = useState("");
  const [message, setMessage] = useState("");
  const [loading, setLoading] = useState(Boolean(token));

  useEffect(() => {
    if (!token) {
      setLoading(false);
      return;
    }
    refreshUser()
      .catch(() => logout())
      .finally(() => setLoading(false));
  }, [token, refreshUser, logout]);

  async function handleAuthSubmit(event) {
    event.preventDefault();
    setMessage("");
    try {
      if (mode === "login") await login(email, password);
      else await register(email, password);
    } catch (error) {
      setMessage(error.message);
    }
  }

  async function handleInvite(event) {
    event.preventDefault();
    setMessage("");
    try {
      const data = await sendInvite(inviteEmail);
      setInviteLink(data.invite.link);
      await refreshUser();
    } catch (error) {
      setMessage(error.message);
    }
  }

  if (loading) return <p className="message">Loading...</p>;

  if (!token || !user) {
    return (
      <div className="app">
        <header className="page-header">
          <SiteBrand title="Binance Candle Data" />
        </header>
        <section className="card auth-card">
          <h2>{mode === "login" ? "Sign in" : "Create account"}</h2>
          <div className="auth-tabs">
            <button type="button" className={mode === "login" ? "primary" : ""} onClick={() => setMode("login")}>
              Login
            </button>
            <button type="button" className={mode === "register" ? "primary" : ""} onClick={() => setMode("register")}>
              Register
            </button>
          </div>
          <form onSubmit={handleAuthSubmit} onKeyDown={handleFormEnterKeyDown} className="stack-form">
            <label>
              Email
              <input type="email" value={email} onChange={(e) => setEmail(e.target.value)} required />
            </label>
            <label>
              Password
              <input type="password" value={password} onChange={(e) => setPassword(e.target.value)} minLength={8} required />
            </label>
            <button type="submit" className="primary">
              {mode === "login" ? "Login" : "Register"}
            </button>
          </form>
          {message ? <p className="message error">{message}</p> : null}
        </section>
      </div>
    );
  }

  return (
    <div className="app">
      <header className="page-header project-header">
        <SiteBrand title="Binance Candle Data" subtitle={user.email} />
        <div className="header-actions">
          {user.can_download ? (
            <span className="badge ok">Downloads unlocked</span>
          ) : (
            <span className="badge warn">Invite 1 friend to unlock downloads ({user.accepted_invites_sent}/1)</span>
          )}
          <button type="button" onClick={logout}>
            Logout
          </button>
        </div>
      </header>

      <section className="card">
        <h2>Invite a friend</h2>
        <p className="meta">CSV downloads unlock after one invited friend accepts.</p>
        <form onSubmit={handleInvite} onKeyDown={handleFormEnterKeyDown} className="row-form">
          <label>
            Email
            <input type="email" value={inviteEmail} onChange={(e) => setInviteEmail(e.target.value)} required />
          </label>
          <button type="submit" className="primary">
            Send invite
          </button>
        </form>
        {inviteLink ? <p className="meta invite-link">Share: {inviteLink}</p> : null}
        {message ? <p className="message">{message}</p> : null}
      </section>

      <Outlet />
    </div>
  );
}

export default function MainLayout() {
  return (
    <AuthProvider>
      <AuthGate />
    </AuthProvider>
  );
}
