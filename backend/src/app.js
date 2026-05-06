import cors from "cors";
import express from "express";
import { config } from "./config.js";
import { INTERVAL_OPTIONS } from "./constants.js";
import { marketsRouter } from "./routes/markets.js";

export function createApp() {
  const app = express();
  app.use(cors({ origin: config.corsOrigin }));
  app.use(express.json());

  app.get("/health", (_req, res) => {
    res.json({ ok: true });
  });

  app.get("/interval-options", (_req, res) => {
    res.json(INTERVAL_OPTIONS);
  });

  app.use("/markets", marketsRouter);

  app.use((error, _req, res, _next) => {
    console.error(error);
    if (error.code === "23505") {
      return res.status(409).json({ message: "Market with this name and interval already exists" });
    }
    res.status(500).json({ message: "Internal server error" });
  });

  return app;
}
