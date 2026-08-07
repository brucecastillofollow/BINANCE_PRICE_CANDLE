import { pool } from "../db.js";

function utcDateKey(date = new Date()) {
  return date.toISOString().slice(0, 10);
}

/**
 * Identity the once-per-day CSV limit is counted against.
 *
 * Deliberately uses `req.ip` rather than reading X-Forwarded-For directly.
 * nginx *appends* to that header, so its first entry is whatever the caller
 * chose to send — reading it made the daily limit bypassable by varying the
 * header per request. `req.ip` honours the app's `trust proxy` setting and
 * resolves to the hop the trusted proxy actually saw.
 */
export function getClientKey(req) {
  return req.ip || "unknown";
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
