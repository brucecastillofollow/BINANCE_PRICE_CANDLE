import { useEffect, useState } from "react";
import { useAuth } from "../auth/AuthContext.jsx";

export default function LocalAuthForm({ emailHint = "" }) {
  const { loginLocal, registerLocal } = useAuth();
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
      <h2>{mode === "login" ? "Sign in to Binance Candle Data" : "Create your account"}</h2>
      <p className="meta">
        Create an account here and use it to sign in to other Weien Wong services. Already registered elsewhere? Use the same email and password here.
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
        {mode === "login" ? "New here? Create an account" : "Already have an account? Sign in"}
      </button>
    </>
  );
}
