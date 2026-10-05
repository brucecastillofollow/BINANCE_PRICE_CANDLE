import assert from "node:assert/strict";
import test from "node:test";
import jwt from "jsonwebtoken";
import { config } from "../src/config.js";
import { pool } from "../src/db.js";
import { createAuthRouter, requireAuth } from "../src/routes/auth.js";
import {
  HUB_ONLY_HASH,
  ensureUserFromIdentity,
  linkLegacyUser,
} from "../src/auth/store.js";
import { createToken, getBearerToken, hashPassword } from "../src/auth/utils.js";

const legacyId = "11111111-1111-4111-8111-111111111111";
const hubId = "22222222-2222-4222-8222-222222222222";
const otherHubId = "33333333-3333-4333-8333-333333333333";
const projectId = "44444444-4444-4444-8444-444444444444";

function withMemoryUsers(initialUsers, run) {
  const originalQuery = pool.query;
  const originalConnect = pool.connect;
  const users = initialUsers.map((user) => ({ ...user }));

  async function query(sql, values = []) {
    const statement = String(sql).replace(/\s+/g, " ").trim();
    if (statement === "BEGIN" || statement === "COMMIT" || statement === "ROLLBACK") {
      return { rows: [] };
    }
    if (statement.includes("FROM projects WHERE slug = $1")) {
      return { rows: [{ id: projectId, slug: "binance" }] };
    }
    if (statement.startsWith("INSERT INTO project_members")) return { rows: [] };
    if (statement.includes("SELECT COUNT(*)::int AS cnt FROM invites")) {
      return { rows: [{ cnt: 0 }] };
    }
    if (statement.includes("FROM users WHERE hub_user_id = $1")) {
      return { rows: users.filter((user) => user.hub_user_id === values[0]).map((user) => ({ ...user })) };
    }
    if (statement.includes("FROM users WHERE email = $1")) {
      return { rows: users.filter((user) => user.email === values[0]).map((user) => ({ ...user })) };
    }
    if (statement.includes("FROM users WHERE id = $1")) {
      return { rows: users.filter((user) => user.id === values[0]).map((user) => ({ ...user })) };
    }
    if (statement.startsWith("UPDATE users SET hub_user_id = $1")) {
      const user = users.find((row) => row.id === values[1] && row.hub_user_id === null);
      if (!user) return { rows: [] };
      user.hub_user_id = values[0];
      return { rows: [{ id: user.id, email: user.email }] };
    }
    if (statement.startsWith("INSERT INTO users")) {
      const user = { id: values[0], email: values[1], password_hash: values[2], hub_user_id: values[0] };
      users.push(user);
      return { rows: [{ ...user }] };
    }
    throw new Error(`Unexpected query: ${statement}`);
  }

  pool.query = query;
  pool.connect = async () => ({ query, release() {} });
  return Promise.resolve()
    .then(() => run(users))
    .finally(() => {
      pool.query = originalQuery;
      pool.connect = originalConnect;
    });
}

test("legacy row requires its old password and keeps its UUID and data after linking", async () => {
  await withMemoryUsers(
    [{ id: legacyId, email: "legacy@example.test", password_hash: hashPassword("old-password"), hub_user_id: null }],
    async (users) => {
      const originalHash = users[0].password_hash;
      await assert.rejects(
        ensureUserFromIdentity(hubId, "legacy@example.test"),
        (error) => error.code === "link_required" && error.email === "legacy@example.test"
      );
      assert.equal((await linkLegacyUser(hubId, "legacy@example.test", "wrong")).code, "bad_password");
      assert.equal(users[0].hub_user_id, null);

      const result = await linkLegacyUser(hubId, "legacy@example.test", "old-password");
      assert.equal(result.code, "linked");
      assert.equal(result.user.id, legacyId);
      assert.equal(users[0].hub_user_id, hubId);
      assert.equal(users[0].password_hash, originalHash);
      assert.equal((await ensureUserFromIdentity(hubId, "legacy@example.test")).id, legacyId);
      await assert.rejects(
        ensureUserFromIdentity(otherHubId, "legacy@example.test"),
        (error) => error.code === "identity_conflict"
      );
    }
  );
});

test("new hub rows bind to their hub UUID instead of adopting by email", async () => {
  await withMemoryUsers([], async (users) => {
    const user = await ensureUserFromIdentity(hubId, "new@example.test");
    assert.equal(user.id, hubId);
    assert.equal(users[0].hub_user_id, hubId);
    await assert.rejects(
      ensureUserFromIdentity(otherHubId, "new@example.test"),
      (error) => error.code === "identity_conflict"
    );
  });
});

test("Binance reads the hub cookie ahead of a stale generic cookie", () => {
  const request = {
    headers: {},
    cookies: { access_token: "stale", ww_access_token: "hub-session" },
  };
  assert.equal(getBearerToken(request), "hub-session");
  assert.equal(getBearerToken({ ...request, headers: { authorization: "Bearer api-session" } }), "api-session");
});

function callHandler(handler, request) {
  return new Promise((resolve, reject) => {
    const response = {
      statusCode: 200,
      status(code) { this.statusCode = code; return this; },
      json(body) { resolve({ status: this.statusCode, body }); return this; },
    };
    try {
      Promise.resolve(handler(request, response, (error) => {
        if (error) reject(error);
        else resolve({ next: true, auth: request.auth });
      })).catch(reject);
    } catch (error) {
      reject(error);
    }
  });
}

test("link route requires a valid hub session and exposes the legacy link step", async () => {
  await withMemoryUsers(
    [{ id: legacyId, email: "legacy@example.test", password_hash: hashPassword("old-password"), hub_user_id: null }],
    async (users) => {
      const linkHandler = createAuthRouter().stack.find((layer) => layer.route?.path === "/link").route.stack[1].handle;
      const token = createToken({ userId: hubId, projectId, email: "legacy@example.test" });
      const request = (sessionToken, password) => ({
        headers: {},
        cookies: sessionToken ? { ww_access_token: sessionToken } : {},
        body: { password },
        ip: "127.0.0.1",
      });
      assert.equal((await callHandler(linkHandler, request("", "old-password"))).status, 401);
      assert.equal((await callHandler(linkHandler, request("invalid", "old-password"))).status, 401);

      const probe = await callHandler(requireAuth, request(token));
      assert.equal(probe.status, 401);
      assert.equal(probe.body.code, "link_required");
      assert.equal(probe.body.redirect, undefined);

      assert.equal((await callHandler(linkHandler, request(token, "wrong"))).status, 401);
      assert.equal(users[0].hub_user_id, null);
      assert.equal((await callHandler(linkHandler, request(token, "old-password"))).status, 200);
      const linkedProbe = await callHandler(requireAuth, request(token));
      assert.equal(linkedProbe.next, true);
      assert.equal(linkedProbe.auth.userId, legacyId);

      const revoked = jwt.sign(
        { sub: otherHubId, email: "legacy@example.test", iss: "weienwong.online", jti: "revoked-session" },
        config.authJwtSecret,
        { expiresIn: "1h" }
      );
      const priorFetch = global.fetch;
      const priorCheck = process.env.HUB_SESSION_CHECK;
      process.env.HUB_SESSION_CHECK = "1";
      global.fetch = (url, options) => {
        if (String(url).includes("/api/identity/sessions/revoked-session/active")) {
          return Promise.resolve(new Response(JSON.stringify({ active: false }), { status: 200 }));
        }
        return priorFetch(url, options);
      };
      try {
        assert.equal((await callHandler(linkHandler, request(revoked, "old-password"))).status, 401);
      } finally {
        global.fetch = priorFetch;
        if (priorCheck === undefined) delete process.env.HUB_SESSION_CHECK;
        else process.env.HUB_SESSION_CHECK = priorCheck;
      }
    }
  );
});
