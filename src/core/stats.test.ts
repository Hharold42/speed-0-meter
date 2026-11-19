import assert from 'node:assert/strict';
import { test } from 'node:test';
import { percentile, summarize } from './stats.js';
import type { RequestResult } from './types.js';

const ok = (seconds: number, bytes: number, ttfbSeconds = 0): RequestResult => ({
  ok: true,
  seconds,
  ttfbSeconds,
  bytes,
  attempts: 1,
});

test('summarize: среднее, медиана, скорость считаются по успешным', () => {
  const s = summarize([ok(1, 1e6), ok(3, 3e6), { ok: false, error: 'boom', attempts: 1 }]);
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

test('summarize: скорость без TTFB выше полной', () => {
  // 1 с на запрос, из них 0.5 с — ожидание первого байта.
  const s = summarize([ok(1, 1e6, 0.5), ok(1, 1e6, 0.5)]);
  assert.equal(s.mbytePerSec, 1);
  assert.equal(s.downloadMbytePerSec, 2);
  assert.equal(s.avgTtfbSeconds, 0.5);
});

test('summarize: медиана для нечётного числа и стандартное отклонение', () => {
  const s = summarize([ok(5, 1), ok(1, 1), ok(2, 1)]);
  assert.equal(s.medianSeconds, 2);
  // выборочное σ для 1, 2, 5: среднее 8/3
  assert.ok(Math.abs(s.stdDevSeconds - 2.0817) < 0.001);
});

test('summarize: без успешных запросов нули, а не NaN', () => {
  const s = summarize([{ ok: false, error: 'x', attempts: 1 }]);
  assert.equal(s.okCount, 0);
  assert.equal(s.avgSeconds, 0);
  assert.equal(s.mbitPerSec, 0);
  assert.equal(s.stdDevSeconds, 0);
  assert.equal(s.p95Seconds, 0);
});

test('percentile: метод ближайшего ранга', () => {
  const values = Array.from({ length: 20 }, (_, i) => i + 1);
  assert.equal(percentile(values, 0.95), 19);
  assert.equal(percentile(values, 1), 20);
  assert.equal(percentile([7], 0.95), 7);
  assert.equal(percentile([], 0.95), 0);
});
