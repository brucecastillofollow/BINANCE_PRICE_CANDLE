import dayjs from "dayjs";
import utc from "dayjs/plugin/utc.js";
import JSZip from "jszip";
import { parse } from "csv-parse/sync";
import { pool } from "../db.js";
import { toTableName } from "../utils.js";

dayjs.extend(utc);

const BINANCE_PREFIX = "https://data.binance.vision/data/spot/daily/klines";

async function ensureMarketTable(client, tableName) {
  console.log(`Creating table ${tableName}`);
  await client.query(`
    CREATE TABLE IF NOT EXISTS ${tableName} (
      open_time BIGINT PRIMARY KEY,
      open NUMERIC NOT NULL,
      high NUMERIC NOT NULL,
      low NUMERIC NOT NULL,
      close NUMERIC NOT NULL,
      volume NUMERIC NOT NULL,
      close_time BIGINT NOT NULL,
      quote_asset_volume NUMERIC NOT NULL,
      number_of_trades INTEGER NOT NULL,
      taker_buy_base_asset_volume NUMERIC NOT NULL,
      taker_buy_quote_asset_volume NUMERIC NOT NULL,
      ignore_value NUMERIC
    )
  `);
  console.log(`Table ${tableName} created`);
}

function buildDailyUrl(marketName, interval, dateText) {
  return `${BINANCE_PREFIX}/${marketName}/${interval}/${marketName}-${interval}-${dateText}.zip`;
}

async function updateSyncState(client, marketId, status, progress, errorMessage = null) {
  await client.query(
    `
    UPDATE markets
    SET sync_status = $1,
        sync_progress = $2,
        sync_error = $3,
        updated_at = NOW()
    WHERE id = $4
    `,
    [status, progress, errorMessage, marketId]
  );
}

async function fetchZipBuffer(url) {
  const response = await fetch(url);
  if (!response.ok) {
    if (response.status === 404) {
      return null;
    }
    throw new Error(`Failed to download: ${url} (${response.status})`);
  }
  return Buffer.from(await response.arrayBuffer());
}

function parseZipCsv(buffer) {
  return JSZip.loadAsync(buffer).then(async (zip) => {
    const files = Object.values(zip.files).filter((f) => !f.dir);
    if (files.length === 0) {
      return [];
    }
    const csvText = await files[0].async("string");
    return parse(csvText, { relax_column_count: true, skip_empty_lines: true });
  });
}

async function insertCandles(client, tableName, rows) {
  if (!rows.length) {
    return { latestOpenTime: null, insertedCount: 0 };
  }

  let latestOpenTime = null;
  let insertedCount = 0;
  for (const row of rows) {
    if (!Array.isArray(row) || row.length < 12) {
      continue;
    }
    const openTime = Number(row[0]);
    const closeTime = Number(row[6]);
    if (Number.isNaN(openTime) || Number.isNaN(closeTime)) {
      continue;
    }

    await client.query(
      `
        INSERT INTO ${tableName} (
          open_time, open, high, low, close, volume, close_time,
          quote_asset_volume, number_of_trades, taker_buy_base_asset_volume,
          taker_buy_quote_asset_volume, ignore_value
        )
        VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12)
        ON CONFLICT (open_time) DO UPDATE SET
          open = EXCLUDED.open,
          high = EXCLUDED.high,
          low = EXCLUDED.low,
          close = EXCLUDED.close,
          volume = EXCLUDED.volume,
          close_time = EXCLUDED.close_time,
          quote_asset_volume = EXCLUDED.quote_asset_volume,
          number_of_trades = EXCLUDED.number_of_trades,
          taker_buy_base_asset_volume = EXCLUDED.taker_buy_base_asset_volume,
          taker_buy_quote_asset_volume = EXCLUDED.taker_buy_quote_asset_volume,
          ignore_value = EXCLUDED.ignore_value
      `,
      [
        openTime,
        row[1],
        row[2],
        row[3],
        row[4],
        row[5],
        closeTime,
        row[7],
        Number(row[8]),
        row[9],
        row[10],
        row[11],
      ]
    );
    insertedCount += 1;

    if (latestOpenTime === null || openTime > latestOpenTime) {
      latestOpenTime = openTime;
    }
  }

  return { latestOpenTime, insertedCount };
}

export async function syncMarketData(market) {
  const tableName = toTableName(market.name);
  // Create table outside transaction so it is not lost on sync rollback.
  await ensureMarketTable(pool, tableName);

  const client = await pool.connect();
  try {
    await updateSyncState(client, market.id, "syncing", 0, null);

    const yesterday = dayjs().utc().startOf("day").subtract(1, "day");
    let currentDate = dayjs(Number(market.last_timestamp)).utc().startOf("day");
    const startDate = dayjs(Number(market.start_timestamp)).utc().startOf("day");
    if (currentDate.isBefore(startDate)) {
      currentDate = startDate;
    }

    const totalDays = Math.max(1, yesterday.diff(currentDate, "day") + 1);
    let processedDays = 0;
    let latestTimestamp = Number(market.last_timestamp);

    while (currentDate.isBefore(yesterday) || currentDate.isSame(yesterday)) {
      const dateText = currentDate.format("YYYY-MM-DD");
      const url = buildDailyUrl(market.name, market.interval, dateText);
      const zipBuffer = await fetchZipBuffer(url);
      if (!zipBuffer) {
        processedDays += 1;
        const progress = Math.min(99, (processedDays / totalDays) * 100);
        await updateSyncState(client, market.id, "syncing", progress, null);
        currentDate = currentDate.add(1, "day");
        continue;
      }

      await client.query("BEGIN");
      try {
        const rows = await parseZipCsv(zipBuffer);
        const { latestOpenTime } = await insertCandles(client, tableName, rows);
        if (latestOpenTime !== null && latestOpenTime > latestTimestamp) {
          latestTimestamp = latestOpenTime;
          await client.query(
            `
            UPDATE markets
            SET last_timestamp = $1, updated_at = NOW()
            WHERE id = $2
            `,
            [latestTimestamp, market.id]
          );
        }
        await client.query("COMMIT");
      } catch (error) {
        await client.query("ROLLBACK");
        throw error;
      }
      processedDays += 1;
      const progress = Math.min(99, (processedDays / totalDays) * 100);
      await updateSyncState(client, market.id, "syncing", progress, null);
      currentDate = currentDate.add(1, "day");
    }
    await updateSyncState(client, market.id, "finished", 100, null);
  } catch (error) {
    await updateSyncState(client, market.id, "failed", 0, error.message);
    throw error;
  } finally {
    client.release();
  }
}
