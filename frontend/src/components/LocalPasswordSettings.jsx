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
      setMessage("Binance password saved. You can use it to sign in here without the hub.");
    } catch (failure) {
      setError(failure.message || "Could not save the password. Please try again.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <section className="card account-access-card">
      <h2>Binance account access</h2>
      <p className="meta">
        {user.hasLocalPassword
          ? "Your Binance password lets you sign in here even if the Weien Wong Hub is unavailable."
          : "Set a Binance password now so you can sign in here even if the Weien Wong Hub is unavailable."}
      </p>
      {!open ? (
        <button type="button" onClick={() => { setOpen(true); setMessage(""); setError(""); }}>
          {user.hasLocalPassword ? "Change Binance password" : "Set Binance password"}
        </button>
      ) : (
        <form className="local-auth-form" onSubmit={handleSubmit}>
          {user.hasLocalPassword ? (
            <label>
              Current Binance password
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
            New Binance password
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
