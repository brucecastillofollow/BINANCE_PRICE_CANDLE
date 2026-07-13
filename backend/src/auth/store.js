import { pool } from "../db.js";
import { config } from "../config.js";

let defaultProjectCache = null;

export async function initAuthSchema() {
  await pool.query(`
    CREATE TABLE IF NOT EXISTS users (
      id UUID PRIMARY KEY,
      email TEXT NOT NULL UNIQUE,
      password_hash TEXT NOT NULL,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    );

    CREATE TABLE IF NOT EXISTS projects (
      id UUID PRIMARY KEY,
      slug TEXT NOT NULL UNIQUE,
      name TEXT NOT NULL,
      owner_id UUID REFERENCES users(id),
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    );

    CREATE TABLE IF NOT EXISTS project_members (
      project_id UUID NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
      user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      role TEXT NOT NULL DEFAULT 'member',
      joined_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      PRIMARY KEY (project_id, user_id)
    );

    CREATE TABLE IF NOT EXISTS invites (
      id UUID PRIMARY KEY,
      project_id UUID NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
      email TEXT NOT NULL,
      token TEXT NOT NULL UNIQUE,
      invited_by UUID NOT NULL REFERENCES users(id),
      accepted_at TIMESTAMPTZ,
      accepted_by UUID REFERENCES users(id),
      expires_at TIMESTAMPTZ NOT NULL,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    );

    CREATE INDEX IF NOT EXISTS invites_project_idx ON invites (project_id);
    CREATE INDEX IF NOT EXISTS invites_token_idx ON invites (token);
  `);
}

export async function getUserByEmail(email) {
  const { rows } = await pool.query("SELECT * FROM users WHERE email = $1", [email.toLowerCase()]);
  return rows[0] ?? null;
}

export async function getUserById(userId) {
  const { rows } = await pool.query("SELECT id, email, created_at FROM users WHERE id = $1", [userId]);
  return rows[0] ?? null;
}

export async function ensureUserFromIdentity(userId, email) {
  const hubOnlyHash = "$2b$10$hub.identity.only.account.placeholder.hashxx";
  let user = await getUserById(userId);
  if (user) return user;
  const byEmail = email ? await getUserByEmail(email) : null;
  if (byEmail) return byEmail;
  const { rows } = await pool.query(
    `INSERT INTO users (id, email, password_hash) VALUES ($1, $2, $3)
     RETURNING id, email, created_at`,
    [userId, String(email || "").toLowerCase(), hubOnlyHash]
  );
  return rows[0];
}

export async function createUser(email, passwordHash) {
  const { rows } = await pool.query(
    `INSERT INTO users (id, email, password_hash) VALUES (gen_random_uuid(), $1, $2)
     RETURNING id, email, created_at`,
    [email.toLowerCase(), passwordHash]
  );
  return rows[0];
}

export async function getProjectBySlug(slug) {
  const { rows } = await pool.query("SELECT * FROM projects WHERE slug = $1", [slug.toLowerCase()]);
  return rows[0] ?? null;
}

export async function ensureDefaultProject() {
  if (defaultProjectCache) return defaultProjectCache;
  const slug = config.defaultProjectSlug.toLowerCase();
  let project = await getProjectBySlug(slug);
  if (!project) {
    const { rows } = await pool.query(
      `INSERT INTO projects (id, slug, name, owner_id) VALUES (gen_random_uuid(), $1, $2, NULL) RETURNING *`,
      [slug, "Binance Candle Data"]
    );
    project = rows[0];
  }
  defaultProjectCache = project;
  return project;
}

export async function getDefaultProject() {
  return ensureDefaultProject();
}

async function addMember(client, projectId, userId, role) {
  await client.query(
    `INSERT INTO project_members (project_id, user_id, role)
     VALUES ($1, $2, $3) ON CONFLICT (project_id, user_id) DO NOTHING`,
    [projectId, userId, role]
  );
}

export async function createProject(slug, name, ownerId) {
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    const { rows } = await client.query(
      `INSERT INTO projects (id, slug, name, owner_id) VALUES (gen_random_uuid(), $1, $2, $3) RETURNING *`,
      [slug.toLowerCase(), name, ownerId]
    );
    await addMember(client, rows[0].id, ownerId, "owner");
    await client.query("COMMIT");
    return rows[0];
  } catch (e) {
    await client.query("ROLLBACK");
    throw e;
  } finally {
    client.release();
  }
}

export async function isProjectMember(projectId, userId) {
  const { rows } = await pool.query(
    "SELECT 1 FROM project_members WHERE project_id = $1 AND user_id = $2",
    [projectId, userId]
  );
  return rows.length > 0;
}

export async function addProjectMember(projectId, userId, role = "member") {
  const client = await pool.connect();
  try {
    await addMember(client, projectId, userId, role);
  } finally {
    client.release();
  }
}

export async function createInvite(projectId, email, invitedBy, token) {
  const { rows } = await pool.query(
    `INSERT INTO invites (id, project_id, email, token, invited_by, expires_at)
     VALUES (gen_random_uuid(), $1, $2, $3, $4, NOW() + INTERVAL '7 days')
     RETURNING *`,
    [projectId, email.toLowerCase(), token, invitedBy]
  );
  return rows[0];
}

export async function getInviteByToken(token) {
  const { rows } = await pool.query("SELECT * FROM invites WHERE token = $1", [token]);
  return rows[0] ?? null;
}

export async function acceptInvite(token, userId) {
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    const { rows } = await client.query(
      "SELECT * FROM invites WHERE token = $1 AND accepted_at IS NULL FOR UPDATE",
      [token]
    );
    const invite = rows[0];
    if (!invite || new Date(invite.expires_at) < new Date()) {
      await client.query("ROLLBACK");
      return null;
    }
    await client.query(
      "UPDATE invites SET accepted_at = NOW(), accepted_by = $1 WHERE id = $2",
      [userId, invite.id]
    );
    await addMember(client, invite.project_id, userId, "member");
    await client.query("COMMIT");
    return invite;
  } catch (e) {
    await client.query("ROLLBACK");
    throw e;
  } finally {
    client.release();
  }
}

export async function countAcceptedInvitesSent(userId, projectId) {
  const { rows } = await pool.query(
    `SELECT COUNT(*)::int AS cnt FROM invites
     WHERE invited_by = $1 AND project_id = $2 AND accepted_at IS NOT NULL`,
    [userId, projectId]
  );
  return rows[0].cnt;
}

export function userPayload(user, invitesSent) {
  return {
    id: user.id,
    email: user.email,
    accepted_invites_sent: invitesSent,
    can_download: invitesSent >= 1,
  };
}
