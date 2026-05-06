/** Binance kline step in milliseconds (UTC-aligned series). */
const STEP_MS = {
  "1m": 60_000,
  "3m": 180_000,
  "5m": 300_000,
  "15m": 900_000,
  "30m": 1_800_000,
  "1h": 3_600_000,
  "2h": 7_200_000,
  "4h": 14_400_000,
  "6h": 21_600_000,
  "8h": 28_800_000,
  "12h": 43_200_000,
  "1d": 86_400_000,
  "3d": 259_200_000,
  "1w": 604_800_000,
  /** Calendar months vary; this is an approximation for gap heuristics only. */
  "1mo": 2_592_000_000,
};

export function getIntervalStepMs(interval) {
  const ms = STEP_MS[interval];
  if (!ms) {
    throw new Error(`Unknown interval: ${interval}`);
  }
  return ms;
}
