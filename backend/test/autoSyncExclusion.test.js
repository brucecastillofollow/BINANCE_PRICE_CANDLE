import assert from 'node:assert/strict';
import test from 'node:test';
import { selectAutoSyncMarkets } from '../src/services/marketSyncDelay.js';

const yesterday = Date.now() - 24 * 60 * 60 * 1000;
const markets = [
  { name: 'BTCUSDT', interval: '1m', start_timestamp: yesterday, last_timestamp: yesterday, sync_status: 'failed' },
  { name: 'BTCUSDT', interval: '5m', start_timestamp: yesterday, last_timestamp: yesterday, sync_status: 'failed' },
  { name: 'ETHUSDT', interval: '1m', start_timestamp: yesterday, last_timestamp: yesterday, sync_status: 'failed' },
];

test('automatic sync excludes only the configured symbol and interval', () => {
  const selected = selectAutoSyncMarkets(markets, new Set(['BTCUSDT:1m']));
  assert.deepEqual(
    new Set(selected.map(({ market }) => `${market.name}:${market.interval}`)),
    new Set(['BTCUSDT:5m', 'ETHUSDT:1m'])
  );
  assert.equal(markets[0].sync_status, 'failed');
});

test('automatic sync keeps all delayed markets when no exclusions are configured', () => {
  assert.equal(selectAutoSyncMarkets(markets, new Set()).length, 3);
});
