import assert from 'node:assert/strict';
import test from 'node:test';
import {
  firstCalendarDayToFetch,
  getMarketSyncDelayDays,
  selectAutoSyncMarkets,
} from '../src/services/marketSyncDelay.js';

const day = Date.UTC(2026, 8, 26);
const nextDay = day + 24 * 60 * 60 * 1000;
const at = (hour, minute) => day + hour * 60 * 60 * 1000 + minute * 60 * 1000;

test('day completion uses the final candle open time for 1m and 5m', () => {
  assert.equal(firstCalendarDayToFetch(at(23, 57), '1m').valueOf(), day);
  assert.equal(firstCalendarDayToFetch(at(23, 58), '1m').valueOf(), nextDay);
  assert.equal(firstCalendarDayToFetch(at(23, 50), '5m').valueOf(), day);
  assert.equal(firstCalendarDayToFetch(at(23, 55), '5m').valueOf(), nextDay);
});

test('a completed 5m day is not queued again', () => {
  const todayStart = new Date();
  todayStart.setUTCHours(0, 0, 0, 0);
  const yesterday = todayStart.valueOf() - 24 * 60 * 60 * 1000;
  const market = {
    name: 'BTCUSDT',
    interval: '5m',
    start_timestamp: yesterday,
    last_timestamp: yesterday + 23 * 60 * 60 * 1000 + 55 * 60 * 1000,
    sync_status: 'finished',
  };
  assert.equal(getMarketSyncDelayDays(market), 0);
  assert.equal(selectAutoSyncMarkets([market], new Set()).length, 0);

  const incomplete = { ...market, last_timestamp: market.last_timestamp - 5 * 60 * 1000 };
  assert.equal(getMarketSyncDelayDays(incomplete), 1);
  assert.equal(selectAutoSyncMarkets([incomplete], new Set()).length, 1);
});
