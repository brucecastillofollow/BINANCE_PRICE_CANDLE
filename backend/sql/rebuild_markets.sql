-- Rebuild the markets registry from the candle tables that survived.
--
-- Why this exists
-- ---------------
-- On 13 Aug 2026 the `markets` table was dropped and recreated. The candle
-- data was untouched -- it lives in one table per market (market_<symbol>_<iv>
-- for history, live_<symbol>_<iv> for the live feed) -- but the registry row
-- that lists each market went with the old table, so the admin page had
-- nothing to show while nearly a million candles sat in the database.
--
-- The evidence: `markets` was created at 02:14 on the 13th, thirteen hours
-- after every market_* and live_* table, alongside `invites` (02:18) and the
-- auth tables (02:38). Two sequences survive, markets_id_seq orphaned from the
-- original table and markets_id_seq1 owned by the current one, and neither has
-- ever issued a value -- so nothing was ever inserted into the replacement.
--
-- Everything the registry needs is recoverable from the data itself: the
-- symbol and interval from the table name, the range from the candles, and
-- live_enabled from whether a live_ table exists.
--
-- Safe to run more than once: it only inserts, and ON CONFLICT DO NOTHING
-- leaves any market you have since re-added alone.
--
--   sudo -u postgres psql -d binance_candles -f backend/sql/rebuild_markets.sql

INSERT INTO markets (name, interval, start_timestamp, last_timestamp, sync_status, live_enabled)
SELECT s.name,
       s.iv,
       s.first_ts,
       s.last_ts,
       'idle',
       s.has_live
FROM (
  SELECT upper(split_part(t.tablename, '_', 2)) AS name,
         split_part(t.tablename, '_', 3)        AS iv,
         bool_or(t.tablename LIKE 'live%')      AS has_live,
         min(x.lo)                              AS first_ts,
         max(x.hi)                              AS last_ts
  FROM pg_tables t
  -- The range has to be read from each table by name, which needs dynamic SQL.
  -- query_to_xml is the way to do that inside a plain statement, so this stays
  -- a file you can run with psql rather than a function you must install first.
  CROSS JOIN LATERAL (
    SELECT (xpath('/row/lo/text()',
             query_to_xml(format('SELECT min(open_time) AS lo FROM %I', t.tablename),
                          false, true, '')))[1]::text::bigint AS lo,
           (xpath('/row/hi/text()',
             query_to_xml(format('SELECT max(open_time) AS hi FROM %I', t.tablename),
                          false, true, '')))[1]::text::bigint AS hi
  ) x
  WHERE t.schemaname = 'public'
    -- ESCAPE, because _ is a wildcard in LIKE and would also match tables
    -- whose names merely start "market" or "live".
    AND (t.tablename LIKE 'market/_%' ESCAPE '/' OR t.tablename LIKE 'live/_%' ESCAPE '/')
    -- An empty table has no range and cannot say when its market ran. A market
    -- with history *and* live data is grouped below, so this only skips a
    -- market that is empty everywhere.
    AND x.lo IS NOT NULL
  -- History and live for the same market are two tables and one row: grouping
  -- here is what merges them, and what makes live_enabled true when either is
  -- a live table.
  GROUP BY 1, 2
) s
ON CONFLICT (name, interval) DO NOTHING;

-- What you should see afterwards.
SELECT id, name, interval,
       to_char(to_timestamp(start_timestamp / 1000), 'YYYY-MM-DD') AS from_date,
       to_char(to_timestamp(last_timestamp / 1000), 'YYYY-MM-DD')  AS to_date,
       sync_status, live_enabled
FROM markets
ORDER BY name, interval;
