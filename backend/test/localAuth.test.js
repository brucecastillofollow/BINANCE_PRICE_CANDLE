import assert from "node:assert/strict";
import crypto from "node:crypto";
import test from "node:test";
import jwt from "jsonwebtoken";
import { createApp } from "../src/app.js";
import { pool } from "../src/db.js";
import { config } from "../src/config.js";
import { HUB_ONLY_HASH } from "../src/auth/store.js";
import { createToken, hashPassword, localCookieOptions } from "../src/auth/utils.js";

const projectId = "44444444-4444-4444-8444-444444444444";
const legacyId = "11111111-1111-4111-8111-111111111111";
const hubId = "22222222-2222-4222-8222-222222222222";

async function withServer(initialUsers, run, { hubInitiallyActive = false } = {}) {
  const users = initialUsers.map((user) => ({ local_session_version: 0, ...user }));
  const attempts = new Map();
  const sessions = new Map();
  const originalQuery = pool.query;
  const originalConnect = pool.connect;
  const nativeFetch = global.fetch;
  let hubCalls = 0;
  let hubActive = hubInitiallyActive;
  const invite = {
    id: crypto.randomUUID(), project_id: projectId,
    email: "legacy@example.test", token: "private-invite-token",
    accepted_at: null, expires_at: new Date(Date.now() + 60_000),
  };

  async function query(sql, values = []) {
    const statement = String(sql).replace(/\s+/g, " ").trim();
    if (["BEGIN", "COMMIT", "ROLLBACK"].includes(statement)) return { rows: [] };
    if (statement.startsWith("INSERT INTO local_auth_attempts")) {
      const count = (attempts.get(values[0]) || 0) + 1;
      attempts.set(values[0], count);
      return { rows: [{ attempts: count }] };
    }
    if (statement.startsWith("DELETE FROM local_auth_attempts")) {
      attempts.delete(values[0]);
      return { rows: [] };
    }
    if (statement.startsWith("DELETE FROM local_auth_sessions WHERE expires_at")) {
      return { rows: [] };
    }
    if (statement.startsWith("INSERT INTO local_auth_sessions")) {
      sessions.set(values[0], { userId: values[1], expiresAt: values[2], revoked: false });
      return { rows: [] };
    }
    if (statement.includes("SELECT 1 FROM local_auth_sessions")) {
      const session = sessions.get(values[0]);
      return { rows: session && session.userId === values[1] && !session.revoked &&
        session.expiresAt > Date.now() / 1000 ? [{ "?column?": 1 }] : [] };
    }
    if (statement.startsWith("UPDATE local_auth_sessions SET revoked_at")) {
      const session = sessions.get(values[0]);
      if (session) session.revoked = true;
      return { rows: [] };
    }
    if (statement.includes("FROM projects WHERE slug = $1")) {
      return { rows: [{ id: projectId, slug: "binance" }] };
    }
    if (statement.startsWith("INSERT INTO project_members")) return { rows: [] };
    if (statement.includes("SELECT COUNT(*)::int AS cnt FROM invites")) {
      return { rows: [{ cnt: 0 }] };
    }
    if (statement.includes("FROM users WHERE email = $1")) {
      return { rows: users.filter((user) => user.email === values[0]).map((user) => ({ ...user })) };
    }
    if (statement.includes("FROM users WHERE hub_user_id = $1")) {
      return { rows: users.filter((user) => user.hub_user_id === values[0]).map((user) => ({ ...user })) };
    }
    if (statement.includes("FROM users WHERE id = $1")) {
      return { rows: users.filter((user) => user.id === values[0]).map((user) => ({ ...user })) };
    }
    if (statement.startsWith("INSERT INTO users (id, email, password_hash)")) {
      if (users.some((user) => user.email === values[0])) {
        const error = new Error("unique violation"); error.code = "23505"; throw error;
      }
      const user = {
        id: crypto.randomUUID(), email: values[0], password_hash: values[1],
        hub_user_id: null, local_session_version: 0,
      };
      users.push(user);
      return { rows: [{ ...user }] };
    }
    if (statement.startsWith("UPDATE users SET password_hash = $1")) {
      const user = users.find((row) => row.id === values[1]);
      user.password_hash = values[0];
      user.local_session_version += 1;
      return { rows: [{ ...user }] };
    }
    if (statement.includes("FROM invites WHERE token = $1")) {
      return { rows: values[0] === invite.token ? [{ ...invite }] : [] };
    }
    if (statement.startsWith("UPDATE invites SET accepted_at")) {
      invite.accepted_at = new Date();
      return { rows: [] };
    }
    throw new Error(`Unexpected query: ${statement}`);
  }

  pool.query = query;
  pool.connect = async () => ({ query, release() {} });
  global.fetch = (url, options) => {
    if (String(url).includes("/api/identity/sessions/")) {
      hubCalls++;
      return hubActive
        ? Promise.resolve(new Response(JSON.stringify({ active: true }), { status: 200 }))
        : Promise.reject(new Error("hub offline"));
    }
    return nativeFetch(url, options);
  };
  const server = createApp().listen(0, "127.0.0.1");
  try {
    await new Promise((resolve) => server.once("listening", resolve));
    const base = `http://127.0.0.1:${server.address().port}`;
    const request = (path, options = {}) => global.fetch(`${base}${path}`, options);
    await run({ users, request, invite, hubCalls: () => hubCalls,
      setHubActive: (active) => { hubActive = active; } });
  } finally {
    await new Promise((resolve) => server.close(resolve));
    pool.query = originalQuery;
    pool.connect = originalConnect;
    global.fetch = nativeFetch;
  }
}

function post(body, cookie = "") {
  return {
    method: "POST",
    headers: { "content-type": "application/json", ...(cookie ? { cookie } : {}) },
    body: JSON.stringify(body),
  };
}

function cookieOf(response) {
  return String(response.headers.get("set-cookie") || "").split(";")[0];
}

test("local session cookie is Secure on the configured HTTPS host but works on HTTP dev", () => {
  const publicUrl = new URL(config.appBaseUrl);
  assert.equal(
    localCookieOptions({ secure: false, hostname: publicUrl.hostname }).secure,
    publicUrl.protocol === "https:"
  );
  assert.equal(localCookieOptions({ secure: false, hostname: "127.0.0.1" }).secure, false);
  assert.equal(localCookieOptions({ secure: true, hostname: "127.0.0.1" }).secure, true);
});

test("local password login, me, invite, and password change work while hub is offline", async () => {
  await withServer([{
    id: legacyId, email: "legacy@example.test",
    password_hash: hashPassword("old-password"), hub_user_id: null,
  }], async ({ users, request, hubCalls }) => {
    const login = await request("/auth/local/login", post({
      email: "legacy@example.test", password: "old-password",
    }));
    assert.equal(login.status, 200);
    assert.equal((await login.json()).user.hasLocalPassword, true);
    const firstCookie = cookieOf(login);
    assert.match(firstCookie, /^binance_local_session=/);
    assert.match(login.headers.get("set-cookie"), /HttpOnly/i);
    assert.doesNotMatch(login.headers.get("set-cookie"), /Domain=/i);

    const me = await request("/auth/me", {
      headers: { cookie: `${firstCookie}; ww_access_token=bad-stale-hub-token` },
    });
    assert.equal(me.status, 200);
    assert.equal((await me.json()).email, "legacy@example.test");
    assert.equal(hubCalls(), 0, "local auth must not ask hub to validate session");

    const accepted = await request("/auth/invites/private-invite-token/accept", post({}, firstCookie));
    assert.equal(accepted.status, 200);

    const changed = await request("/auth/local/password", post({
      currentPassword: "old-password", password: "a-new-local-password",
    }, firstCookie));
    assert.equal(changed.status, 200);
    const newCookie = cookieOf(changed);
    assert.notEqual(newCookie, firstCookie);
    assert.equal(users[0].local_session_version, 1);
    assert.equal((await request("/auth/me", { headers: { cookie: firstCookie } })).status, 401);
    assert.equal((await request("/auth/me", { headers: { cookie: newCookie } })).status, 200);
    assert.equal((await request("/auth/local/login", post({
      email: "legacy@example.test", password: "old-password",
    }))).status, 401);
    assert.equal((await request("/auth/local/login", post({
      email: "legacy@example.test", password: "a-new-local-password",
    }))).status, 200);
    const logout = await request("/auth/local/logout", post({}, newCookie));
    assert.equal(logout.status, 200);
    assert.equal((await request("/auth/me", { headers: { cookie: newCookie } })).status, 401,
      "a copied cookie must stop working after logout");
    assert.equal(hubCalls(), 0);
  });
});

test("local registration cannot take over an existing hub-only email", async () => {
  await withServer([{
    id: hubId, email: "hub@example.test", password_hash: HUB_ONLY_HASH, hub_user_id: hubId,
  }], async ({ users, request }) => {
    const conflict = await request("/auth/local/register", post({
      email: "hub@example.test", password: "a-long-valid-password",
    }));
    assert.equal(conflict.status, 409);
    assert.equal(users[0].password_hash, HUB_ONLY_HASH);

    const registered = await request("/auth/local/register", post({
      email: "new@example.test", password: "a-long-valid-password",
    }));
    assert.equal(registered.status, 201);
    assert.equal((await registered.json()).user.email, "new@example.test");
    assert.match(cookieOf(registered), /^binance_local_session=/);
    assert.equal((await request("/auth/me", { headers: { cookie: cookieOf(registered) } })).status, 200);
    assert.equal((await request("/auth/local/register", post({
      email: "too-long@example.test", password: "x".repeat(73),
    }))).status, 400);
    assert.equal((await request("/auth/local/register", {
      ...post({ email: "csrf@example.test", password: "a-long-valid-password" }),
      headers: { "content-type": "application/json", origin: "https://other.example" },
    })).status, 403);
  });
});

test("failed local password guesses are limited per account", async () => {
  await withServer([], async ({ request }) => {
    for (let count = 0; count < 5; count++) {
      assert.equal((await request("/auth/local/login", post({
        email: "missing@example.test", password: "wrong-password",
      }))).status, 401);
    }
    assert.equal((await request("/auth/local/login", post({
      email: "missing@example.test", password: "wrong-password",
    }))).status, 429);
  });
});

test("hub-only account cannot install local password while hub session is unconfirmed", async () => {
  await withServer([{
    id: hubId, email: "hub@example.test", password_hash: HUB_ONLY_HASH, hub_user_id: hubId,
  }], async ({ users, request, hubCalls }) => {
    const hubToken = createToken({ userId: hubId, projectId, email: "hub@example.test" });
    // The test token has no hub session id. Even if its signature is valid,
    // Binance must demand a confirmed live hub session for first password setup.
    const response = await request("/auth/local/password", post({
      password: "new-binance-password",
    }, `ww_access_token=${hubToken}`));
    assert.equal(response.status, 503);
    assert.equal((await response.json()).code, "hub_confirmation_required");
    assert.equal(users[0].password_hash, HUB_ONLY_HASH);
    assert.equal(hubCalls(), 0);
  });
});

test("confirmed live hub session can set first Binance password, then use local auth offline", async () => {
  await withServer([{
    id: hubId, email: "hub@example.test", password_hash: HUB_ONLY_HASH, hub_user_id: hubId,
  }], async ({ users, request, hubCalls, setHubActive }) => {
    const hubToken = jwt.sign({
      sub: hubId, email: "hub@example.test", iss: "weienwong.online", jti: "active-session-id",
    }, config.authJwtSecret, { expiresIn: "1h" });
    const setup = await request("/auth/local/password", post({
      password: "independent-binance-password",
    }, `ww_access_token=${hubToken}`));
    assert.equal(setup.status, 200);
    assert.equal((await setup.json()).hasLocalPassword, true);
    assert.notEqual(users[0].password_hash, HUB_ONLY_HASH);
    assert.ok(hubCalls() >= 2);
    const localCookie = cookieOf(setup);
    setHubActive(false);
    const before = hubCalls();
    assert.equal((await request("/auth/me", { headers: { cookie: localCookie } })).status, 200);
    assert.equal((await request("/auth/local/login", post({
      email: "hub@example.test", password: "independent-binance-password",
    }))).status, 200);
    assert.equal(hubCalls(), before);
  }, { hubInitiallyActive: true });
});
