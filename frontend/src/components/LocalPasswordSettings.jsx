import { useState } from "react";
import { useAuth } from "../auth/AuthContext.jsx";

export default function LocalPasswordSettings() {
  const { user, setLocalPassword } = useAuth();
  const [open, setOpen] = useState(false);
  const [currentPassword, setCurrentPassword] = useState("");
  const [password, setPassword] = useState("");
  const [confirmation, setConfirmation] = useState("");
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState("");
  const [error, setError] = useState("");

  async function handleSubmit(event) {
    event.preventDefault();
    setError("");
    setMessage("");
    if (password !== confirmation) {
      setError("Passwords do not match.");
      return;
    }
    setBusy(true);
    try {
      await setLocalPassword(password, currentPassword);
      setCurrentPassword("");
      setPassword("");
      setConfirmation("");
      setOpen(false);
      setMessage(user.sharedAccount
        ? "Shared password changed. Use it on every Weien Wong service."
        : "Binance password changed.");
    } catch (failure) {
      setError(failure.message || "Could not save the password. Please try again.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <section className="card account-access-card">
      <h2>Account access</h2>
      <p className="meta">
        {user.sharedAccount
          ? "Your password works on every Weien Wong service. Changing it here changes it everywhere."
          : "This older Binance account has its own password. Sign in with a shared account and link it to use other services."}
      </p>
      {!open ? (
        <button type="button" onClick={() => { setOpen(true); setMessage(""); setError(""); }}>
          {user.sharedAccount ? "Change shared password" : "Change Binance password"}
        </button>
      ) : (
        <form className="local-auth-form" onSubmit={handleSubmit}>
          {user.hasLocalPassword ? (
            <label>
              Current password
              <input
                type="password"
                autoComplete="current-password"
                value={currentPassword}
                onChange={(event) => setCurrentPassword(event.target.value)}
                required
                disabled={busy}
              />
            </label>
          ) : null}
          <label>
            New password
            <input
              type="password"
              autoComplete="new-password"
              value={password}
              onChange={(event) => setPassword(event.target.value)}
              minLength={12}
              maxLength={72}
              required
              disabled={busy}
            />
          </label>
          <label>
            Confirm new password
            <input
              type="password"
              autoComplete="new-password"
              value={confirmation}
              onChange={(event) => setConfirmation(event.target.value)}
              minLength={12}
              maxLength={72}
              required
              disabled={busy}
            />
          </label>
          <p className="meta">Use at least 12 characters and at most 72 UTF-8 bytes.</p>
          <div className="row-form">
            <button type="submit" className="primary" disabled={busy}>
              {busy ? "Saving…" : "Save password"}
            </button>
            <button type="button" disabled={busy} onClick={() => { setOpen(false); setError(""); }}>
              Cancel
            </button>
          </div>
        </form>
      )}
      {message ? <p className="message" role="status">{message}</p> : null}
      {error ? <p className="message error" role="alert">{error}</p> : null}
    </section>
  );
}
