import { useState } from "react";
import { useAuth } from "../auth/AuthContext.jsx";

export default function LegacyAccountLink() {
  const { linkRequired, linkLegacyAccount, logout, logoutError } = useAuth();
  const [password, setPassword] = useState("");
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);

  async function handleLink(event) {
    event.preventDefault();
    setError("");
    setBusy(true);
    try {
      await linkLegacyAccount(password);
      setPassword("");
    } catch (linkError) {
      setError(linkError.message || "Could not link this account.");
    } finally {
      setBusy(false);
    }
  }

  if (!linkRequired) return null;
  return (
    <>
      <h2>Link your existing Binance account</h2>
      <p className="meta">
        You are signed in at Weien Wong as <strong>{linkRequired.email}</strong>.
        Enter the password you used on Binance Candle Data once to keep your saved account and invites.
      </p>
      <form onSubmit={handleLink} className="row-form">
        <label>
          Old Binance account password
          <input
            type="password"
            autoComplete="current-password"
            value={password}
            onChange={(event) => setPassword(event.target.value)}
            required
          />
        </label>
        <button type="submit" className="primary" disabled={busy}>
          {busy ? "Linking…" : "Link account"}
        </button>
      </form>
      {error ? <p className="message error" role="alert">{error}</p> : null}
      <button type="button" onClick={logout}>Use a different hub account</button>
      {logoutError ? <p className="message error" role="alert">{logoutError}</p> : null}
    </>
  );
}
