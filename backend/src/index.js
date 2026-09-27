import { createApp } from "./app.js";
import { config, validateEnv } from "./config.js";

validateEnv();
import { closeDb, initDb } from "./db.js";
import { pool } from "./db.js";
import { enqueueMarketSync } from "./services/syncQueue.js";
import { initLiveFromDb, shutdownLive } from "./services/binanceLive.js";
import { startDailyMarketSync } from "./services/dailySyncSchedule.js";
import { sortMarketsBySyncDelay, selectAutoSyncMarkets } from "./services/marketSyncDelay.js";

/** Enqueue only markets behind yesterday; most delayed first. */
async function syncDelayedMarketsFirst() {
  const result = await pool.query("SELECT * FROM markets");
  const allDelayed = sortMarketsBySyncDelay(result.rows);
  const delayed = selectAutoSyncMarkets(result.rows, config.autoSyncExcludedMarkets);
  const upToDate = result.rows.length - allDelayed.length;
  const excluded = allDelayed.length - delayed.length;

  if (!delayed.length) {
    console.log(`Startup sync: no markets queued (${upToDate} up to date, ${excluded} excluded)`);
    return;
  }

  console.log(
    `Startup sync: ${delayed.length} market(s) behind (${upToDate} up to date, ${excluded} excluded), fetching by delay`
  );
  for (const { market, delayDays } of delayed) {
    console.log(`  queue ${market.name} ${market.interval}: ${delayDays} day(s) behind`);
    enqueueMarketSync(market.id);
  }
}

async function bootstrap() {
  await initDb();

  const app = createApp();
  const server = app.listen(config.port, () => {
    console.log(`Backend listening on http://localhost:${config.port}`);
  });

  initLiveFromDb().catch((error) => {
    console.error("Live stream init failed", error.message);
  });

  // Check delay per market, then fetch only those behind (most delayed first).
  syncDelayedMarketsFirst().catch((error) => {
    console.error("Initial background sync failed", error.message);
  });

  const stopDailySync = startDailyMarketSync(syncDelayedMarketsFirst, {
    hourUtc: config.dailySyncHourUtc,
  });

  process.on("SIGINT", async () => {
    console.log("Shutting down...");
    stopDailySync();
    shutdownLive();
    server.close(async () => {
      await closeDb();
      process.exit(0);
    });
  });
}

bootstrap().catch((error) => {
  console.error(error);
  process.exit(1);
});
