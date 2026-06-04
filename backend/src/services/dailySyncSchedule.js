import dayjs from "dayjs";
import utc from "dayjs/plugin/utc.js";

dayjs.extend(utc);

function msUntilNextRun(hourUtc, minuteUtc) {
  const now = dayjs().utc();
  let next = now.startOf("day").hour(hourUtc).minute(minuteUtc).second(0).millisecond(0);
  if (!next.isAfter(now)) {
    next = next.add(1, "day");
  }
  return next.diff(now);
}

/**
 * Run `syncAllMarkets` once per calendar day at the given UTC time (default 01:00).
 * Binance Vision daily ZIPs for "yesterday" are typically available after midnight UTC.
 */
export function startDailyMarketSync(syncAllMarkets, options = {}) {
  const hourUtc = Math.min(23, Math.max(0, Number(options.hourUtc ?? 1) || 0));
  const minuteUtc = Math.min(59, Math.max(0, Number(options.minuteUtc ?? 0) || 0));
  let timer = null;

  const scheduleNext = () => {
    const delayMs = msUntilNextRun(hourUtc, minuteUtc);
    const nextAt = dayjs().utc().add(delayMs, "millisecond");
    console.log(
      `Next daily market sync at ${nextAt.format("YYYY-MM-DD HH:mm")} UTC (in ${Math.round(delayMs / 60000)} min)`
    );
    timer = setTimeout(() => {
      void runAndReschedule();
    }, delayMs);
  };

  const runAndReschedule = async () => {
    console.log("Daily market sync started");
    try {
      await syncAllMarkets();
    } catch (error) {
      console.error("Daily market sync failed", error.message);
    }
    scheduleNext();
  };

  scheduleNext();

  return () => {
    if (timer) {
      clearTimeout(timer);
      timer = null;
    }
  };
}
