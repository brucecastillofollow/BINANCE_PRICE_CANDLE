import { Router } from "express";
import { config } from "../config.js";
import {
  acceptInvite,
  addProjectMember,
  countAcceptedInvitesSent,
  createInvite,
  createUser,
  ensureDefaultProject,
  getDefaultProject,
  getInviteByToken,
  getUserByEmail,
  userPayload,
} from "../auth/store.js";
import {
  createToken,
  decodeToken,
  generateInviteToken,
  getBearerToken,
  hashPassword,
  verifyPassword,
} from "../auth/utils.js";

export function createAuthRouter() {
  const router = Router();

  router.post("/register", async (req, res, next) => {
    try {
      const { email, password } = req.body;
      if (!email || !password || password.length < 8) {
        return res.status(400).json({ message: "Email and password (8+ chars) required" });
      }

      const existing = await getUserByEmail(email);
      if (existing) {
        return res.status(400).json({ message: "Email already registered; please login" });
      }

      const project = await ensureDefaultProject();
      const user = await createUser(email, hashPassword(password));
      await addProjectMember(project.id, user.id, "member");

      const token = createToken({ userId: user.id, projectId: project.id, email: user.email });
      res.json({ token, user: userPayload(user, 0) });
    } catch (error) {
      next(error);
    }
  });

  router.post("/login", async (req, res, next) => {
    try {
      const { email, password } = req.body;
      const project = await ensureDefaultProject();

      const user = await getUserByEmail(email);
      if (!user || !verifyPassword(password, user.password_hash)) {
        return res.status(401).json({ message: "Invalid email or password" });
      }

      await addProjectMember(project.id, user.id, "member");

      const invitesSent = await countAcceptedInvitesSent(user.id, project.id);
      const token = createToken({ userId: user.id, projectId: project.id, email: user.email });
      res.json({ token, user: userPayload(user, invitesSent) });
    } catch (error) {
      next(error);
    }
  });

  router.get("/me", requireAuth, async (req, res) => {
    const invitesSent = await countAcceptedInvitesSent(req.auth.userId, req.auth.projectId);
    res.json(userPayload({ id: req.auth.userId, email: req.auth.email }, invitesSent));
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
      });
    } catch (error) {
      next(error);
    }
  });

  router.post("/invites/:token/accept", async (req, res, next) => {
    try {
      const { password } = req.body;
      const invite = await getInviteByToken(req.params.token);
      if (!invite) return res.status(404).json({ message: "Invite not found" });

      const project = await getDefaultProject();
      if (project.id !== invite.project_id) {
        return res.status(404).json({ message: "Invite not found" });
      }

      let user = await getUserByEmail(invite.email);
      if (!user) {
        if (!password || password.length < 8) {
          return res.status(400).json({ message: "Password required to create account" });
        }
        user = await createUser(invite.email, hashPassword(password));
      } else if (password && !verifyPassword(password, user.password_hash)) {
        return res.status(401).json({ message: "Invalid password" });
      }

      if (!invite.accepted_at) {
        const accepted = await acceptInvite(req.params.token, user.id);
        if (!accepted) return res.status(400).json({ message: "Invite expired or invalid" });
      } else {
        await addProjectMember(project.id, user.id, "member");
      }

      const invitesSent = await countAcceptedInvitesSent(user.id, project.id);
      const token = createToken({ userId: user.id, projectId: project.id, email: user.email });
      res.json({ token, user: userPayload(user, invitesSent) });
    } catch (error) {
      next(error);
    }
  });

  return router;
}

export function requireAuth(req, res, next) {
  (async () => {
    try {
      const token = getBearerToken(req);
      if (!token) return res.status(401).json({ message: "Authentication required" });

      const payload = decodeToken(token);
      const project = await getDefaultProject();
      if (payload.project_id !== project.id) {
        return res.status(401).json({ message: "Invalid or expired token" });
      }

      req.auth = {
        userId: payload.sub,
        email: payload.email,
        projectId: project.id,
      };
      next();
    } catch {
      res.status(401).json({ message: "Invalid or expired token" });
    }
  })();
}

export async function requireDownloadUnlock(req, res, next) {
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
