import dotenv from "dotenv";
import path from "path";
import { fileURLToPath } from "url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const rootEnvPath = path.resolve(__dirname, "../../.env");

dotenv.config({ path: rootEnvPath });

const dbHost = process.env.DB_HOST ?? "localhost";
const dbPort = Number(process.env.DB_PORT ?? 5432);
const dbName = process.env.DB_NAME ?? "binance_candles";
const dbUser = process.env.DB_USER ?? "postgres";
const dbPassword = process.env.DB_PASSWORD ?? "postgres";

const databaseUrl = `postgresql://${dbUser}:${encodeURIComponent(dbPassword)}@${dbHost}:${dbPort}/${dbName}`;

export const config = {
  port: Number(process.env.BACKEND_PORT ?? process.env.PORT ?? 4000),
  databaseUrl,
  syncWorkerCount: Number(process.env.SYNC_WORKER_COUNT ?? 3),
  /** UTC hour (0–23) for automatic daily sync of all markets */
  dailySyncHourUtc: Number(process.env.DAILY_SYNC_HOUR_UTC ?? 1),
  corsOrigin:
    process.env.CORS_ORIGIN ??
    [
      process.env.APP_BASE_URL,
      `http://localhost:${Number(process.env.FRONTEND_PORT ?? 5173)}`,
      "https://cryptodataset.weienwong.online",
    ]
      .filter(Boolean)
      .join(","),
  adminApiKey: process.env.ADMIN_API_KEY ?? "",
  adminUsername: process.env.ADMIN_USERNAME ?? "admin",
  adminPassword: process.env.ADMIN_PASSWORD ?? process.env.ADMIN_API_KEY ?? "",
  adminCookieName: process.env.ADMIN_COOKIE_NAME ?? "binance_admin_session",
  /** Hours until admin cookie expires (default 12) */
  adminSessionHours: Number(process.env.ADMIN_SESSION_HOURS ?? 12),
  trustProxy: process.env.TRUST_PROXY !== "0",
  jwtSecret: process.env.JWT_SECRET ?? "change-me-in-production-binance",
  authJwtSecret: process.env.AUTH_JWT_SECRET ?? process.env.JWT_SECRET ?? "change-me-in-production-binance",
  authCookieName: process.env.AUTH_COOKIE_NAME ?? "ww_access_token",
  hubAuthUrl: (process.env.HUB_AUTH_URL ?? "https://weienwong.online").replace(/\/$/, ""),
  jwtExpireDays: Number(process.env.JWT_EXPIRE_DAYS ?? 7),
  appBaseUrl: (process.env.APP_BASE_URL ?? `http://localhost:${Number(process.env.BACKEND_PORT ?? 4000)}`).replace(/\/$/, ""),
  defaultProjectSlug: process.env.DEFAULT_PROJECT_SLUG ?? "binance",
};

// Values shipped in the README/.env.example. Booting with any of these means the
// signing key is public knowledge, so startup fails rather than serving with it.
const INSECURE_SECRETS = new Set([
  "",
  "change-me-in-production",
  "change-me-in-production-binance",
  "change-me-in-production-fanduel",
  "change-this-session-secret"
]);

// Long enough that an offline attack on the HS256 signature is not worthwhile.
const MIN_SECRET_LENGTH = 32;

export function validateEnv() {
  if (INSECURE_SECRETS.has(config.authJwtSecret)) {
    throw new Error(
      "AUTH_JWT_SECRET is unset or still a placeholder. Set it in .env to the " +
        "same value the hub uses, otherwise anyone can forge a session."
    );
  }
  if (INSECURE_SECRETS.has(config.jwtSecret)) {
    throw new Error("JWT_SECRET is unset or still a placeholder. Set it in .env.");
  }
  if (config.adminPassword && ["admin", "change-this-password"].includes(config.adminPassword)) {
    throw new Error("ADMIN_PASSWORD is still a default value. Set a strong password in .env.");
  }

  for (const [name, value] of [
    ["AUTH_JWT_SECRET", config.authJwtSecret],
    ["JWT_SECRET", config.jwtSecret]
  ]) {
    if (value.length < MIN_SECRET_LENGTH) {
      console.warn(
        `warning: ${name} is only ${value.length} characters; ${MIN_SECRET_LENGTH}+ ` +
          "recommended so the signing key cannot be recovered by offline brute force."
      );
    }
  }
}
