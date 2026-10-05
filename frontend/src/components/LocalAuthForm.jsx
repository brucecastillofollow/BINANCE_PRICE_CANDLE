import { useEffect, useState } from "react";
import { useAuth } from "../auth/AuthContext.jsx";

export default function LocalAuthForm({ emailHint = "" }) {
  const { hubAuthUrl, loginLocal, registerLocal } = useAuth();
  const [mode, setMode] = useState("login");
  const [email, setEmail] = useState(emailHint);
  const [password, setPassword] = useState("");
  const [confirmation, setConfirmation] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  useEffect(() => {
    setEmail((current) => current || emailHint);
  }, [emailHint]);

  async function handleSubmit(event) {
    event.preventDefault();
    setError("");
    if (mode === "register" && password !== confirmation) {
      setError("Passwords do not match.");
      return;
    }
    setBusy(true);
    try {
      if (mode === "register") await registerLocal(email.trim(), password);
      else await loginLocal(email.trim(), password);
    } catch (failure) {
      setError(failure.message || "Could not sign in. Please try again.");
    } finally {
      setBusy(false);
    }
  }

  function changeMode(nextMode) {
    setMode(nextMode);
    setPassword("");
    setConfirmation("");
    setError("");
  }

  return (
    <>
      <h2>{mode === "login" ? "Sign in to Binance Candle Data" : "Create a Binance account"}</h2>
      <p className="meta">
        Use an account for this project. Its sign-in works even when the Weien Wong Hub is unavailable.
      </p>
      <form className="local-auth-form" onSubmit={handleSubmit}>
        <label>
          Email
          <input
            type="email"
            autoComplete="email"
            value={email}
            onChange={(event) => setEmail(event.target.value)}
            required
            disabled={busy}
          />
        </label>
        <label>
          Password
          <input
            type="password"
            autoComplete={mode === "register" ? "new-password" : "current-password"}
            value={password}
            onChange={(event) => setPassword(event.target.value)}
            minLength={mode === "register" ? 12 : undefined}
            maxLength={mode === "register" ? 72 : undefined}
            required
            disabled={busy}
          />
        </label>
        {mode === "register" ? (
          <label>
            Confirm password
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
        ) : null}
        {mode === "register" ? <p className="meta">Use at least 12 characters and at most 72 UTF-8 bytes.</p> : null}
        <button type="submit" className="primary" disabled={busy}>
          {busy ? "Please wait…" : mode === "register" ? "Create account" : "Sign in"}
        </button>
      </form>
      {error ? <p className="message error" role="alert">{error}</p> : null}
      <button
        type="button"
        className="auth-text-button"
        onClick={() => changeMode(mode === "login" ? "register" : "login")}
        disabled={busy}
      >
        {mode === "login" ? "New here? Create a Binance account" : "Already have a Binance account? Sign in"}
      </button>
      <div className="auth-alternative">
        <p className="meta">
          Only used the Weien Wong Hub before? Sign in with the Hub once, then set a Binance password
          under Binance account access. Your Hub password will not work in the form above until then.
        </p>
        <a
          className="secondary"
          href={`${hubAuthUrl}/login?return_to=${encodeURIComponent(window.location.href)}`}
        >
          Sign in with Weien Wong Hub
        </a>
      </div>
    </>
  );
}
