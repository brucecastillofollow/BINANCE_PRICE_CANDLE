import { Router } from "express";
import { rejectRevoked, sessionIsActive } from "../auth/hubSession.js";
import { config } from "../config.js";
import {
  acceptInvite,
  addProjectMember,
  countAcceptedInvitesSent,
  createInvite,
  createLocalSession,
  createUser,
  clearLocalLoginAttempts,
  ensureDefaultProject,
  ensureUserFromIdentity,
  getDefaultProject,
  getInviteByToken,
  getLocalUserById,
  getUserByEmail,
  HUB_ONLY_HASH,
  linkLegacyUser,
  localSessionIsActive,
  reserveLocalLoginAttempt,
  revokeLocalSession,
  setLocalPassword,
  userPayload,
} from "../auth/store.js";
import {
  adminCookieOptions,
  createAdminToken,
  createLocalToken,
  decodeLocalToken,
  decodeToken,
  generateInviteToken,
  getAdminTokenFromRequest,
  getBearerToken,
  getLocalToken,
  hashPassword,
  hubLoginUrl,
  localAttemptKey,
  localCookieOptions,
  localSessionHash,
  verifyPassword,
} from "../auth/utils.js";

const LINK_WINDOW_MS = 15 * 60 * 1000;
const LINK_LIMIT = 5;
const dummyPasswordHash = hashPassword("binance-local-invalid-password");

function emailFromInput(value) {
  if (typeof value !== "string") return "";
  const email = value.trim().toLowerCase();
  return email.length <= 254 && /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email) ? email : "";
}

function passwordIsAcceptable(value) {
  return typeof value === "string" && value.length >= 12 && value.trim().length >= 12 &&
    Buffer.byteLength(value, "utf8") <= 72;
}

function trustedOrigin(req) {
  const origin = req.headers?.origin;
  if (!origin) return true;
  const configured = [config.appBaseUrl, ...String(config.corsOrigin || "").split(",")];
  return configured.some((candidate) => {
    try { return new URL(candidate.trim()).origin === origin; } catch { return false; }
  });
}

function rejectForeignOrigin(req, res, next) {
  if (!trustedOrigin(req)) return res.status(403).json({ message: "Request origin is not allowed." });
  next();
}

async function authPayload(user, projectId) {
  const invitesSent = await countAcceptedInvitesSent(user.id, projectId);
  return { ...userPayload(user, invitesSent), hasLocalPassword: user.password_hash !== HUB_ONLY_HASH };
}

async function reservePasswordGuess(req, email) {
  const accountKey = localAttemptKey("account", email);
  const addressKey = localAttemptKey(`ip:${req.ip || "unknown"}`, email);
  const accountAllowed = await reserveLocalLoginAttempt(accountKey, 15);
  const addressAllowed = await reserveLocalLoginAttempt(addressKey, 5);
  return { allowed: accountAllowed && addressAllowed, accountKey, addressKey };
}

async function clearPasswordGuesses(keys) {
  await clearLocalLoginAttempts(keys.accountKey);
  await clearLocalLoginAttempts(keys.addressKey);
}

async function issueLocalCookie(req, res, user) {
  const token = createLocalToken(user);
  const payload = decodeLocalToken(token);
  await createLocalSession(localSessionHash(payload.jti), user.id, payload.exp);
  res.cookie(config.localAuthCookieName, token, localCookieOptions(req));
}

function clearLocalCookie(req, res) {
  const { maxAge: _maxAge, ...options } = localCookieOptions(req);
  res.clearCookie(config.localAuthCookieName, options);
}

async function authenticatedRequest(req) {
  const localToken = getLocalToken(req);
  if (localToken) {
    let payload = null;
    try { payload = decodeLocalToken(localToken); } catch { /* Expired or invalid cookie. */ }
    if (payload) {
      const user = await getLocalUserById(payload.sub);
      if (user && user.password_hash !== HUB_ONLY_HASH &&
          user.local_session_version === payload.sv &&
          await localSessionIsActive(localSessionHash(payload.jti), user.id)) {
        const project = await ensureDefaultProject();
        await addProjectMember(project.id, user.id, "member");
        return { userId: user.id, email: user.email, projectId: project.id,
          via: "local", hasLocalPassword: true };
      }
    }
  }

  const token = getBearerToken(req);
  if (!token) return null;
  const payload = decodeToken(token);
  await rejectRevoked(payload);
  const project = await ensureDefaultProject();
  if (payload.project_id && payload.project_id !== project.id) {
    throw new Error("Invalid token project");
  }
  const user = await ensureUserFromIdentity(String(payload.sub), String(payload.email || ""));
  const localUser = await getLocalUserById(user.id);
  await addProjectMember(project.id, user.id, "member");
  return { userId: user.id, email: user.email, projectId: project.id,
    via: "hub", hubSessionId: payload.jti || "",
    hasLocalPassword: Boolean(localUser && localUser.password_hash !== HUB_ONLY_HASH) };
}

function sendLinkRequired(res, error) {
  return res.status(401).json({
    code: "link_required",
    email: error.email,
    message: "Enter your old Binance Candle Data password once to link this account.",
  });
}

export function createAuthRouter() {
  const router = Router();
  const linkFailures = new Map();

  function recentLinkFailures(key) {
    const now = Date.now();
    const recent = (linkFailures.get(key) || []).filter((time) => time > now - LINK_WINDOW_MS);
    if (recent.length) linkFailures.set(key, recent);
    else linkFailures.delete(key);
    return recent;
  }

  router.post("/register", (_req, res) => {
    res.status(401).json({
      message: "Register at the Weien Wong hub",
      redirect: `${config.hubAuthUrl}/register`,
    });
  });

  router.post("/login", (_req, res) => {
    res.status(401).json({
      message: "Sign in at the Weien Wong hub",
      redirect: hubLoginUrl(),
    });
  });

  router.post("/local/register", rejectForeignOrigin, async (req, res, next) => {
    const email = emailFromInput(req.body?.email);
    const password = req.body?.password;
    if (!email) return res.status(400).json({ message: "Enter a valid email address." });
    if (!passwordIsAcceptable(password)) {
      return res.status(400).json({ message: "Password must be at least 12 characters and at most 72 UTF-8 bytes." });
    }
    try {
      const allowed = await reserveLocalLoginAttempt(
        localAttemptKey(`register:${req.ip || "unknown"}`, "new-account"), 10
      );
      if (!allowed) return res.status(429).json({ message: "Too many attempts. Try again in fifteen minutes." });
      const project = await ensureDefaultProject();
      const user = await createUser(email, hashPassword(password));
      await addProjectMember(project.id, user.id, "member");
      await issueLocalCookie(req, res, user);
      return res.status(201).json({ user: await authPayload(user, project.id) });
    } catch (error) {
      if (error?.code === "23505") {
        return res.status(409).json({ message: "An account with this email already exists." });
      }
      next(error);
    }
  });

  router.post("/local/login", rejectForeignOrigin, async (req, res, next) => {
    const email = emailFromInput(req.body?.email);
    const password = req.body?.password;
    if (!email || typeof password !== "string" || !password || password.length > 1024) {
      return res.status(400).json({ message: "Email and password required." });
    }
    try {
      const guesses = await reservePasswordGuess(req, email);
      if (!guesses.allowed) {
        return res.status(429).json({ message: "Too many attempts. Try again in fifteen minutes." });
      }
      const user = await getUserByEmail(email);
      const hash = user && user.password_hash !== HUB_ONLY_HASH ? user.password_hash : dummyPasswordHash;
      const valid = verifyPassword(password, hash);
      if (!user || user.password_hash === HUB_ONLY_HASH || !valid) {
        return res.status(401).json({ message: "Invalid email or password." });
      }
      await clearPasswordGuesses(guesses);
      const project = await ensureDefaultProject();
      await addProjectMember(project.id, user.id, "member");
      await issueLocalCookie(req, res, user);
      return res.json({ user: await authPayload(user, project.id) });
    } catch (error) { next(error); }
  });

  router.post("/local/logout", rejectForeignOrigin, async (req, res, next) => {
    try {
      const token = getLocalToken(req);
      if (token) {
        let payload = null;
        try { payload = decodeLocalToken(token); } catch { /* Expired or invalid cookie. */ }
        if (payload) await revokeLocalSession(localSessionHash(payload.jti));
      }
      clearLocalCookie(req, res);
      // The hub SSO cookie is scoped to the parent domain in production. Clear
      // it too so an optional hub session cannot silently sign this browser back in.
      const hubClear = { path: "/", sameSite: "lax", secure: Boolean(req.secure) };
      res.clearCookie(config.authCookieName, hubClear);
      if (String(req.hostname || "").endsWith("weienwong.online")) {
        res.clearCookie(config.authCookieName, { ...hubClear, domain: ".weienwong.online" });
      }
      res.json({ ok: true });
    } catch (error) { next(error); }
  });

  router.post("/local/password", rejectForeignOrigin, requireAuth, async (req, res, next) => {
    const password = req.body?.password;
    const currentPassword = req.body?.currentPassword;
    if (!passwordIsAcceptable(password)) {
      return res.status(400).json({ message: "Password must be at least 12 characters and at most 72 UTF-8 bytes." });
    }
    if (currentPassword !== undefined && typeof currentPassword !== "string") {
      return res.status(400).json({ message: "Current password must be text." });
    }
    try {
      if (!req.auth.hasLocalPassword && req.auth.via === "hub") {
        const active = req.auth.hubSessionId &&
          await sessionIsActive(String(req.auth.hubSessionId));
        if (active !== true) {
          return res.status(503).json({
            code: "hub_confirmation_required",
            message: "Connect to the sign-in hub once to set your Binance password.",
          });
        }
      }
      const guesses = await reservePasswordGuess(req, req.auth.email);
      if (!guesses.allowed) {
        return res.status(429).json({ message: "Too many attempts. Try again in fifteen minutes." });
      }
      const result = await setLocalPassword(req.auth.userId, currentPassword, hashPassword(password));
      if (result.code === "bad_password") {
        return res.status(401).json({ message: "Current password is incorrect." });
      }
      if (result.code !== "updated") return res.status(401).json({ message: "Account not found." });
      await clearPasswordGuesses(guesses);
      await issueLocalCookie(req, res, result.user);
      return res.json({ ok: true, hasLocalPassword: true });
    } catch (error) { next(error); }
  });

  router.post("/link", rejectForeignOrigin, async (req, res, next) => {
    let identity;
    try {
      const token = getBearerToken(req);
      if (!token) return res.status(401).json({ message: "Sign in at the hub first." });
      identity = decodeToken(token);
      await rejectRevoked(identity);
    } catch {
      return res.status(401).json({ message: "Sign in at the hub first." });
    }

    const email = String(identity.email || "").trim().toLowerCase();
    const hubUserId = String(identity.sub || "");
    if (!email || !hubUserId) return res.status(401).json({ message: "Invalid hub identity." });
    const password = req.body?.password;
    if (typeof password !== "string" || !password) {
      return res.status(400).json({ message: "Old Binance account password required." });
    }

    // A password check needs a budget even though a hub session is required.
    // Express applies the configured proxy trust to req.ip; do not read the
    // caller-controlled X-Forwarded-For header directly.
    const key = `${req.ip || "unknown"}|${email}`;
    const failures = recentLinkFailures(key);
    if (failures.length >= LINK_LIMIT) {
      return res.status(429).json({ message: "Too many attempts. Try again in fifteen minutes." });
    }
    try {
      const result = await linkLegacyUser(hubUserId, email, password);
      if (result.code === "bad_password") {
        linkFailures.set(key, [...failures, Date.now()]);
        return res.status(401).json({ message: "Old Binance account password is incorrect." });
      }
      if (result.code === "not_linkable" || result.code === "conflict") {
        return res.status(409).json({ message: "This account cannot be linked automatically." });
      }
      linkFailures.delete(key);
      return res.json({ ok: true, email: result.user.email });
    } catch (error) {
      return next(error);
    }
  });

  router.post("/admin/login", (req, res) => {
    const username = String(req.body?.username ?? "").trim();
    const password = String(req.body?.password ?? "");
    if (!config.adminPassword) {
      return res.status(503).json({ message: "Admin login is not configured" });
    }
    const userOk = username === config.adminUsername;
    const passOk = password === config.adminPassword;
    if (!userOk || !passOk) {
      return res.status(401).json({ message: "Invalid admin username or password" });
    }
    const token = createAdminToken(config.adminUsername);
    res.cookie(config.adminCookieName, token, adminCookieOptions());
    res.json({ ok: true, username: config.adminUsername });
  });

  router.get("/admin/me", (req, res) => {
    const admin = getAdminTokenFromRequest(req);
    if (!admin) {
      return res.status(401).json({ message: "Admin authentication required" });
    }
    res.json({ ok: true, username: admin.username, via: admin.via });
  });

  router.post("/admin/logout", (req, res) => {
    res.clearCookie(config.adminCookieName, { ...adminCookieOptions(), maxAge: 0 });
    res.json({ ok: true });
  });

  router.get("/me", requireAuth, async (req, res) => {
    const invitesSent = await countAcceptedInvitesSent(req.auth.userId, req.auth.projectId);
    res.json({
      ...userPayload({ id: req.auth.userId, email: req.auth.email }, invitesSent),
      hasLocalPassword: req.auth.hasLocalPassword,
    });
  });

  router.post("/invites", requireAuth, async (req, res, next) => {
    try {
      const { email } = req.body;
      if (!email) return res.status(400).json({ message: "Email required" });
      const token = generateInviteToken();
      const invite = await createInvite(req.auth.projectId, email, req.auth.userId, token);
      const link = `${config.appBaseUrl}/invite/${token}`;
      res.json({
        invite: {
          email: invite.email,
          token,
          link,
          expires_at: invite.expires_at,
        },
      });
    } catch (error) {
      next(error);
    }
  });

  router.get("/invites/:token", async (req, res, next) => {
    try {
      const invite = await getInviteByToken(req.params.token);
      if (!invite) return res.status(404).json({ message: "Invite not found" });
      res.json({
        email: invite.email,
        accepted: Boolean(invite.accepted_at),
        expired: new Date(invite.expires_at) < new Date(),
        hub_auth_url: config.hubAuthUrl,
      });
    } catch (error) {
      next(error);
    }
  });

  router.post("/invites/:token/accept", rejectForeignOrigin, requireAuth, async (req, res, next) => {
    try {
      const invite = await getInviteByToken(req.params.token);
      if (!invite) return res.status(404).json({ message: "Invite not found" });

      const project = await getDefaultProject();
      if (project.id !== invite.project_id) {
        return res.status(404).json({ message: "Invite not found" });
      }

      if (invite.email.toLowerCase() !== String(req.auth.email).toLowerCase()) {
        return res.status(403).json({ message: "Signed-in account does not match invite email" });
      }

      if (!invite.accepted_at) {
        const accepted = await acceptInvite(req.params.token, req.auth.userId);
        if (!accepted) return res.status(400).json({ message: "Invite expired or invalid" });
      } else {
        await addProjectMember(project.id, req.auth.userId, "member");
      }

      const invitesSent = await countAcceptedInvitesSent(req.auth.userId, project.id);
      res.json({ user: {
        ...userPayload({ id: req.auth.userId, email: req.auth.email }, invitesSent),
        hasLocalPassword: req.auth.hasLocalPassword,
      } });
    } catch (error) {
      if (error?.code === "link_required") return sendLinkRequired(res, error);
      next(error);
    }
  });

  return router;
}

export function requireAuth(req, res, next) {
  (async () => {
    try {
      const auth = await authenticatedRequest(req);
      if (!auth) {
        return res.status(401).json({
          message: "Authentication required",
        });
      }
      req.auth = auth;
      next();
    } catch (error) {
      if (error?.code === "link_required") return sendLinkRequired(res, error);
      if (error?.code === "identity_conflict") {
        return res.status(409).json({ message: "This email is already linked to another hub account." });
      }
      if (error?.status === 401 ||
          ["JsonWebTokenError", "TokenExpiredError", "NotBeforeError"].includes(error?.name) ||
          ["Invalid token project", "Hub identity has no email address"].includes(error?.message)) {
        return res.status(401).json({ message: "Invalid or expired token" });
      }
      next(error);
    }
  })();
}

export function isAdminRequest(req) {
  return Boolean(getAdminTokenFromRequest(req));
}

export function requireAdmin(req, res, next) {
  const admin = getAdminTokenFromRequest(req);
  if (!admin) {
    return res.status(401).json({ message: "Admin authentication required" });
  }
  req.admin = admin;
  next();
}

/** Invite gate for normal users; admin session/key skips those checks. */
export function requireDownloadUnlock(req, res, next) {
  if (isAdminRequest(req)) {
    req.admin = getAdminTokenFromRequest(req);
    return next();
  }
  requireAuth(req, res, async () => {
    if (res.headersSent) return;
    try {
      const count = await countAcceptedInvitesSent(req.auth.userId, req.auth.projectId);
      if (count < 1) {
        return res.status(403).json({
          message: "Invite at least one friend and have them accept to unlock CSV downloads",
          can_download: false,
        });
      }
      next();
    } catch (error) {
      next(error);
    }
  });
}
