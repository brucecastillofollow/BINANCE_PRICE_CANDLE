-- The live WebSocket handler uses ON CONFLICT (open_time), but these legacy
-- tables have only non-unique open_time indexes. The eight tables were audited
-- for duplicate open_time values on 2026-09-26; none had duplicates.
--
-- Unique indexes built CONCURRENTLY avoid blocking live reads and writes for
-- the duration of each build. Run with psql -X -v ON_ERROR_STOP=1 -f so a
-- failed index halts the script. No transaction wrapper: PostgreSQL forbids
-- CREATE INDEX CONCURRENTLY inside a transaction block.
--
-- Each command has a bounded wait. A timeout can leave an INVALID index;
-- inspect pg_index and drop that invalid index concurrently before retrying.
SET lock_timeout = '5s';
SET statement_timeout = '120s';

DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM pg_index i
    JOIN pg_class c ON c.oid = i.indexrelid
    WHERE c.relname IN (
      'live_btcusdt_1m_open_time_uidx',
      'live_btcusdt_5m_open_time_uidx',
      'live_dogeusdt_5m_open_time_uidx',
      'live_ethusdt_1m_open_time_uidx',
      'live_ethusdt_5m_open_time_uidx',
      'live_solusdt_5m_open_time_uidx',
      'live_trxusdt_5m_open_time_uidx',
      'live_xrpusdt_5m_open_time_uidx'
    ) AND NOT i.indisvalid
  ) THEN
    RAISE EXCEPTION 'A previous live open_time unique index build is invalid; inspect and clean it before retrying';
  END IF;
END $$;

CREATE UNIQUE INDEX CONCURRENTLY IF NOT EXISTS live_btcusdt_1m_open_time_uidx ON public.live_btcusdt_1m (open_time);
CREATE UNIQUE INDEX CONCURRENTLY IF NOT EXISTS live_btcusdt_5m_open_time_uidx ON public.live_btcusdt_5m (open_time);
CREATE UNIQUE INDEX CONCURRENTLY IF NOT EXISTS live_dogeusdt_5m_open_time_uidx ON public.live_dogeusdt_5m (open_time);
CREATE UNIQUE INDEX CONCURRENTLY IF NOT EXISTS live_ethusdt_1m_open_time_uidx ON public.live_ethusdt_1m (open_time);
CREATE UNIQUE INDEX CONCURRENTLY IF NOT EXISTS live_ethusdt_5m_open_time_uidx ON public.live_ethusdt_5m (open_time);
CREATE UNIQUE INDEX CONCURRENTLY IF NOT EXISTS live_solusdt_5m_open_time_uidx ON public.live_solusdt_5m (open_time);
CREATE UNIQUE INDEX CONCURRENTLY IF NOT EXISTS live_trxusdt_5m_open_time_uidx ON public.live_trxusdt_5m (open_time);
CREATE UNIQUE INDEX CONCURRENTLY IF NOT EXISTS live_xrpusdt_5m_open_time_uidx ON public.live_xrpusdt_5m (open_time);
