import dayjs from "dayjs";
import utc from "dayjs/plugin/utc.js";

dayjs.extend(utc);

const MIN_KLINE_MS = Date.UTC(2010, 0, 1);

function maxKlineMs() {
  return Date.now() + 2 * 24 * 60 * 60 * 1000;
}

function toFiniteMs(value) {
  if (value === null || value === undefined) {
    return null;
  }
  const n = typeof value === "bigint" ? Number(value) : Number(value);
  if (!Number.isFinite(n)) {
    return null;
  }
  return n;
}

function isPlausibleKlineMs(ms) {
  return ms >= MIN_KLINE_MS && ms <= maxKlineMs();
}

/**
 * Same rule as binanceSync: next calendar day to fetch from `lastMs`.
 */
export function firstCalendarDayToFetch(lastMs) {
  const sod = dayjs(lastMs).utc().startOf("day");
  const msIntoDay = lastMs - sod.valueOf();
  const fullDayMs = 24 * 60 * 60 * 1000;
  if (msIntoDay >= fullDayMs - 2 * 60 * 1000) {
    return sod.add(1, "day");
  }
  return sod;
}

/**
 * Calendar days from the next fetch day through yesterday (UTC). 0 = caught up.
 */
export function getMarketSyncDelayDays(market) {
  let startMs = toFiniteMs(market.start_timestamp);
  let lastMs = toFiniteMs(market.last_timestamp);
  if (startMs === null || !isPlausibleKlineMs(startMs)) {
    startMs = MIN_KLINE_MS;
  }
  if (lastMs === null || lastMs < startMs || !isPlausibleKlineMs(lastMs)) {
    lastMs = startMs;
  }

  const yesterday = dayjs().utc().startOf("day").subtract(1, "day");
  const startDate = dayjs(startMs).utc().startOf("day");
  let currentDate = firstCalendarDayToFetch(lastMs);
  if (currentDate.isBefore(startDate)) {
    currentDate = startDate;
  }

  if (currentDate.isAfter(yesterday)) {
    return 0;
  }
  return yesterday.diff(currentDate, "day") + 1;
}

export function marketNeedsSync(market) {
  if (market.sync_status === "failed") {
    return true;
  }
  return getMarketSyncDelayDays(market) > 0;
}

/** Markets needing sync, highest delay first. */
export function sortMarketsBySyncDelay(markets) {
  return [...markets]
    .filter(marketNeedsSync)
    .map((market) => ({
      market,
      delayDays: getMarketSyncDelayDays(market),
    }))
    .sort((a, b) => b.delayDays - a.delayDays);
}
