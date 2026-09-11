/**
 * Ask the hub whether it still honours a session it issued.
 *
 * A hub token proves the hub minted it. It does not prove the hub still stands
 * behind it: in the token's seven days the person can sign out, be revoked, or
 * have the account deleted, and a service that trusts the signature alone never
 * learns. Somebody whose account had been removed was still getting in on a
 * cookie issued before it went.
 *
 * The hub records every session and stamps the token with its id (`jti`). This
 * asks the hub, on the same machine, whether that id is still live.
 *
 * Three answers. true and false are the hub's word. null means the hub could
 * not be asked -- not answering -- and the caller trusts the signature, which
 * is the fleet's convention: a hub outage must not sign everyone out of every
 * service at once. It also means revocation depends on the hub being up.
 */

const DEFAULT_HUB = "http://127.0.0.1:8021";

export async function sessionIsActive(sessionId, { timeoutMs = 2000 } = {}) {
  const base = (process.env.HUB_INTERNAL_URL || DEFAULT_HUB).replace(/\/+$/, "");
  if (/^(0|false|off)$/i.test(String(process.env.HUB_SESSION_CHECK || "1"))) return null;
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const response = await fetch(
      `${base}/api/identity/sessions/${encodeURIComponent(sessionId)}/active`,
      { signal: controller.signal }
    );
    if (!response.ok) return null;
    const body = await response.json();
    return body.active === true;
  } catch (error) {
    console.warn(`hub session check unavailable: ${String(error && error.message).slice(0, 120)}`);
    return null;
  } finally {
    clearTimeout(timer);
  }
}

/** Throw if the hub says this token's session is gone; otherwise pass it through. */
export async function rejectRevoked(payload) {
  const sessionId = payload && payload.jti;
  if (sessionId && (await sessionIsActive(String(sessionId))) === false) {
    const error = new Error("Session revoked at the hub");
    error.status = 401;
    throw error;
  }
  return payload;
}
