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
  corsOrigin:
    process.env.CORS_ORIGIN ??
    `http://localhost:${Number(process.env.FRONTEND_PORT ?? 5173)}`,
};
