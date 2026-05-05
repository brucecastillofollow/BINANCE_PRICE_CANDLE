import dayjs from "dayjs";
import utc from "dayjs/plugin/utc.js";
import JSZip from "jszip";
import { parse } from "csv-parse/sync";
import { pool } from "../db.js";
import { toTableName } from "../utils.js";

dayjs.extend(utc);

const BINANCE_PREFIX = "https://data.binance.vision/data/spot/daily/klines";

async function ensureMarketTable(client, tableName) {
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
}

function buildDailyUrl(marketName, interval, dateText) {
  return `${BINANCE_PREFIX}/${marketName}/${interval}/${marketName}-${interval}-${dateText}.zip`;
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
    return null;
  }

  let latestOpenTime = null;
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

    if (latestOpenTime === null || openTime > latestOpenTime) {
      latestOpenTime = openTime;
    }
  }

  return latestOpenTime;
}

export async function syncMarketData(market) {
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    const tableName = toTableName(market.name);
    await ensureMarketTable(client, tableName);

    const yesterday = dayjs().utc().startOf("day").subtract(1, "day");
    let currentDate = dayjs(Number(market.last_timestamp)).utc().startOf("day");
    if (currentDate.isBefore(dayjs(Number(market.start_timestamp)).utc().startOf("day"))) {
      currentDate = dayjs(Number(market.start_timestamp)).utc().startOf("day");
    }

    let latestTimestamp = Number(market.last_timestamp);

    while (currentDate.isBefore(yesterday) || currentDate.isSame(yesterday)) {
      const dateText = currentDate.format("YYYY-MM-DD");
      const url = buildDailyUrl(market.name, market.interval, dateText);
      const zipBuffer = await fetchZipBuffer(url);
      if (!zipBuffer) {
        currentDate = currentDate.add(1, "day");
        continue;
      }

      const rows = await parseZipCsv(zipBuffer);
      const lastInserted = await insertCandles(client, tableName, rows);
      if (lastInserted !== null && lastInserted > latestTimestamp) {
        latestTimestamp = lastInserted;
      }
      currentDate = currentDate.add(1, "day");
    }

    await client.query(
      `
      UPDATE markets
      SET last_timestamp = $1, updated_at = NOW()
      WHERE id = $2
      `,
      [latestTimestamp, market.id]
    );
    await client.query("COMMIT");
  } catch (error) {
    await client.query("ROLLBACK");
    throw error;
  } finally {
    client.release();
  }
}
