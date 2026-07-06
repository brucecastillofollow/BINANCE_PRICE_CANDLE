import { useEffect, useState } from "react";
import { Link, useNavigate, useParams } from "react-router-dom";
import { handleFormEnterKeyDown } from "../lib/formEnter.js";
import { AuthProvider, useAuth } from "../auth/AuthContext.jsx";
import SiteBrand from "../components/SiteBrand.jsx";
import ThemeToggle from "../components/ThemeToggle.jsx";

function InviteAcceptInner() {
  const { token } = useParams();
  const { setToken, setUser, authFetch } = useAuth();
  const navigate = useNavigate();
  const [password, setPassword] = useState("");
  const [email, setEmail] = useState("");
  const [message, setMessage] = useState("");

  useEffect(() => {
    authFetch(`/auth/invites/${token}`)
      .then((data) => setEmail(data.email))
      .catch((e) => setMessage(e.message));
  }, [authFetch, token]);

  async function handleAccept(event) {
    event.preventDefault();
    setMessage("");
    try {
      const data = await authFetch(`/auth/invites/${token}/accept`, {
        method: "POST",
        json: { password },
      });
      setToken(data.token);
      setUser(data.user);
      navigate("/");
    } catch (error) {
      setMessage(error.message);
    }
  }

  return (
    <div className="app">
      <header className="page-header">
        <SiteBrand title="Accept invitation" action={<ThemeToggle />} />
      </header>
      <section className="card auth-card">
        <p className="meta">Invited as <strong>{email}</strong></p>
        <form onSubmit={handleAccept} onKeyDown={handleFormEnterKeyDown} className="stack-form">
          <label>
            Password (create or confirm)
            <input type="password" value={password} onChange={(e) => setPassword(e.target.value)} minLength={8} required />
          </label>
          <button type="submit" className="primary">
            Accept invite
          </button>
        </form>
        {message ? <p className="message error">{message}</p> : null}
        <p className="meta">
          <Link to="/">Back to home</Link>
        </p>
      </section>
    </div>
  );
}

export default function InviteAccept() {
  return (
    <AuthProvider>
      <InviteAcceptInner />
    </AuthProvider>
  );
}
