import { pool } from "../db.js";
import { getIntervalStepMs } from "../intervalStep.js";
import { toHistoricalTableName } from "../utils.js";

function assertSafeTableName(tableName) {
  if (!/^market_[a-z0-9]+_[a-z0-9]+$/.test(tableName)) {
    throw new Error("Invalid market table name");
  }
  return tableName;
}

function toBigIntMs(value) {
  if (value === null || value === undefined) {
    return null;
  }
  try {
    return BigInt(String(value));
  } catch {
    return null;
  }
}

function floorToStep(ms, step) {
  return (ms / step) * step;
}

function ceilToStep(ms, step) {
  if (ms % step === 0n) {
    return ms;
  }
  return (ms / step + 1n) * step;
}

function expandMissingOpenTimes(firstMissing, count, stepMs, maxSamples) {
  const step = BigInt(stepMs);
  let t = BigInt(firstMissing);
  const out = [];
  let n = Number(count);
  if (!Number.isFinite(n) || n <= 0) {
    return { samples: out, truncated: false };
  }
  const cap = Math.min(n, maxSamples);
  for (let i = 0; i < cap; i += 1) {
    out.push(t.toString());
    t += step;
  }
  return { samples: out, truncated: n > maxSamples };
}

/**
 * Detect missing expected open_time slots (fixed step, default 60s for 1m markets).
 */
export async function checkMarketOpenTimeGaps(market, options = {}) {
  const stepMs = options.stepMs ?? getIntervalStepMs(market.interval);
  const maxReported = Math.min(5000, Math.max(1, Number(options.maxReported ?? 500) || 500));
  const tableName = assertSafeTableName(toHistoricalTableName(market.name, market.interval));

  const bounds = await pool.query(
    `
    SELECT
      MIN(open_time)::text AS lo,
      MAX(open_time)::text AS hi,
      COUNT(*)::text AS n
    FROM ${tableName}
    `
  );

  const row = bounds.rows[0];
  const n = Number(row?.n ?? 0);
  if (!n) {
    return {
      market: market.name,
      interval: market.interval,
      stepMs,
      table: tableName,
      rowCount: 0,
      alignedRangeStartMs: null,
      alignedRangeEndMs: null,
      totalMissingSlots: 0,
      missingOpenTimes: [],
      missingTruncated: false,
      gaps: [],
      irregularPairs: [],
    };
  }

  const minT = toBigIntMs(row.lo);
  const maxT = toBigIntMs(row.hi);
  const step = BigInt(stepMs);
  const startMs = toBigIntMs(market.start_timestamp) ?? minT;
  const endMs = toBigIntMs(market.last_timestamp) ?? maxT;

  const alignedRangeStart = ceilToStep(startMs, step);
  const alignedRangeEnd = floorToStep(endMs, step);

  const gaps = [];
  let totalMissing = 0n;
  const irregularPairs = [];

  const rangeOk = alignedRangeEnd >= alignedRangeStart;
  if (!rangeOk) {
    irregularPairs.push({
      kind: "range_inverted",
      alignedRangeStartMs: alignedRangeStart.toString(),
      alignedRangeEndMs: alignedRangeEnd.toString(),
    });
  }

  /** Leading: grid opens in [alignedRangeStart, minT) */
  if (rangeOk && minT > alignedRangeStart) {
    const delta = minT - alignedRangeStart;
    if (delta % step !== 0n) {
      irregularPairs.push({
        kind: "leading_misaligned",
        alignedRangeStartMs: alignedRangeStart.toString(),
        firstOpenTimeMs: minT.toString(),
        remainderMs: (delta % step).toString(),
      });
    } else {
      const missingCount = delta / step;
      if (missingCount > 0n) {
        const firstMissing = alignedRangeStart;
        gaps.push({
          kind: "leading",
          firstMissingOpenTimeMs: firstMissing.toString(),
          lastMissingOpenTimeMs: (minT - step).toString(),
          missingCount: missingCount.toString(),
        });
        totalMissing += missingCount;
      }
    }
  }

  const internal = await pool.query(
    `
    WITH ordered AS (
      SELECT open_time::bigint AS t,
             LAG(open_time::bigint) OVER (ORDER BY open_time) AS prev_t
      FROM ${tableName}
    )
    SELECT prev_t::text AS prev_t,
           t::text AS t,
           (t - prev_t) AS delta
    FROM ordered
    WHERE prev_t IS NOT NULL AND (t - prev_t) > $1
    `,
    [stepMs]
  );

  for (const r of internal.rows) {
    const prevT = toBigIntMs(r.prev_t);
    const t = toBigIntMs(r.t);
    const delta = t - prevT;
    if (delta % step !== 0n) {
      irregularPairs.push({
        kind: "internal_irregular_delta",
        prevOpenTimeMs: prevT.toString(),
        nextOpenTimeMs: t.toString(),
        deltaMs: delta.toString(),
      });
      continue;
    }
    const missingCount = delta / step - 1n;
    if (missingCount <= 0n) {
      continue;
    }
    const firstMissing = prevT + step;
    const lastMissing = t - step;
    gaps.push({
      kind: "internal",
      afterOpenTimeMs: prevT.toString(),
      beforeOpenTimeMs: t.toString(),
      firstMissingOpenTimeMs: firstMissing.toString(),
      lastMissingOpenTimeMs: lastMissing.toString(),
      missingCount: missingCount.toString(),
    });
    totalMissing += missingCount;
  }

  /** Trailing: grid opens in (maxT, alignedRangeEnd] */
  if (rangeOk && maxT < alignedRangeEnd) {
    const delta = alignedRangeEnd - maxT;
    if (delta % step !== 0n) {
      irregularPairs.push({
        kind: "trailing_misaligned",
        lastOpenTimeMs: maxT.toString(),
        alignedRangeEndMs: alignedRangeEnd.toString(),
        remainderMs: (delta % step).toString(),
      });
    } else {
      const missingCount = delta / step;
      if (missingCount > 0n) {
        const firstMissing = maxT + step;
        gaps.push({
          kind: "trailing",
          firstMissingOpenTimeMs: firstMissing.toString(),
          lastMissingOpenTimeMs: alignedRangeEnd.toString(),
          missingCount: missingCount.toString(),
        });
        totalMissing += missingCount;
      }
    }
  }

  const missingOpenTimes = [];
  let truncated = false;
  let budget = maxReported;
  for (const g of gaps) {
    if (budget <= 0) {
      truncated = true;
      break;
    }
    const c = Number(g.missingCount);
    const first = g.firstMissingOpenTimeMs;
    const { samples, truncated: t2 } = expandMissingOpenTimes(first, c, stepMs, budget);
    missingOpenTimes.push(...samples);
    budget -= samples.length;
    if (t2 || c > samples.length) {
      truncated = true;
    }
  }

  return {
    market: market.name,
    interval: market.interval,
    stepMs,
    table: tableName,
    rowCount: n,
    minOpenTimeMs: minT.toString(),
    maxOpenTimeMs: maxT.toString(),
    marketStartMs: startMs.toString(),
    marketLastMs: endMs.toString(),
    alignedRangeStartMs: alignedRangeStart.toString(),
    alignedRangeEndMs: alignedRangeEnd.toString(),
    totalMissingSlots: totalMissing.toString(),
    missingOpenTimes,
    missingTruncated: truncated,
    gaps,
    irregularPairs,
  };
}
