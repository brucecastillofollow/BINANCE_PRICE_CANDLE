import express from "express";
import { pool } from "../db.js";
import { config } from "../config.js";
import { INTERVAL_OPTIONS } from "../constants.js";
import { isValidMarketName, sanitizeCsvValue, toHistoricalTableName, toLiveTableName } from "../utils.js";
import { enqueueMarketSync, getSyncQueueStatus } from "../services/syncQueue.js";
import { checkMarketOpenTimeGaps } from "../services/marketDataCheck.js";
import { getLiveStatus, setMarketLiveEnabled } from "../services/binanceLive.js";
import { canDownloadToday, getClientKey, recordDownload } from "../services/downloadLimit.js";

import { getIntervalStepMs } from "../intervalStep.js";

export const marketsRouter = express.Router();

const CHART_CANDLE_LIMIT = 5000;
const CHART_SELECT = "open_time, open, high, low, close";

function isAdminRequest(req) {
  const key = req.headers["x-admin-key"];
  return Boolean(config.adminApiKey && key && key === config.adminApiKey);
}

const LIST_SELECT = `
  id, name, interval, start_timestamp, last_timestamp, sync_status, sync_progress, sync_error,
  live_enabled, created_at, updated_at
`;

const CANDLE_SELECT = `
  open_time, open, high, low, close, volume, close_time,
  quote_asset_volume, number_of_trades, taker_buy_base_asset_volume,
  taker_buy_quote_asset_volume, ignore_value
`;

async function queryCandlesFromTable(tableName, start, end, { limit, chartOnly = false } = {}) {
  const columns = chartOnly ? CHART_SELECT : CANDLE_SELECT;
  const limitSql = limit ? `LIMIT ${Number(limit)}` : "";
  try {
    const result = await pool.query(
      `
      SELECT ${columns}
      FROM ${tableName}
      WHERE open_time >= $1 AND open_time <= $2
      ORDER BY open_time ASC
      ${limitSql}
      `,
      [start, end]
    );
    return result.rows;
  } catch (error) {
    if (error.message?.includes("does not exist")) {
      return [];
    }
    throw error;
  }
}

function effectiveChartStart(start, end, interval) {
  const stepMs = getIntervalStepMs(interval);
  const span = end - start;
  if (span <= 0) {
    return { queryStart: start, truncated: false };
  }
  const estimated = Math.ceil(span / stepMs) + 1;
  if (estimated <= CHART_CANDLE_LIMIT) {
    return { queryStart: start, truncated: false };
  }
  const queryStart = Math.max(start, end - CHART_CANDLE_LIMIT * stepMs);
  return { queryStart, truncated: queryStart > start };
}

function mergeCandlesByOpenTime(historicalRows, liveRows) {
  const map = new Map();
  for (const row of historicalRows) {
    map.set(String(row.open_time), row);
  }
  for (const row of liveRows) {
    map.set(String(row.open_time), row);
  }
  return [...map.entries()]
    .sort((a, b) => Number(a[0]) - Number(b[0]))
    .map(([, row]) => row);
}

/**
 * POST body: { market, interval, start_timestamp, end_timestamp }
 * (aliases: name, start, end)
 * Returns live rows, historical rows, and combined (same open_time: live overwrites historical).
 */
marketsRouter.post("/candles", async (req, res, next) => {
  try {
    const rawName = req.body.market ?? req.body.name;
    const interval = req.body.interval;
    const start = Number(req.body.start_timestamp ?? req.body.start);
    const end = Number(req.body.end_timestamp ?? req.body.end);

    if (!isValidMarketName(rawName)) {
      return res.status(400).json({ message: "Invalid market name" });
    }
    if (!INTERVAL_OPTIONS.includes(interval)) {
      return res.status(400).json({ message: "Invalid interval" });
    }
    if (!Number.isFinite(start) || !Number.isFinite(end) || end < start) {
      return res.status(400).json({ message: "Invalid start_timestamp or end_timestamp" });
    }

    const market = String(rawName).toUpperCase();
    const liveTable = toLiveTableName(market, interval);
    const histTable = toHistoricalTableName(market, interval);
    const liveCutoffMs = Date.now() - 48 * 60 * 60 * 1000;
    const forChart = req.body.chart !== false;
    const { queryStart, truncated } = forChart
      ? effectiveChartStart(start, end, interval)
      : { queryStart: start, truncated: false };
    const queryLimit = forChart ? CHART_CANDLE_LIMIT + 1 : undefined;

    try {
      await pool.query(`DELETE FROM ${liveTable} WHERE open_time < $1`, [liveCutoffMs]);
    } catch (error) {
      if (!error.message?.includes("does not exist")) {
        throw error;
      }
    }

    const [fromLive, fromHistorical] = await Promise.all([
      queryCandlesFromTable(liveTable, queryStart, end, { limit: queryLimit, chartOnly: forChart }),
      queryCandlesFromTable(histTable, queryStart, end, { limit: queryLimit, chartOnly: forChart }),
    ]);

    let combined = mergeCandlesByOpenTime(fromHistorical, fromLive);
    let resultTruncated = truncated;
    if (forChart && combined.length > CHART_CANDLE_LIMIT) {
      combined = combined.slice(-CHART_CANDLE_LIMIT);
      resultTruncated = true;
    }

    if (forChart) {
      return res.json({
        market,
        interval,
        start_timestamp: start,
        end_timestamp: end,
        effective_start_timestamp: queryStart,
        combined,
        count: combined.length,
        truncated: resultTruncated,
      });
    }

    res.json({
      market,
      interval,
      start_timestamp: start,
      end_timestamp: end,
      fromLive,
      fromHistorical,
      combined,
      counts: {
        fromLive: fromLive.length,
        fromHistorical: fromHistorical.length,
        combined: combined.length,
      },
    });
  } catch (error) {
    next(error);
  }
});

marketsRouter.get("/", async (_req, res, next) => {
  try {
    const page = Math.max(1, Number(_req.query.page ?? 1) || 1);
    const pageSize = Math.min(100, Math.max(1, Number(_req.query.pageSize ?? 10) || 10));
    const search = typeof _req.query.search === "string" ? _req.query.search.trim().toUpperCase() : "";
    const offset = (page - 1) * pageSize;
    const filterSql = search ? "WHERE name ILIKE $1" : "";
    const params = search ? [`%${search}%`] : [];

    const countResult = await pool.query(
      `SELECT COUNT(*)::int AS total FROM markets ${filterSql}`,
      params
    );
    const total = countResult.rows[0]?.total ?? 0;

    const result = await pool.query(
      `
      SELECT ${LIST_SELECT}
      FROM markets
      ${filterSql}
      ORDER BY id DESC
      LIMIT $${params.length + 1} OFFSET $${params.length + 2}
      `,
      [...params, pageSize, offset]
    );
    res.json({
      items: result.rows,
      page,
      pageSize,
      total,
      totalPages: Math.max(1, Math.ceil(total / pageSize)),
    });
  } catch (error) {
    next(error);
  }
});

marketsRouter.post("/", async (req, res, next) => {
  try {
    const { name, interval, start_timestamp: startTimestamp } = req.body;
    if (!isValidMarketName(name)) {
      return res.status(400).json({ message: "Invalid market name" });
    }
    if (!INTERVAL_OPTIONS.includes(interval)) {
      return res.status(400).json({ message: "Invalid interval" });
    }
    if (!Number.isFinite(Number(startTimestamp))) {
      return res.status(400).json({ message: "Invalid start_timestamp" });
    }

    const normalizedName = name.toUpperCase();
    const value = Number(startTimestamp);
    const result = await pool.query(
      `
        INSERT INTO markets (name, interval, start_timestamp, last_timestamp)
        VALUES ($1, $2, $3, $3)
        RETURNING ${LIST_SELECT}
      `,
      [normalizedName, interval, value]
    );
    const queueResult = enqueueMarketSync(result.rows[0].id);
    res.status(201).json({
      ...result.rows[0],
      sync_job: queueResult.reason,
    });
  } catch (error) {
    next(error);
  }
});

marketsRouter.delete("/:id", async (req, res, next) => {
  try {
    const { id } = req.params;
    const target = await pool.query("SELECT name, interval, live_enabled FROM markets WHERE id = $1", [
      Number(id),
    ]);
    if (!target.rowCount) {
      return res.status(404).json({ message: "Market not found" });
    }

    const { name, interval, live_enabled: liveEnabled } = target.rows[0];
    if (liveEnabled) {
      await setMarketLiveEnabled(Number(id), false);
    }

    const histTable = toHistoricalTableName(name, interval);
    const liveTable = toLiveTableName(name, interval);
    await pool.query(`DROP TABLE IF EXISTS ${histTable}`);
    await pool.query(`DROP TABLE IF EXISTS ${liveTable}`);
    await pool.query("DELETE FROM markets WHERE id = $1", [Number(id)]);
    res.status(204).send();
  } catch (error) {
    next(error);
  }
});

marketsRouter.post("/:id/sync", async (req, res, next) => {
  try {
    const { id } = req.params;
    const marketResult = await pool.query("SELECT * FROM markets WHERE id = $1", [Number(id)]);
    if (!marketResult.rowCount) {
      return res.status(404).json({ message: "Market not found" });
    }

    const queueResult = enqueueMarketSync(Number(id));
    res.status(202).json({
      message: queueResult.reason === "already_scheduled" ? "Sync already in progress or queued" : "Sync queued",
    });
  } catch (error) {
    next(error);
  }
});

marketsRouter.post("/:id/live", async (req, res, next) => {
  try {
    const id = Number(req.params.id);
    if (!Number.isFinite(id)) {
      return res.status(400).json({ message: "Invalid market id" });
    }
    if (typeof req.body?.enabled !== "boolean") {
      return res.status(400).json({ message: "Body must include enabled: boolean" });
    }
    const result = await setMarketLiveEnabled(id, req.body.enabled);
    if (!result.ok) {
      if (result.error === "not_found") {
        return res.status(404).json({ message: "Market not found" });
      }
      return res.status(400).json({ message: "Invalid request" });
    }
    const row = await pool.query("SELECT live_enabled FROM markets WHERE id = $1", [id]);
    res.json({ live_enabled: row.rows[0].live_enabled });
  } catch (error) {
    next(error);
  }
});

marketsRouter.get("/sync-status", (_req, res) => {
  res.json(getSyncQueueStatus());
});

marketsRouter.get("/live-status", (_req, res) => {
  res.json(getLiveStatus());
});

/** Gap check: expected open_time grid (default step from market interval; override with ?stepMs=60000). */
marketsRouter.get("/:id/data-check", async (req, res, next) => {
  try {
    const id = Number(req.params.id);
    if (!Number.isFinite(id)) {
      return res.status(400).json({ message: "Invalid market id" });
    }
    const maxReported = Math.min(5000, Math.max(1, Number(req.query.maxReported ?? 500) || 500));
    const stepMsRaw = req.query.stepMs;
    const stepMs =
      stepMsRaw === undefined || stepMsRaw === ""
        ? undefined
        : Number(stepMsRaw);
    if (stepMsRaw !== undefined && stepMsRaw !== "" && (!Number.isFinite(stepMs) || stepMs <= 0)) {
      return res.status(400).json({ message: "Invalid stepMs" });
    }

    const marketResult = await pool.query("SELECT * FROM markets WHERE id = $1", [id]);
    if (!marketResult.rowCount) {
      return res.status(404).json({ message: "Market not found" });
    }

    const payload = await checkMarketOpenTimeGaps(marketResult.rows[0], { stepMs, maxReported });
    res.json(payload);
  } catch (error) {
    if (error.message?.includes("does not exist")) {
      return res.status(404).json({ message: "Market candle table not found" });
    }
    next(error);
  }
});

marketsRouter.get("/download-status", async (req, res, next) => {
  try {
    if (isAdminRequest(req)) {
      return res.json({ canDownload: true, isAdmin: true });
    }
    const clientKey = getClientKey(req);
    const canDownload = await canDownloadToday(clientKey);
    res.json({ canDownload, isAdmin: false });
  } catch (error) {
    next(error);
  }
});

marketsRouter.get("/download", async (req, res, next) => {
  try {
    const admin = isAdminRequest(req);
    if (!admin) {
      const clientKey = getClientKey(req);
      const allowed = await canDownloadToday(clientKey);
      if (!allowed) {
        return res.status(429).json({ message: "CSV download limit reached (once per day)" });
      }
    }

    const { market, interval, start, end } = req.query;
    if (!isValidMarketName(market)) {
      return res.status(400).json({ message: "Invalid market name query" });
    }
    if (!INTERVAL_OPTIONS.includes(interval)) {
      return res.status(400).json({ message: "Invalid interval query" });
    }
    const startTimestamp = Number(start);
    const endTimestamp = Number(end);
    if (!Number.isFinite(startTimestamp) || !Number.isFinite(endTimestamp) || endTimestamp < startTimestamp) {
      return res.status(400).json({ message: "Invalid start/end range" });
    }

    const tableName = toHistoricalTableName(market.toUpperCase(), interval);
    const result = await pool.query(
      `
      SELECT open_time, open, high, low, close, volume, close_time,
             quote_asset_volume, number_of_trades, taker_buy_base_asset_volume,
             taker_buy_quote_asset_volume, ignore_value
      FROM ${tableName}
      WHERE open_time >= $1 AND open_time <= $2
      ORDER BY open_time ASC
      `,
      [startTimestamp, endTimestamp]
    );

    const headers = [
      "Open time",
      "Open",
      "High",
      "Low",
      "Close",
      "Volume",
      "Close time",
      "Quote asset volume",
      "Number of trades",
      "Taker buy base asset volume",
      "Taker buy quote asset volume",
      "Ignore",
    ];

    const lines = [headers.join(",")];
    for (const row of result.rows) {
      lines.push(
        [
          row.open_time,
          row.open,
          row.high,
          row.low,
          row.close,
          row.volume,
          row.close_time,
          row.quote_asset_volume,
          row.number_of_trades,
          row.taker_buy_base_asset_volume,
          row.taker_buy_quote_asset_volume,
          row.ignore_value ?? "",
        ]
          .map(sanitizeCsvValue)
          .join(",")
      );
    }

    const filename = `${market.toUpperCase()}-${interval}-${startTimestamp}-${endTimestamp}.csv`;
    res.setHeader("Content-Type", "text/csv");
    res.setHeader("Content-Disposition", `attachment; filename="${filename}"`);
    res.send(lines.join("\n"));

    if (!admin) {
      await recordDownload(getClientKey(req));
    }
  } catch (error) {
    if (error.message.includes("does not exist")) {
      return res.status(404).json({ message: "Market table does not exist. Sync data first." });
    }
    next(error);
  }
});
