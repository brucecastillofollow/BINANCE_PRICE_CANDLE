import assert from "node:assert/strict";
import test from "node:test";
import jwt from "jsonwebtoken";
import { SharedIdentity } from "../src/auth/sharedIdentity.js";

function memoryPool() {
  const users = new Map();
  const sessions = new Map();
  const attempts = new Map();
  const query = async (sql, values = []) => {
    const statement = String(sql).replace(/\s+/g, " ").trim();
    if (["BEGIN", "COMMIT", "ROLLBACK"].includes(statement)) return { rows: [] };
    if (statement.startsWith("INSERT INTO identity_auth_attempts")) {
      const previous = attempts.get(values[0]) || { attempts: 0, window_started_at: new Date() };
      const row = { ...previous, attempts: previous.attempts + 1 };
      attempts.set(values[0], row);
      return { rows: [row] };
    }
    if (statement.startsWith("UPDATE identity_auth_attempts")) {
      for (const key of values[0]) {
        const row = attempts.get(key);
        if (row) row.attempts = Math.max(0, row.attempts - 1);
      }
      return { rows: [] };
    }
    if (statement.startsWith("INSERT INTO identity_users")) {
      if ([...users.values()].some((user) => user.email === values[1])) {
        const error = new Error("duplicate email"); error.code = "23505"; throw error;
      }
      users.set(values[0], { id: values[0], email: values[1], password_hash: values[2], disabled_at: null });
      return { rows: [] };
    }
    if (statement.startsWith("INSERT INTO identity_service_access")) return { rows: [] };
    if (statement.startsWith("INSERT INTO identity_sessions")) {
      sessions.set(values[0], { id: values[0], user_id: values[1], revoked_at: null });
      return { rows: [] };
    }
    if (statement.includes("FROM identity_users WHERE lower(email)")) {
      return { rows: [...users.values()].filter((user) => user.email === values[0]) };
    }
    if (statement.includes("FROM identity_users WHERE id = $1 FOR UPDATE")) {
      return { rows: users.has(values[0]) ? [users.get(values[0])] : [] };
    }
    if (statement.startsWith("UPDATE identity_users SET password_hash")) {
      users.get(values[1]).password_hash = values[0];
      return { rows: [] };
    }
    if (statement.includes("FROM identity_sessions s JOIN identity_users u")) {
      const session = sessions.get(values[0]);
      const user = session && users.get(session.user_id);
      return { rows: session && !session.revoked_at && session.user_id === values[1] &&
        user && !user.disabled_at ? [{ id: user.id, email: user.email }] : [] };
    }
    if (statement.startsWith("UPDATE identity_sessions SET revoked_at")) {
      if (statement.includes("WHERE user_id")) {
        for (const session of sessions.values()) {
          if (session.user_id === values[0] && session.id !== values[1]) session.revoked_at = new Date();
        }
      } else {
        const session = sessions.get(values[0]);
        if (session) session.revoked_at = new Date();
      }
      return { rows: [] };
    }
    throw new Error(`Unexpected query: ${statement}`);
  };
  return { query, connect: async () => ({ query, release() {} }), users, sessions, attempts };
}

test("an account created on one project signs in on another without the Hub web service", async () => {
  const pool = memoryPool();
  const shared = { pool, secret: "shared-identity-test-secret-32-chars", expireDays: 7 };
  const binance = new SharedIdentity({ ...shared, appBaseUrl: "https://cryptodataset.weienwong.online" });
  const sportbet = new SharedIdentity({ ...shared, appBaseUrl: "https://sport.weienwong.online" });
  const created = await binance.register({ email: " Person@Example.test ",
    password: "Distinct-Long-Secret-47", ip: "192.0.2.1" });
  assert.equal(created.code, "ok");
  assert.equal(created.user.email, "person@example.test");
  const createdClaims = jwt.verify(created.token, shared.secret, { issuer: "weienwong.online" });
  assert.ok(await sportbet.validateSession(createdClaims));

  const login = await sportbet.login({ email: "person@example.test",
    password: "Distinct-Long-Secret-47", ip: "192.0.2.2" });
  assert.equal(login.code, "ok");
  const claims = jwt.verify(login.token, shared.secret, { issuer: "weienwong.online" });
  assert.ok(await binance.validateSession(claims));
  const cookie = sportbet.cookieOptions({ hostname: "sport.weienwong.online", secure: false });
  assert.equal(cookie.domain, ".weienwong.online");
  assert.equal(cookie.secure, true);
  assert.equal(sportbet.cookieOptions({ hostname: "api.weienwong.online", secure: false }).secure, true);
  await binance.revokeSession(claims.jti);
  assert.equal(await sportbet.validateSession(claims), null);
});

test("changing a shared password requires the old password and revokes other sessions", async () => {
  const pool = memoryPool();
  const secret = "shared-identity-test-secret-32-chars";
  const identity = new SharedIdentity({ pool, secret, appBaseUrl: "https://cryptodataset.weienwong.online" });
  const created = await identity.register({ email: "owner@example.test",
    password: "Distinct-Long-Secret-47", ip: "192.0.2.5" });
  const second = await identity.login({ email: "owner@example.test",
    password: "Distinct-Long-Secret-47", ip: "192.0.2.6" });
  const currentClaims = jwt.verify(created.token, secret);
  const otherClaims = jwt.verify(second.token, secret);
  const wrong = await identity.changePassword({ userId:created.user.id,
    currentPassword:"wrong", newPassword:"Another-Distinct-Secret-58",
    keepSessionId:currentClaims.jti });
  assert.equal(wrong.code, "invalid_credentials");
  const changed = await identity.changePassword({ userId:created.user.id,
    currentPassword:"Distinct-Long-Secret-47", newPassword:"Another-Distinct-Secret-58",
    keepSessionId:currentClaims.jti });
  assert.equal(changed.code, "ok");
  assert.ok(await identity.validateSession(currentClaims));
  assert.equal(await identity.validateSession(otherClaims), null);
  assert.equal((await identity.login({ email:"owner@example.test",
    password:"Distinct-Long-Secret-47", ip:"192.0.2.7" })).code, "invalid_credentials");
  assert.equal((await identity.login({ email:"owner@example.test",
    password:"Another-Distinct-Secret-58", ip:"192.0.2.7" })).code, "ok");
});

test("successful login cannot erase an IP's previous failed password attempts", async () => {
  const pool = memoryPool();
  const identity = new SharedIdentity({ pool, secret: "shared-identity-test-secret-32-chars",
    appBaseUrl: "https://sport.weienwong.online" });
  await identity.register({ email: "owner@example.test", password: "Distinct-Long-Secret-47", ip: "192.0.2.3" });
  for (let n = 0; n < 3; n++) {
    assert.equal((await identity.login({ email: "guess@example.test", password: "wrong", ip: "192.0.2.4" })).code,
      "invalid_credentials");
  }
  assert.equal((await identity.login({ email: "owner@example.test",
    password: "Distinct-Long-Secret-47", ip: "192.0.2.4" })).code, "ok");
  const ipFailures = [...pool.attempts.values()].find((row) => row.attempts === 3);
  assert.ok(ipFailures, "three prior IP failures remain after valid account login");
});
