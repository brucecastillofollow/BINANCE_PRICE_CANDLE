import crypto from "node:crypto";
import bcrypt from "bcryptjs";
import jwt from "jsonwebtoken";
import pg from "pg";

const { Pool } = pg;
const WINDOW_MS = 15 * 60 * 1000;
const DUMMY_HASH = bcrypt.hashSync("no-such-shared-account-password", 10);
const BANNED = new Set([
  "123456789012", "changeme1234", "iloveyou1234", "letmein12345",
  "password1234", "passw0rd1234", "qwerty123456", "qwertyuiop12",
  "welcome12345", "admin1234567", "weienwong123", "abcdefghijkl",
  "111111111111", "000000000000",
]);
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

export function normalizeIdentityEmail(value) {
  if (typeof value !== "string") return "";
  const email = value.trim().toLowerCase();
  return email.length <= 254 && /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email) ? email : "";
}

export function identityPasswordError(value, email) {
  if (typeof value !== "string" || value.length < 12 ||
      value.trim().length < 12 || value.length > 128 ||
      Buffer.byteLength(value, "utf8") > 72) {
    return "Password must be at least 12 characters and at most 72 UTF-8 bytes.";
  }
  const folded = value.trim().toLowerCase();
  if (BANNED.has(folded) || new Set(value.trim()).size < 5 ||
      (email.split("@", 1)[0].length >= 3 && folded.includes(email.split("@", 1)[0]))) {
    return "Choose a stronger password that does not contain your email name.";
  }
  return "";
}

function throttleKey(kind, ip, email = "") {
  const suffix = kind === "ip+acct" ? `|${email}` : "";
  return crypto.createHash("sha256").update(`v1|${kind}|${ip}${suffix}`).digest("hex");
}

export class SharedIdentity {
  constructor({ databaseUrl, secret, cookieName = "ww_access_token", expireDays = 7, appBaseUrl,
    pool = null }) {
    this.databaseUrl = databaseUrl;
    this.secret = secret;
    this.cookieName = cookieName;
    this.expireDays = Number.isInteger(expireDays) && expireDays > 0 ? expireDays : 7;
    this.appBaseUrl = appBaseUrl;
    this.pool = pool || (databaseUrl ? new Pool({ connectionString: databaseUrl, max: 5,
      connectionTimeoutMillis: 3000 }) : null);
  }

  available() { return Boolean(this.pool); }

  cookieOptions(req) {
    let hostname = "";
    let protocol = "";
    try {
      const parsed = new URL(this.appBaseUrl);
      hostname = parsed.hostname;
      protocol = parsed.protocol;
    } catch { /* Invalid deployment URL is handled by the application. */ }
    const publicHost = (hostname === "weienwong.online" || hostname.endsWith(".weienwong.online")) &&
      (req.hostname === "weienwong.online" || String(req.hostname || "").endsWith(".weienwong.online"));
    return {
      httpOnly: true,
      secure: Boolean(req.secure || (protocol === "https:" && publicHost)),
      sameSite: "lax",
      path: "/",
      ...(publicHost ? { domain: ".weienwong.online" } : {}),
      maxAge: this.expireDays * 86400 * 1000,
    };
  }

  setCookie(req, res, token) {
    res.cookie(this.cookieName, token, this.cookieOptions(req));
  }

  clearCookie(req, res) {
    const { maxAge: _maxAge, ...options } = this.cookieOptions(req);
    res.clearCookie(this.cookieName, options);
  }

  async reserveAttempt(kind, ip, email, limit) {
    const key = throttleKey(kind, ip, email);
    const { rows } = await this.pool.query(
      `INSERT INTO identity_auth_attempts (key_hash, attempts) VALUES ($1, 1)
       ON CONFLICT (key_hash) DO UPDATE SET
         attempts = CASE WHEN identity_auth_attempts.window_started_at < NOW() - INTERVAL '15 minutes'
           THEN 1 ELSE identity_auth_attempts.attempts + 1 END,
         window_started_at = CASE WHEN identity_auth_attempts.window_started_at < NOW() - INTERVAL '15 minutes'
           THEN NOW() ELSE identity_auth_attempts.window_started_at END
       RETURNING attempts, window_started_at`,
      [key]
    );
    const row = rows[0];
    const retryAfter = Math.max(1, Math.ceil((new Date(row.window_started_at).getTime() + WINDOW_MS - Date.now()) / 1000));
    return { allowed: row.attempts <= limit, key, retryAfter };
  }

  async register({ email, password, ip = "unknown", userAgent = "" }) {
    if (!this.available()) return { code: "unavailable" };
    email = normalizeIdentityEmail(email);
    if (!email) return { code: "invalid_email" };
    const passwordError = identityPasswordError(password, email);
    if (passwordError) return { code: "invalid_password", message: passwordError };
    const attempt = await this.reserveAttempt("signup", ip, "", 10);
    if (!attempt.allowed) return { code: "throttled", retryAfter: attempt.retryAfter };
    password = password.trim();
    const userId = crypto.randomUUID();
    const sessionId = crypto.randomUUID();
    const client = await this.pool.connect();
    try {
      await client.query("BEGIN");
      await client.query(
        "INSERT INTO identity_users (id, email, password_hash) VALUES ($1, $2, $3)",
        [userId, email, bcrypt.hashSync(password, 12)]
      );
      await client.query(
        "INSERT INTO identity_service_access (user_id, service_key) VALUES ($1, 'all') ON CONFLICT DO NOTHING",
        [userId]
      );
      await this.insertSession(client, sessionId, userId, userAgent, ip);
      await client.query("COMMIT");
      return { code: "ok", user: { id: userId, email }, token: this.tokenFor(userId, email, sessionId) };
    } catch (error) {
      await client.query("ROLLBACK");
      if (error.code === "23505") return { code: "exists" };
      throw error;
    } finally { client.release(); }
  }

  async importLegacy({ userId, email, passwordHash, ip = "unknown", userAgent = "" }) {
    if (!this.available()) return { code: "unavailable" };
    email = normalizeIdentityEmail(email);
    if (!email || !UUID.test(String(userId)) || !/^\$2[aby]\$/.test(String(passwordHash))) {
      return { code: "invalid_input" };
    }
    const sessionId = crypto.randomUUID();
    const client = await this.pool.connect();
    try {
      await client.query("BEGIN");
      await client.query("INSERT INTO identity_users (id, email, password_hash) VALUES ($1, $2, $3)",
        [userId, email, passwordHash]);
      await client.query(
        "INSERT INTO identity_service_access (user_id, service_key) VALUES ($1, 'all') ON CONFLICT DO NOTHING",
        [userId]);
      await this.insertSession(client, sessionId, userId, userAgent, ip);
      await client.query("COMMIT");
      return { code: "ok", user: { id: userId, email }, token: this.tokenFor(userId, email, sessionId) };
    } catch (error) {
      await client.query("ROLLBACK");
      if (error.code === "23505") return { code: "exists" };
      throw error;
    } finally { client.release(); }
  }

  async login({ email, password, ip = "unknown", userAgent = "" }) {
    if (!this.available()) return { code: "unavailable" };
    email = normalizeIdentityEmail(email);
    if (!email || typeof password !== "string" || !password || password.length > 1024) {
      return { code: "invalid_input" };
    }
    const ipAttempt = await this.reserveAttempt("ip", ip, "", 10);
    const accountAttempt = await this.reserveAttempt("ip+acct", ip, email, 5);
    if (!ipAttempt.allowed || !accountAttempt.allowed) {
      return { code: "throttled", retryAfter: Math.max(ipAttempt.retryAfter, accountAttempt.retryAfter) };
    }
    const { rows } = await this.pool.query(
      "SELECT id, email, password_hash, disabled_at FROM identity_users WHERE lower(email) = lower($1)",
      [email]
    );
    const user = rows[0];
    const valid = bcrypt.compareSync(password, user?.password_hash || DUMMY_HASH);
    if (!user || !valid) return { code: "invalid_credentials" };
    if (user.disabled_at) return { code: "disabled" };
    const sessionId = crypto.randomUUID();
    await this.insertSession(this.pool, sessionId, user.id, userAgent, ip);
    await this.pool.query("UPDATE identity_auth_attempts SET attempts = GREATEST(0, attempts - 1) WHERE key_hash = ANY($1::text[])",
      [[ipAttempt.key, accountAttempt.key]]);
    return { code: "ok", user: { id: user.id, email: user.email },
      token: this.tokenFor(user.id, user.email, sessionId) };
  }

  async insertSession(db, sessionId, userId, userAgent, ip) {
    await db.query(
      `INSERT INTO identity_sessions (id, user_id, expires_at, user_agent, ip_address)
       VALUES ($1, $2, NOW() + ($3::int * INTERVAL '1 day'), $4, $5)`,
      [sessionId, userId, this.expireDays, String(userAgent).slice(0, 500), String(ip).slice(0, 64)]
    );
  }

  tokenFor(userId, email, sessionId) {
    return jwt.sign({ sub: userId, email, iss: "weienwong.online", jti: sessionId },
      this.secret, { algorithm: "HS256", expiresIn: `${this.expireDays}d` });
  }

  async validateSession(payload) {
    if (!this.available() || !UUID.test(String(payload?.sub || "")) ||
        !UUID.test(String(payload?.jti || ""))) return null;
    const { rows } = await this.pool.query(
      `SELECT u.id, u.email FROM identity_sessions s
       JOIN identity_users u ON u.id = s.user_id
       WHERE s.id = $1 AND s.user_id = $2 AND s.revoked_at IS NULL
         AND s.expires_at > NOW() AND u.disabled_at IS NULL`,
      [payload.jti, payload.sub]
    );
    return rows[0] || null;
  }

  async revokeSession(sessionId) {
    if (!this.available() || !UUID.test(String(sessionId || ""))) return;
    await this.pool.query("UPDATE identity_sessions SET revoked_at = NOW() WHERE id = $1", [sessionId]);
  }

  async changePassword({ userId, currentPassword, newPassword, keepSessionId }) {
    if (!this.available()) return { code: "unavailable" };
    const client = await this.pool.connect();
    try {
      await client.query("BEGIN");
      const { rows } = await client.query(
        "SELECT id, email, password_hash, disabled_at FROM identity_users WHERE id = $1 FOR UPDATE",
        [userId]
      );
      const user = rows[0];
      if (!user || user.disabled_at || typeof currentPassword !== "string" ||
          !bcrypt.compareSync(currentPassword, user.password_hash)) {
        await client.query("ROLLBACK");
        return { code: "invalid_credentials" };
      }
      const error = identityPasswordError(newPassword, user.email);
      if (error) {
        await client.query("ROLLBACK");
        return { code: "invalid_password", message: error };
      }
      await client.query("UPDATE identity_users SET password_hash = $1 WHERE id = $2",
        [bcrypt.hashSync(newPassword.trim(), 12), userId]);
      await client.query(
        "UPDATE identity_sessions SET revoked_at = NOW() WHERE user_id = $1 AND id <> $2 AND revoked_at IS NULL",
        [userId, keepSessionId]
      );
      await client.query("COMMIT");
      return { code: "ok" };
    } catch (error) {
      await client.query("ROLLBACK");
      throw error;
    } finally { client.release(); }
  }
}
