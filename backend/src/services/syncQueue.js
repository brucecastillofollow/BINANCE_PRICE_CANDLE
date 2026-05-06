import { pool } from "../db.js";
import { config } from "../config.js";
import { syncMarketData } from "./binanceSync.js";

const queuedMarketIds = new Set();
const runningMarketIds = new Set();
const pendingQueue = [];

let activeWorkers = 0;
const maxWorkers = Math.max(1, Number(config.syncWorkerCount) || 1);

async function runWorker() {
  if (activeWorkers >= maxWorkers) {
    return;
  }

  activeWorkers += 1;
  try {
    while (pendingQueue.length > 0) {
      const marketId = pendingQueue.shift();
      queuedMarketIds.delete(marketId);
      if (runningMarketIds.has(marketId)) {
        continue;
      }

      runningMarketIds.add(marketId);
      try {
        const result = await pool.query("SELECT * FROM markets WHERE id = $1", [marketId]);
        if (!result.rowCount) {
          continue;
        }
        await syncMarketData(result.rows[0]);
      } catch (error) {
        console.error(`Sync job failed for market id ${marketId}`, error.message);
      } finally {
        runningMarketIds.delete(marketId);
      }
    }
  } finally {
    activeWorkers -= 1;
    // If new jobs arrived while worker was shutting down, kick again.
    if (pendingQueue.length > 0 && activeWorkers < maxWorkers) {
      void runWorker();
    }
  }
}

export function enqueueMarketSync(marketId) {
  const numericMarketId = Number(marketId);
  if (!Number.isFinite(numericMarketId)) {
    return { accepted: false, reason: "invalid_id" };
  }
  if (queuedMarketIds.has(numericMarketId) || runningMarketIds.has(numericMarketId)) {
    return { accepted: false, reason: "already_scheduled" };
  }

  queuedMarketIds.add(numericMarketId);
  pendingQueue.push(numericMarketId);
  void pool.query(
    `
    UPDATE markets
    SET sync_status = 'queued', sync_error = NULL, updated_at = NOW()
    WHERE id = $1 AND sync_status <> 'syncing'
    `,
    [numericMarketId]
  );
  void runWorker();
  return { accepted: true, reason: "queued" };
}

export function getSyncQueueStatus() {
  return {
    maxWorkers,
    activeWorkers,
    queued: pendingQueue.length,
    runningMarketIds: [...runningMarketIds],
  };
}
