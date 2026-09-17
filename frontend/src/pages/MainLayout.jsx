import { useState } from "react";
import { Outlet } from "react-router-dom";
import { AuthProvider, useAuth } from "../auth/AuthContext.jsx";
import { handleFormEnterKeyDown } from "../lib/formEnter.js";
import SiteBrand from "../components/SiteBrand.jsx";
import ThemeToggle from "../components/ThemeToggle.jsx";
import EcosystemLinks from "../components/EcosystemLinks.jsx";

function AuthGate() {
  const { user, refreshUser, logout, sendInvite, hubAuthUrl, booting } = useAuth();
  const [inviteEmail, setInviteEmail] = useState("");
  const [inviteLink, setInviteLink] = useState("");
  const [message, setMessage] = useState("");

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
    return (
      <div className="app">
        <header className="page-header project-header">
          <SiteBrand title="Binance Candle Data" />
          <div className="header-actions">
            <a className="secondary" href="https://weienwong.online/" title="Return to Weien Wong hub">
              ← Hub
            </a>
            <ThemeToggle />
          </div>
        </header>
        <section className="card auth-card">
          <h2>Sign in to continue</h2>
          <p className="meta">
            <strong>Create your account here and it works on every weienwong.online service</strong>
            {" "}&mdash; sign in once, use them all. Already registered on another one? Just sign in.
          </p>
          {/* data-ww-signup / data-ww-signin are picked up by ww-auth.js (loaded in
              index.html) through a document-level listener, so React rendering
              these is enough. The dialog posts to weienwong.online itself and the
              page reloads signed in -- nobody is sent to another site. */}
          <button
            type="button"
            className="primary"
            style={{ width: "100%", marginTop: 12 }}
            data-ww-signup
          >
            Create a free account
          </button>
          <button
            type="button"
            style={{ width: "100%", marginTop: 8 }}
            data-ww-signin
          >
            I already have one
          </button>
        </section>
        <section className="card auth-about-card">
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
        </section>
        <EcosystemLinks />
      </div>
    );
  }

  return (
    <div className="app">
      <header className="page-header project-header">
        <SiteBrand title="Binance Candle Data" subtitle={user.email} />
        <div className="header-actions">
          <a className="secondary" href="https://weienwong.online/" title="Return to Weien Wong hub">
            ← Hub
          </a>
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
      <EcosystemLinks />
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
