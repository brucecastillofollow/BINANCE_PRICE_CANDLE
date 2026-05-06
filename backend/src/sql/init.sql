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
);
