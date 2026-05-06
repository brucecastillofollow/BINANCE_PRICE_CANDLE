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
      name VARCHAR(30) NOT NULL,
      interval VARCHAR(10) NOT NULL,
      start_timestamp BIGINT NOT NULL,
      last_timestamp BIGINT NOT NULL,
      sync_status VARCHAR(20) NOT NULL DEFAULT 'idle',
      sync_progress NUMERIC(5,2) NOT NULL DEFAULT 0,
      sync_error TEXT,
      live_enabled BOOLEAN NOT NULL DEFAULT false,
      created_at TIMESTAMP NOT NULL DEFAULT NOW(),
      updated_at TIMESTAMP NOT NULL DEFAULT NOW(),
      UNIQUE (name, interval)
    )
  `);

  // Backward-compatible migration for existing databases.
  await pool.query("ALTER TABLE markets ADD COLUMN IF NOT EXISTS sync_status VARCHAR(20) NOT NULL DEFAULT 'idle'");
  await pool.query("ALTER TABLE markets ADD COLUMN IF NOT EXISTS sync_progress NUMERIC(5,2) NOT NULL DEFAULT 0");
  await pool.query("ALTER TABLE markets ADD COLUMN IF NOT EXISTS sync_error TEXT");
  await pool.query("ALTER TABLE markets ADD COLUMN IF NOT EXISTS live_enabled BOOLEAN NOT NULL DEFAULT false");

  await pool.query("ALTER TABLE markets DROP CONSTRAINT IF EXISTS markets_name_key");
  await pool.query(`
    DO $$
    BEGIN
      IF NOT EXISTS (
        SELECT 1 FROM pg_constraint WHERE conname = 'markets_name_interval_key'
      ) THEN
        ALTER TABLE markets ADD CONSTRAINT markets_name_interval_key UNIQUE (name, interval);
      END IF;
    END $$;
  `);
}

export async function closeDb() {
  await pool.end();
}
