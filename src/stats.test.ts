import assert from 'node:assert/strict';
import { test } from 'node:test';
import { summarize } from './stats.js';

test('summarize: среднее, медиана, скорость считаются по успешным', () => {
  const s = summarize([
    { ok: true, seconds: 1, bytes: 1e6 },
    { ok: true, seconds: 3, bytes: 3e6 },
    { ok: false, error: 'boom' },
  ]);
  assert.equal(s.requested, 3);
  assert.equal(s.okCount, 2);
  assert.equal(s.failedCount, 1);
  assert.equal(s.totalBytes, 4e6);
  assert.equal(s.avgSeconds, 2);
  assert.equal(s.medianSeconds, 2);
  assert.equal(s.minSeconds, 1);
  assert.equal(s.maxSeconds, 3);
  assert.equal(s.mbytePerSec, 1);
  assert.equal(s.mbitPerSec, 8);
});

test('summarize: медиана для нечётного числа', () => {
  const s = summarize([
    { ok: true, seconds: 5, bytes: 1 },
    { ok: true, seconds: 1, bytes: 1 },
    { ok: true, seconds: 2, bytes: 1 },
  ]);
  assert.equal(s.medianSeconds, 2);
});

test('summarize: без успешных запросов нули, а не NaN', () => {
  const s = summarize([{ ok: false, error: 'x' }]);
  assert.equal(s.okCount, 0);
  assert.equal(s.avgSeconds, 0);
  assert.equal(s.mbitPerSec, 0);
});
