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
  trustProxy: process.env.TRUST_PROXY !== "0",
  jwtSecret: process.env.JWT_SECRET ?? "change-me-in-production-binance",
  authJwtSecret: process.env.AUTH_JWT_SECRET ?? process.env.JWT_SECRET ?? "change-me-in-production-binance",
  authCookieName: process.env.AUTH_COOKIE_NAME ?? "ww_access_token",
  hubAuthUrl: (process.env.HUB_AUTH_URL ?? "https://weienwong.online").replace(/\/$/, ""),
  jwtExpireDays: Number(process.env.JWT_EXPIRE_DAYS ?? 7),
  appBaseUrl: (process.env.APP_BASE_URL ?? `http://localhost:${Number(process.env.BACKEND_PORT ?? 4000)}`).replace(/\/$/, ""),
  defaultProjectSlug: process.env.DEFAULT_PROJECT_SLUG ?? "binance",
};
