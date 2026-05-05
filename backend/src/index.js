import { createApp } from "./app.js";
import { config } from "./config.js";
import { closeDb, initDb } from "./db.js";
import { pool } from "./db.js";
import { syncMarketData } from "./services/binanceSync.js";

async function syncAllMarkets() {
  const result = await pool.query("SELECT * FROM markets");
  for (const market of result.rows) {
    try {
      await syncMarketData(market);
    } catch (error) {
      console.error(`Sync failed for ${market.name}`, error.message);
    }
  }
}

async function bootstrap() {
  await initDb();
  await syncAllMarkets();

  const app = createApp();
  const server = app.listen(config.port, () => {
    console.log(`Backend listening on http://localhost:${config.port}`);
  });

  process.on("SIGINT", async () => {
    console.log("Shutting down...");
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
