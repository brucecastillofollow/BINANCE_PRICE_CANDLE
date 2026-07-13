import { useEffect, useState } from "react";
import { Link, useNavigate, useParams } from "react-router-dom";
import { AuthProvider, useAuth } from "../auth/AuthContext.jsx";
import SiteBrand from "../components/SiteBrand.jsx";
import ThemeToggle from "../components/ThemeToggle.jsx";

function InviteAcceptInner() {
  const { token } = useParams();
  const { setUser, authFetch, user, hubAuthUrl, booting } = useAuth();
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

  const returnTo = encodeURIComponent(window.location.href);

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
            <p className="meta">Sign in with your hub account that matches this invite email, then accept.</p>
            <button
              type="button"
              className="primary"
              onClick={() => {
                window.location.href = `${hubAuthUrl}/login?return_to=${returnTo}`;
              }}
            >
              Sign in at Weien Wong Hub
            </button>
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
