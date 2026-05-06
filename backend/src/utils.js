import { INTERVAL_OPTIONS } from "./constants.js";

export function isValidMarketName(value) {
  return typeof value === "string" && /^[A-Z0-9]{5,20}$/.test(value.trim());
}

export function assertValidInterval(interval) {
  if (!INTERVAL_OPTIONS.includes(interval)) {
    throw new Error(`Invalid interval: ${interval}`);
  }
}

/** Safe suffix for SQL identifiers (e.g. 1m, 1h, 1mo). */
export function intervalTableSuffix(interval) {
  assertValidInterval(interval);
  return interval.toLowerCase().replace(/[^a-z0-9]/g, "_");
}

/** Historical daily-sync table: market_{symbol}_{interval} */
export function toHistoricalTableName(marketName, interval) {
  return `market_${marketName.toLowerCase()}_${intervalTableSuffix(interval)}`;
}

/** Live websocket table: live_{symbol}_{interval} */
export function toLiveTableName(marketName, interval) {
  return `live_${marketName.toLowerCase()}_${intervalTableSuffix(interval)}`;
}

/** Binance stream uses 1M for monthly klines; our DB uses 1mo. */
export function intervalToBinanceStreamToken(interval) {
  assertValidInterval(interval);
  if (interval === "1mo") {
    return "1M";
  }
  return interval;
}

/**
 * Binance Vision daily kline CSV historically used open/close time in Unix **milliseconds**
 * (~1e12). Newer files use **microseconds** (~1e15+). Normalize to integer ms for storage.
 */
export function normalizeBinanceCsvTimeMs(raw) {
  const n = Number(String(raw).trim());
  if (!Number.isFinite(n)) {
    return null;
  }
  if (n >= 1e15) {
    return Math.trunc(n / 1000);
  }
  return Math.trunc(n);
}

export function sanitizeCsvValue(value) {
  if (value === null || value === undefined) {
    return "";
  }
  const text = String(value);
  if (/[,"\n]/.test(text)) {
    return `"${text.replaceAll('"', '""')}"`;
  }
  return text;
}
