import assert from "node:assert/strict";
import test from "node:test";
import { createApp } from "../src/app.js";
import { pool } from "../src/db.js";

test("availability uses the first downloadable candle and handles markets before sync", async () => {
  const originalQuery = pool.query;
  let candleState = "stored";
  let queryCount = 0;

  pool.query = async (sql, values = []) => {
    queryCount += 1;
    const statement = String(sql).replace(/\s+/g, " ").trim();
    if (statement === "SELECT id, name, interval, start_timestamp FROM markets WHERE id = $1") {
      return values[0] === 6
        ? {
            rowCount: 1,
            rows: [{ id: 6, name: "BNBUSDT", interval: "5m", start_timestamp: "1483228800000" }],
          }
        : { rowCount: 0, rows: [] };
    }
    assert.equal(statement, "SELECT open_time FROM market_bnbusdt_5m ORDER BY open_time ASC LIMIT 1");
    if (candleState === "missing") {
      const error = new Error("relation does not exist");
      error.code = "42P01";
      throw error;
    }
    return candleState === "empty"
      ? { rows: [] }
      : { rows: [{ open_time: "1509926400000" }] };
  };

  const server = createApp().listen(0, "127.0.0.1");
  try {
    await new Promise((resolve) => server.once("listening", resolve));
    const base = `http://127.0.0.1:${server.address().port}`;

    let response = await fetch(`${base}/markets/6/availability`);
    assert.equal(response.status, 200);
    assert.deepEqual(await response.json(), {
      market_id: 6,
      start_timestamp: "1483228800000",
      first_available_timestamp: "1509926400000",
    });

    candleState = "empty";
    response = await fetch(`${base}/markets/6/availability`);
    assert.equal(response.status, 200);
    assert.equal((await response.json()).first_available_timestamp, null);

    candleState = "missing";
    response = await fetch(`${base}/markets/6/availability`);
    assert.equal(response.status, 200);
    assert.equal((await response.json()).first_available_timestamp, null);

    const beforeInvalidId = queryCount;
    response = await fetch(`${base}/markets/6e0/availability`);
    assert.equal(response.status, 400);
    assert.equal(queryCount, beforeInvalidId);

    response = await fetch(`${base}/markets/999/availability`);
    assert.equal(response.status, 404);
  } finally {
    await new Promise((resolve) => server.close(resolve));
    pool.query = originalQuery;
  }
});
