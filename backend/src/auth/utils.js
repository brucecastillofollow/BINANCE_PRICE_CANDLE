import jwt from "jsonwebtoken";
import crypto from "crypto";
import bcrypt from "bcryptjs";
import { config } from "../config.js";
import {
  AUTH_COOKIE_NAME,
  AUTH_ISSUER,
  createIdentityToken,
  decodeIdentityToken,
  getTokenFromRequest,
} from "/mnt/social_dataset/shared_auth/node/index.js";

export { AUTH_COOKIE_NAME, getTokenFromRequest };

export function hashPassword(password) {
  return bcrypt.hashSync(password, 10);
}

export function verifyPassword(password, hash) {
  return bcrypt.compareSync(password, hash);
}

export function createToken({ userId, projectId, email }) {
  return createIdentityToken({
    userId,
    email,
    secret: config.authJwtSecret,
    expireDays: config.jwtExpireDays,
    extraClaims: { project_id: projectId },
  });
}

export function decodeToken(token) {
  try {
    return decodeIdentityToken(token, config.authJwtSecret);
  } catch {
    return jwt.verify(token, config.jwtSecret);
  }
}

export function generateInviteToken() {
  return crypto.randomBytes(24).toString("base64url");
}

export function getBearerToken(req) {
  return getTokenFromRequest(req, config.authCookieName);
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

export function getAdminTokenFromRequest(req) {
  const headerKey = req.headers["x-admin-key"];
  if (config.adminApiKey && headerKey && headerKey === config.adminApiKey) {
    return { via: "api_key", username: "api-key" };
  }
  const cookieName = config.adminCookieName;
  const token = req.cookies?.[cookieName];
  if (!token) return null;
  try {
    const payload = decodeAdminToken(token);
    return { via: "cookie", username: String(payload.sub || "admin"), token };
  } catch {
    return null;
  }
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
