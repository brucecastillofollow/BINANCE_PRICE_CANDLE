import express from "express";
import { pool } from "../db.js";
import { INTERVAL_OPTIONS } from "../constants.js";
import { isValidMarketName, sanitizeCsvValue, toTableName } from "../utils.js";
import { syncMarketData } from "../services/binanceSync.js";

export const marketsRouter = express.Router();

marketsRouter.get("/", async (_req, res, next) => {
  try {
    const result = await pool.query(
      "SELECT id, name, interval, start_timestamp, last_timestamp, created_at, updated_at FROM markets ORDER BY id DESC"
    );
    res.json(result.rows);
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
        RETURNING id, name, interval, start_timestamp, last_timestamp, created_at, updated_at
      `,
      [normalizedName, interval, value]
    );
    res.status(201).json(result.rows[0]);
  } catch (error) {
    next(error);
  }
});

marketsRouter.put("/:id", async (req, res, next) => {
  try {
    const { id } = req.params;
    const { interval, start_timestamp: startTimestamp } = req.body;

    if (!INTERVAL_OPTIONS.includes(interval)) {
      return res.status(400).json({ message: "Invalid interval" });
    }
    if (!Number.isFinite(Number(startTimestamp))) {
      return res.status(400).json({ message: "Invalid start_timestamp" });
    }

    const result = await pool.query(
      `
      UPDATE markets
      SET interval = $1, start_timestamp = $2, updated_at = NOW()
      WHERE id = $3
      RETURNING id, name, interval, start_timestamp, last_timestamp, created_at, updated_at
      `,
      [interval, Number(startTimestamp), Number(id)]
    );

    if (!result.rowCount) {
      return res.status(404).json({ message: "Market not found" });
    }
    res.json(result.rows[0]);
  } catch (error) {
    next(error);
  }
});

marketsRouter.delete("/:id", async (req, res, next) => {
  try {
    const { id } = req.params;
    const target = await pool.query("SELECT name FROM markets WHERE id = $1", [Number(id)]);
    if (!target.rowCount) {
      return res.status(404).json({ message: "Market not found" });
    }

    const tableName = toTableName(target.rows[0].name);
    await pool.query(`DROP TABLE IF EXISTS ${tableName}`);
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

    await syncMarketData(marketResult.rows[0]);
    const refreshed = await pool.query(
      "SELECT id, name, interval, start_timestamp, last_timestamp, created_at, updated_at FROM markets WHERE id = $1",
      [Number(id)]
    );
    res.json(refreshed.rows[0]);
  } catch (error) {
    next(error);
  }
});

marketsRouter.get("/download", async (req, res, next) => {
  try {
    const { market, start, end } = req.query;
    if (!isValidMarketName(market)) {
      return res.status(400).json({ message: "Invalid market name query" });
    }
    const startTimestamp = Number(start);
    const endTimestamp = Number(end);
    if (!Number.isFinite(startTimestamp) || !Number.isFinite(endTimestamp) || endTimestamp < startTimestamp) {
      return res.status(400).json({ message: "Invalid start/end range" });
    }

    const tableName = toTableName(market.toUpperCase());
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

    const filename = `${market.toUpperCase()}-${startTimestamp}-${endTimestamp}.csv`;
    res.setHeader("Content-Type", "text/csv");
    res.setHeader("Content-Disposition", `attachment; filename="${filename}"`);
    res.send(lines.join("\n"));
  } catch (error) {
    if (error.message.includes("does not exist")) {
      return res.status(404).json({ message: "Market table does not exist. Sync data first." });
    }
    next(error);
  }
});
