import pg from "pg";
import { config } from "./config.js";

const { Pool } = pg;

export const pool = new Pool({
  connectionString: config.databaseUrl,
});

export async function initDb() {
  await pool.query(`
    CREATE TABLE IF NOT EXISTS markets (
      id SERIAL PRIMARY KEY,
      name VARCHAR(30) NOT NULL UNIQUE,
      interval VARCHAR(10) NOT NULL,
      start_timestamp BIGINT NOT NULL,
      last_timestamp BIGINT NOT NULL,
      sync_status VARCHAR(20) NOT NULL DEFAULT 'idle',
      sync_progress NUMERIC(5,2) NOT NULL DEFAULT 0,
      sync_error TEXT,
      created_at TIMESTAMP NOT NULL DEFAULT NOW(),
      updated_at TIMESTAMP NOT NULL DEFAULT NOW()
    )
  `);

  // Backward-compatible migration for existing databases.
  await pool.query("ALTER TABLE markets ADD COLUMN IF NOT EXISTS sync_status VARCHAR(20) NOT NULL DEFAULT 'idle'");
  await pool.query("ALTER TABLE markets ADD COLUMN IF NOT EXISTS sync_progress NUMERIC(5,2) NOT NULL DEFAULT 0");
  await pool.query("ALTER TABLE markets ADD COLUMN IF NOT EXISTS sync_error TEXT");
}

export async function closeDb() {
  await pool.end();
}
