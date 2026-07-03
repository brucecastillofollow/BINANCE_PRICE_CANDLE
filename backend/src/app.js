import cors from "cors";
import express from "express";
import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";
import { config } from "./config.js";
import { INTERVAL_OPTIONS } from "./constants.js";
import { marketsRouter } from "./routes/markets.js";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const frontendDist = path.resolve(__dirname, "../../frontend/dist");

export function createApp() {
  const app = express();
  if (config.trustProxy) {
    app.set("trust proxy", 1);
  }
  app.use(cors({ origin: config.corsOrigin }));
  app.use(express.json());

  app.get("/health", (_req, res) => {
    res.json({ ok: true });
  });

  app.get("/interval-options", (_req, res) => {
    res.json(INTERVAL_OPTIONS);
  });

  app.use("/markets", marketsRouter);

  if (fs.existsSync(frontendDist)) {
    app.use(express.static(frontendDist));
    app.get(["/", "/admin-views", "/admin-views/*"], (_req, res) => {
      res.sendFile(path.join(frontendDist, "index.html"));
    });
  }

  app.use((error, _req, res, _next) => {
    console.error(error);
    if (error.code === "23505") {
      return res.status(409).json({ message: "Market with this name and interval already exists" });
    }
    res.status(500).json({ message: "Internal server error" });
  });

  return app;
}
