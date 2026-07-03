import { pool } from "../db.js";

function utcDateKey(date = new Date()) {
  return date.toISOString().slice(0, 10);
}

export function getClientKey(req) {
  const forwarded = req.headers["x-forwarded-for"];
  const ip = typeof forwarded === "string" ? forwarded.split(",")[0].trim() : req.ip;
  return ip || "unknown";
}

export async function canDownloadToday(clientKey) {
  const today = utcDateKey();
  const result = await pool.query(
    `
    SELECT 1 FROM csv_downloads
    WHERE client_key = $1 AND download_date = $2
    LIMIT 1
    `,
    [clientKey, today]
  );
  return result.rowCount === 0;
}

export async function recordDownload(clientKey) {
  const today = utcDateKey();
  await pool.query(
    `
    INSERT INTO csv_downloads (client_key, download_date)
    VALUES ($1, $2)
    ON CONFLICT (client_key, download_date) DO NOTHING
    `,
    [clientKey, today]
  );
}
