import WebSocket from "ws";
import { pool } from "../db.js";
import {
  intervalToBinanceStreamToken,
  normalizeBinanceCsvTimeMs,
  toLiveTableName,
} from "../utils.js";

/** interval -> Set of uppercase symbols (e.g. BTCUSDT) */
const symbolsByInterval = new Map();

/** interval -> { ws: WebSocket | null, generation: number } */
const connections = new Map();
const WS_BASES = [
  "wss://stream.binance.com:9443/stream?streams=",
  "wss://data-stream.binance.vision/stream?streams=",
];

const CANDLE_DDL = `
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
`;

function assertSafeLiveTable(tableName) {
  if (!/^live_[a-z0-9]+_[a-z0-9]+$/.test(tableName)) {
    throw new Error("Invalid live table name");
  }
  return tableName;
}

async function ensureLiveTable(tableName) {
  assertSafeLiveTable(tableName);
  await pool.query(`
    CREATE TABLE IF NOT EXISTS ${tableName} (
      ${CANDLE_DDL}
    )
  `);
}

function closeInterval(interval) {
  const conn = connections.get(interval);
  if (conn?.ws) {
    conn.ws.removeAllListeners();
    try {
      if (conn.ws.readyState === WebSocket.CONNECTING) {
        conn.ws.terminate();
      } else {
        conn.ws.close();
      }
    } catch {
      // Ignore race where socket closes between state check and close().
    }
  }
  connections.delete(interval);
}

function buildStreamUrl(interval, baseIdx = 0) {
  const syms = symbolsByInterval.get(interval);
  if (!syms || syms.size === 0) {
    return null;
  }
  const token = intervalToBinanceStreamToken(interval);
  const streams = [...syms]
    .sort()
    .map((s) => `${s.toLowerCase()}@kline_${token}`)
    .join("/");
  const base = WS_BASES[baseIdx] ?? WS_BASES[0];
  return `${base}${streams}`;
}

async function handleKlineClose(symbolUpper, interval, k) {
  if (!k?.x) {
    return;
  }
  const openTime = normalizeBinanceCsvTimeMs(k.t);
  const closeTime = normalizeBinanceCsvTimeMs(k.T);
  if (openTime === null || closeTime === null) {
    return;
  }
  const tableName = toLiveTableName(symbolUpper, interval);
  await ensureLiveTable(tableName);
  await pool.query(
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
      k.o,
      k.h,
      k.l,
      k.c,
      k.v,
      closeTime,
      k.q,
      Number(k.n),
      k.V,
      k.Q,
      k.B ?? null,
    ]
  );
}

function openInterval(interval, baseIdx = 0) {
  const url = buildStreamUrl(interval, baseIdx);
  if (!url) {
    closeInterval(interval);
    return;
  }

  closeInterval(interval);
  const generation = Date.now();
  const ws = new WebSocket(url);
  connections.set(interval, { ws, generation, baseIdx });
  console.log(`Live WS connecting [${interval}] ${url}`);

  ws.on("open", () => {
    console.log(`Live WS connected [${interval}] via base #${baseIdx + 1}`);
  });

  ws.on("message", (raw) => {
    void (async () => {
      try {
        const msg = JSON.parse(raw.toString());
        const payload = msg?.data ?? msg;
        if (payload?.e !== "kline" || !payload?.k) {
          return;
        }
        const sym = String(payload.s || "").toUpperCase();
        const k = payload.k;
        await handleKlineClose(sym, interval, k);
      } catch (e) {
        console.error("Live kline handler error", e.message);
      }
    })();
  });

  ws.on("error", (err) => {
    console.error(`Live WS error [${interval}]`, err.message);
    if (String(err.message).includes("451") && baseIdx + 1 < WS_BASES.length) {
      console.warn(`Live WS [${interval}] switching to fallback endpoint`);
      openInterval(interval, baseIdx + 1);
    }
  });

  ws.on("close", () => {
    const conn = connections.get(interval);
    if (!conn || conn.generation !== generation) {
      return;
    }
    const still = symbolsByInterval.get(interval);
    if (still && still.size > 0) {
      setTimeout(() => {
        const c2 = connections.get(interval);
        if (!c2 || c2.generation !== generation) {
          return;
        }
        openInterval(interval, c2.baseIdx ?? baseIdx);
      }, 4000);
    }
  });
}

function refreshInterval(interval) {
  const set = symbolsByInterval.get(interval);
  if (!set || set.size === 0) {
    closeInterval(interval);
    return;
  }
  openInterval(interval);
}

/**
 * Enable/disable live websocket ingest for a market row.
 */
export async function setMarketLiveEnabled(marketId, enabled) {
  const id = Number(marketId);
  if (!Number.isFinite(id)) {
    return { ok: false, error: "invalid_id" };
  }
  const r = await pool.query("SELECT id, name, interval FROM markets WHERE id = $1", [id]);
  if (!r.rowCount) {
    return { ok: false, error: "not_found" };
  }
  const { name, interval } = r.rows[0];
  await pool.query("UPDATE markets SET live_enabled = $1, updated_at = NOW() WHERE id = $2", [
    enabled,
    id,
  ]);

  if (!symbolsByInterval.has(interval)) {
    symbolsByInterval.set(interval, new Set());
  }
  const symSet = symbolsByInterval.get(interval);
  if (enabled) {
    // Create live table immediately when market is enabled for live ingest.
    await ensureLiveTable(toLiveTableName(String(name).toUpperCase(), interval));
    symSet.add(String(name).toUpperCase());
  } else {
    symSet.delete(String(name).toUpperCase());
  }
  refreshInterval(interval);
  return { ok: true, live_enabled: enabled };
}

export async function initLiveFromDb() {
  const r = await pool.query(
    "SELECT name, interval FROM markets WHERE live_enabled = true"
  );
  for (const row of r.rows) {
    const interval = row.interval;
    if (!symbolsByInterval.has(interval)) {
      symbolsByInterval.set(interval, new Set());
    }
    symbolsByInterval.get(interval).add(String(row.name).toUpperCase());
  }
  for (const interval of symbolsByInterval.keys()) {
    refreshInterval(interval);
  }
  if (r.rowCount) {
    console.log(`Live streams: ${r.rowCount} market(s) subscribed`);
  }
}

export function shutdownLive() {
  for (const interval of [...connections.keys()]) {
    closeInterval(interval);
  }
  symbolsByInterval.clear();
}

export function getLiveStatus() {
  const intervals = {};
  for (const [interval, syms] of symbolsByInterval.entries()) {
    const ws = connections.get(interval)?.ws;
    intervals[interval] = {
      symbols: [...syms],
      connected: Boolean(ws && ws.readyState === WebSocket.OPEN),
      endpoint: WS_BASES[connections.get(interval)?.baseIdx ?? 0],
    };
  }
  return { intervals };
}
