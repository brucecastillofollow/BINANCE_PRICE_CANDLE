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
