import assert from 'node:assert/strict';
import { test } from 'node:test';
import { createProgressRenderer, formatProgress } from './progress.js';
import { formatCsv, sparkline } from './reporter.js';
import { createStyle, shouldUseColor } from './style.js';

test('sparkline: масштабируется от минимума к максимуму', () => {
  assert.equal(sparkline([1, 8]), '▁█');
  assert.equal(sparkline([]), '');
  assert.equal(sparkline([5, 5, 5]).length, 3);
});

test('formatCsv: заголовок, строки и экранирование', () => {
  const lines = formatCsv([
    { ok: true, seconds: 1.5, ttfbSeconds: 0.25, bytes: 1000, attempts: 1 },
    { ok: false, error: 'плохо, "очень"', attempts: 2 },
  ]);
  assert.equal(lines[0], 'request,ok,seconds,ttfb_seconds,bytes,attempts,error');
  assert.equal(lines[1], '1,true,1.500,0.250,1000,1,');
  assert.equal(lines[2], '2,false,,,,2,"плохо, ""очень"""');
});

test('formatProgress: с известным размером и без него', () => {
  const known = formatProgress('[1/3]', { bytes: 5e6, total: 10e6, seconds: 1 }, 'mbit');
  assert.match(known, /50%/);
  assert.match(known, /40\.0 Мбит\/с/);
  const unknown = formatProgress('[1/3]', { bytes: 5e6, seconds: 1 }, 'mbyte');
  assert.match(unknown, /5\.00 МБ/);
  assert.match(unknown, /5\.00 МБ\/с/);
});

test('createProgressRenderer: не чаще заданного интервала', () => {
  const writes: string[] = [];
  let time = 0;
  const renderer = createProgressRenderer(
    (t) => writes.push(t),
    100,
    () => time,
  );
  const p = { bytes: 1, seconds: 1 };
  renderer.update('x', p, 'mbit');
  time = 50;
  renderer.update('x', p, 'mbit');
  time = 150;
  renderer.update('x', p, 'mbit');
  assert.equal(writes.length, 2);
});

test('стили: без цвета текст не меняется, NO_COLOR учитывается', () => {
  assert.equal(createStyle(false).red('a'), 'a');
  assert.equal(createStyle(true).red('a'), '\x1b[31ma\x1b[39m');
  assert.equal(shouldUseColor(true, {}), true);
  assert.equal(shouldUseColor(true, { NO_COLOR: '1' }), false);
  assert.equal(shouldUseColor(false, {}), false);
  assert.equal(shouldUseColor(true, { TERM: 'dumb' }), false);
});
