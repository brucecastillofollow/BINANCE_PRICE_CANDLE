import jwt from "jsonwebtoken";
import crypto from "crypto";
import bcrypt from "bcryptjs";
import { config } from "../config.js";

// Keep the optional hub token format here. Binance's local login must boot and
// continue working even when the separate social_dataset checkout is absent.
export const AUTH_COOKIE_NAME = "ww_access_token";
export const AUTH_ISSUER = "weienwong.online";
const LOCAL_ISSUER = "binance-price-candle";
const LOCAL_AUDIENCE = "binance-price-candle-user";
const LOCAL_TOKEN_TYPE = "local_user";
const localSigningKey = crypto.createHmac("sha256", config.jwtSecret)
  .update("binance-price-candle/local-user-jwt/v1")
  .digest("hex");

function decodeIdentityToken(token, secret) {
  const payload = jwt.verify(token, secret, {
    algorithms: ["HS256"],
    issuer: [AUTH_ISSUER, `https://${AUTH_ISSUER}`],
  });
  if (!payload.iss) throw new Error("Invalid token issuer");
  return payload;
}

export function hashPassword(password) {
  return bcrypt.hashSync(password, 10);
}

export function verifyPassword(password, hash) {
  return bcrypt.compareSync(password, hash);
}

export function createToken({ userId, projectId, email }) {
  return jwt.sign({
    sub: userId,
    email,
    iss: AUTH_ISSUER,
    project_id: projectId,
  }, config.authJwtSecret, { algorithm: "HS256", expiresIn: `${config.jwtExpireDays}d` });
}

export function createLocalToken(user) {
  return jwt.sign(
    { sub: user.id, type: LOCAL_TOKEN_TYPE, sv: user.local_session_version },
    localSigningKey,
    {
      algorithm: "HS256",
      issuer: LOCAL_ISSUER,
      audience: LOCAL_AUDIENCE,
      expiresIn: `${config.jwtExpireDays}d`,
      jwtid: crypto.randomUUID(),
    }
  );
}

export function decodeLocalToken(token) {
  const payload = jwt.verify(token, localSigningKey, {
    algorithms: ["HS256"],
    issuer: LOCAL_ISSUER,
    audience: LOCAL_AUDIENCE,
  });
  if (payload.type !== LOCAL_TOKEN_TYPE ||
      !/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(String(payload.sub || "")) ||
      !Number.isSafeInteger(payload.sv) || payload.sv < 0 ||
      !/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(String(payload.jti || ""))) {
    throw new Error("Invalid local token claims");
  }
  return payload;
}

export function localSessionHash(sessionId) {
  return crypto.createHmac("sha256", localSigningKey)
    .update(`session:${sessionId}`)
    .digest("hex");
}

export function getLocalToken(req) {
  const token = req.cookies?.[config.localAuthCookieName];
  return typeof token === "string" && token ? token : "";
}

export function localCookieOptions(req) {
  // Nginx may not forward X-Forwarded-Proto to this backend. The configured
  // public HTTPS host is enough to know its cookie must be Secure, while local
  // HTTP Vite development still needs an ordinary host-only cookie.
  let publicHttpsHost = "";
  try {
    const publicUrl = new URL(config.appBaseUrl);
    if (publicUrl.protocol === "https:") publicHttpsHost = publicUrl.hostname;
  } catch { /* validateEnv handles the deployment configuration. */ }
  return {
    httpOnly: true,
    secure: Boolean(req.secure || (publicHttpsHost && req.hostname === publicHttpsHost)),
    sameSite: "lax",
    path: "/",
    maxAge: Math.max(1, config.jwtExpireDays) * 24 * 60 * 60 * 1000,
  };
}

export function localAttemptKey(ip, email) {
  return crypto.createHmac("sha256", localSigningKey)
    .update(`${ip}|${email}`)
    .digest("hex");
}

// Verify a hub identity token. Anything else throws.
//
// The JWT_SECRET fall-back that used to sit in the catch is gone. It verified
// with no issuer and no required claims, so a token with no exp never expired;
// and because authJwtSecret falls back to JWT_SECRET when AUTH_JWT_SECRET is
// unset, wherever that default applied it re-judged, under weaker rules, the
// very token decodeIdentityToken had just rejected.
//
// It also crossed two token types that are meant to stay apart: createAdminToken
// signs with jwtSecret, so an admin session token verified here and was handed
// to requireAuth as an ordinary identity, with the admin's username as `sub`.
// Admin tokens have their own decoder -- decodeAdminToken -- which checks role.
export function decodeToken(token) {
  return decodeIdentityToken(token, config.authJwtSecret);
}

export function generateInviteToken() {
  return crypto.randomBytes(24).toString("base64url");
}

export function getBearerToken(req) {
  const authorization = String(req.headers?.authorization || "");
  if (authorization.startsWith("Bearer ")) {
    const bearer = authorization.slice(7).trim();
    if (bearer && bearer !== "cookie") return bearer;
  }
  // Binance's old local login stored its token in localStorage, not a cookie.
  // Prefer the hub's named cookie so a stale generic access_token from another
  // service cannot shadow a valid hub session here.
  const cookie = req.cookies?.[config.authCookieName];
  return typeof cookie === "string" && cookie && cookie !== "cookie" ? cookie : "";
}

export function hubLoginUrl(returnTo = "") {
  const base = `${config.hubAuthUrl}/login`;
  if (!returnTo) return base;
  return `${base}?return_to=${encodeURIComponent(returnTo)}`;
}

export function createAdminToken(username) {
  const hours = Math.max(1, Number(config.adminSessionHours) || 12);
  return jwt.sign(
    { role: "admin", sub: username },
    config.jwtSecret,
    { expiresIn: `${hours}h` }
  );
}

export function decodeAdminToken(token) {
  const payload = jwt.verify(token, config.jwtSecret);
  if (payload?.role !== "admin") {
    throw new Error("Not an admin token");
  }
  return payload;
}

export function adminEmails() {
  return new Set(
    String(config.adminEmails || "")
      .split(",")
      .map((s) => s.trim().toLowerCase())
      .filter(Boolean)
  );
}

export function isAdminEmail(email) {
  const listed = adminEmails();
  return Boolean(email) && listed.has(String(email).trim().toLowerCase());
}

export function getAdminTokenFromRequest(req) {
  const headerKey = req.headers["x-admin-key"];
  if (config.adminApiKey && headerKey && headerKey === config.adminApiKey) {
    return { via: "api_key", username: "api-key" };
  }
  const cookieName = config.adminCookieName;
  const token = req.cookies?.[cookieName];
  if (token) {
    try {
      const payload = decodeAdminToken(token);
      return { via: "cookie", username: String(payload.sub || "admin"), token };
    } catch {
      // Not an admin session; fall through to the hub allowlist below.
    }
  }

  // A hub identity listed in ADMIN_EMAILS is an administrator here -- the same
  // env-driven allowlist the rest of the fleet uses. Checked last, so the
  // dedicated admin session and API key keep working exactly as before.
  if (adminEmails().size) {
    const hubToken = getBearerToken(req);
    if (hubToken) {
      try {
        const identity = decodeIdentityToken(hubToken, config.authJwtSecret);
        const email = String(identity.email || "").trim().toLowerCase();
        if (email && adminEmails().has(email)) {
          return { via: "hub_identity", username: email };
        }
      } catch {
        // Not a valid hub token, so not an administrator by this route.
      }
    }
  }
  return null;
}

export function adminCookieOptions() {
  const hours = Math.max(1, Number(config.adminSessionHours) || 12);
  const secure =
    process.env.ADMIN_COOKIE_SECURE === "1" ||
    String(config.appBaseUrl || "").startsWith("https://");
  return {
    httpOnly: true,
    secure,
    sameSite: "lax",
    path: "/",
    maxAge: hours * 60 * 60 * 1000,
  };
}
