-- Repair the legacy, empty BTCUSDT 1m table before resuming its historical sync.
-- The sync uses ON CONFLICT (open_time), which requires a unique key. New tables
-- already get this key from CREATE TABLE; this existing table only has a plain
-- (non-unique) index. Its registry checkpoint also points past an empty table.
--
-- This migration is transactional and safe to rerun. It deliberately refuses to
-- add the key to a populated legacy table, which would require a duplicate audit.
-- A five-second lock timeout avoids waiting indefinitely behind a sync job.

BEGIN;
SET LOCAL lock_timeout = '5s';
LOCK TABLE public.market_btcusdt_1m IN ACCESS EXCLUSIVE MODE;

DO $$
BEGIN
  -- Hold the registry row until commit so a concurrent enqueue cannot update
  -- its status between the guard and checkpoint reset.
  PERFORM 1 FROM public.markets
  WHERE name = 'BTCUSDT' AND interval = '1m' FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'BTCUSDT 1m market row is missing';
  END IF;

  IF EXISTS (
    SELECT 1 FROM public.markets
    WHERE name = 'BTCUSDT' AND interval = '1m' AND sync_status IN ('queued', 'syncing')
  ) THEN
    RAISE EXCEPTION 'BTCUSDT 1m has a queued or running sync; wait for that job before repairing its checkpoint';
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conrelid = 'public.market_btcusdt_1m'::regclass AND contype = 'p'
  ) THEN
    IF EXISTS (SELECT 1 FROM public.market_btcusdt_1m) THEN
      RAISE EXCEPTION 'BTCUSDT 1m table is populated; audit duplicate open_time values before adding a primary key';
    END IF;

    ALTER TABLE public.market_btcusdt_1m
      ADD CONSTRAINT market_btcusdt_1m_pkey PRIMARY KEY (open_time);
  END IF;

  -- Only rewind the checkpoint while the candle table is empty. Once the sync
  -- writes rows, rerunning this migration must leave progress untouched.
  IF NOT EXISTS (SELECT 1 FROM public.market_btcusdt_1m) THEN
    UPDATE public.markets
    SET last_timestamp = start_timestamp,
        sync_status = 'idle',
        sync_progress = 0,
        sync_error = NULL,
        updated_at = NOW()
    WHERE name = 'BTCUSDT' AND interval = '1m';
  END IF;
END $$;

COMMIT;
