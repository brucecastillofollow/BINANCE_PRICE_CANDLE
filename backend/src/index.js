import { createApp } from "./app.js";
import { config } from "./config.js";
import { closeDb, initDb } from "./db.js";
import { pool } from "./db.js";
import { enqueueMarketSync } from "./services/syncQueue.js";
import { initLiveFromDb, shutdownLive } from "./services/binanceLive.js";
import { startDailyMarketSync } from "./services/dailySyncSchedule.js";

async function syncAllMarkets() {
  const result = await pool.query("SELECT * FROM markets");
  for (const market of result.rows) {
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

  // Do not block API startup on potentially long historical sync.
  syncAllMarkets().catch((error) => {
    console.error("Initial background sync failed", error.message);
  });

  const stopDailySync = startDailyMarketSync(syncAllMarkets, {
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
