import { useState } from "react";
import { Outlet } from "react-router-dom";
import { AuthProvider, useAuth } from "../auth/AuthContext.jsx";
import { handleFormEnterKeyDown } from "../lib/formEnter.js";
import SiteBrand from "../components/SiteBrand.jsx";
import ThemeToggle from "../components/ThemeToggle.jsx";

function AuthGate() {
  const { user, refreshUser, logout, sendInvite, hubAuthUrl, booting } = useAuth();
  const [inviteEmail, setInviteEmail] = useState("");
  const [inviteLink, setInviteLink] = useState("");
  const [message, setMessage] = useState("");
  const [authTab, setAuthTab] = useState("signin");

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

  if (booting) return <p className="message">Loading...</p>;

  if (!user) {
    const returnTo = encodeURIComponent(window.location.href);
    return (
      <div className="app">
        <header className="page-header">
          <SiteBrand title="Binance Candle Data" action={<ThemeToggle />} />
        </header>
        <section className="card auth-card">
          <div className="auth-tabs" role="tablist">
            <button
              type="button"
              className={authTab === "signin" ? "auth-tab active" : "auth-tab"}
              role="tab"
              aria-selected={authTab === "signin"}
              onClick={() => setAuthTab("signin")}
            >
              Sign in
            </button>
            <button
              type="button"
              className={authTab === "about" ? "auth-tab active" : "auth-tab"}
              role="tab"
              aria-selected={authTab === "about"}
              onClick={() => setAuthTab("about")}
            >
              About
            </button>
          </div>

          {authTab === "signin" ? (
            <div className="auth-panel">
              <h2>Sign in required</h2>
              <p className="meta">Use your Weien Wong hub account to access Binance Candle Data.</p>
              <button
                type="button"
                className="primary"
                style={{ width: "100%", marginTop: 12 }}
                onClick={() => {
                  window.location.href = `${hubAuthUrl}/login?return_to=${returnTo}`;
                }}
              >
                Sign in at Weien Wong Hub
              </button>
              <p className="meta" style={{ marginTop: 12 }}>
                No account?{" "}
                <a href={`${hubAuthUrl}/register?return_to=${returnTo}`}>Create one at the hub</a>
              </p>
            </div>
          ) : (
            <div className="auth-panel auth-about">
              <h2>What this platform does</h2>
              <p className="meta">
                Explore Binance spot markets and inspect historical OHLC candle data for any
                pair and interval. Chart a date range in the browser, then export CSV once downloads
                are unlocked.
              </p>
              <p className="about-look-label">What it looks like</p>
              <ul className="about-preview">
                <li>Pick a market and interval from a searchable list</li>
                <li>Interactive candle chart for the dates you choose</li>
                <li>CSV download for offline analysis (unlock with one invite)</li>
              </ul>
            </div>
          )}
        </section>
      </div>
    );
  }

  return (
    <div className="app">
      <header className="page-header project-header">
        <SiteBrand title="Binance Candle Data" subtitle={user.email} />
        <div className="header-actions">
          <ThemeToggle />
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
