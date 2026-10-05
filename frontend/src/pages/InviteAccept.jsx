import { useEffect, useState } from "react";
import { Link, useNavigate, useParams } from "react-router-dom";
import { AuthProvider, useAuth } from "../auth/AuthContext.jsx";
import SiteBrand from "../components/SiteBrand.jsx";
import ThemeToggle from "../components/ThemeToggle.jsx";
import LegacyAccountLink from "../components/LegacyAccountLink.jsx";
import LocalAuthForm from "../components/LocalAuthForm.jsx";

function InviteAcceptInner() {
  const { token } = useParams();
  const { setUser, authFetch, user, linkRequired, booting } = useAuth();
  const navigate = useNavigate();
  const [email, setEmail] = useState("");
  const [message, setMessage] = useState("");

  useEffect(() => {
    authFetch(`/auth/invites/${token}`)
      .then((data) => setEmail(data.email))
      .catch((e) => setMessage(e.message));
  }, [authFetch, token]);

  async function handleAccept() {
    setMessage("");
    try {
      const data = await authFetch(`/auth/invites/${token}/accept`, {
        method: "POST",
        json: {},
      });
      setUser(data.user);
      navigate("/");
    } catch (error) {
      setMessage(error.message);
    }
  }

  if (booting) return <p className="message">Loading...</p>;

  return (
    <div className="app">
      <header className="page-header">
        <SiteBrand title="Accept invitation" action={<ThemeToggle />} />
      </header>
      <section className="card auth-card">
        <p className="meta">
          Invited as <strong>{email || "…"}</strong>
        </p>
        {!user ? (
          <>
            <p className="meta">Sign in with the invited email, then accept.</p>
            <LocalAuthForm emailHint={email} />
            {linkRequired ? <div className="auth-alternative"><LegacyAccountLink /></div> : null}
          </>
        ) : (
          <button type="button" className="primary" onClick={handleAccept}>
            Accept invite as {user.email}
          </button>
        )}
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
