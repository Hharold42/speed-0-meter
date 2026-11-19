import assert from 'node:assert/strict';
import { after, before, test } from 'node:test';
import { startTarget, PAYLOAD, type TargetServer } from '../testing/target-server.js';
import { downloadOnce, parseRetryAfter } from './downloader.js';
import { GuardError } from './errors.js';
import { runBenchmark } from './benchmark.js';
import { downloadWithRetry } from './retry.js';
import type { Progress } from './types.js';

let target: TargetServer;
before(async () => {
  target = await startTarget();
});
after(() => target.close());

test('downloadOnce: скачивает тело целиком, TTFB не больше полного времени', async () => {
  const r = await downloadOnce(`${target.base}/file`, { timeoutMs: 5000 });
  assert.ok(r.ok);
  assert.equal(r.bytes, PAYLOAD.length);
  assert.ok(r.ttfbSeconds >= 0 && r.ttfbSeconds <= r.seconds);
});

test('downloadOnce: сообщает прогресс с итоговым объёмом', async () => {
  const updates: Progress[] = [];
  const r = await downloadOnce(`${target.base}/file`, {
    timeoutMs: 5000,
    onProgress: (p) => updates.push(p),
  });
  assert.ok(r.ok);
  const last = updates.at(-1);
  assert.equal(last?.bytes, PAYLOAD.length);
  assert.equal(last?.total, PAYLOAD.length);
});

test('downloadOnce: HTTP 404 — ошибка без повторов', async () => {
  const r = await downloadOnce(`${target.base}/missing`, { timeoutMs: 5000 });
  assert.ok(!r.ok);
  assert.match(r.error, /404/);
  assert.ok(!r.retryable);
});

test('downloadOnce: HTTP 503 помечается как повторяемая ошибка', async () => {
  const r = await downloadOnce(`${target.base}/always-503`, { timeoutMs: 5000 });
  assert.ok(!r.ok);
  assert.equal(r.retryable, true);
  assert.equal(r.retryAfterMs, 0);
});

test('downloadOnce: недоступный хост не бросает исключение', async () => {
  const r = await downloadOnce('http://127.0.0.1:1/', { timeoutMs: 2000 });
  assert.ok(!r.ok);
});

test('downloadOnce: таймаут на зависшем теле', async () => {
  const r = await downloadOnce(`${target.base}/slow`, { timeoutMs: 300 });
  assert.ok(!r.ok);
  assert.match(r.error, /таймаут/);
});

test('downloadOnce: обрыв посреди ответа — ошибка, а не заниженный объём', async () => {
  const r = await downloadOnce(`${target.base}/truncated`, { timeoutMs: 3000 });
  assert.ok(!r.ok);
});

test('downloadOnce: следует редиректам и проверяет каждый переход', async () => {
  const visited: string[] = [];
  const r = await downloadOnce(`${target.base}/redirect`, {
    timeoutMs: 5000,
    guard: async (url) => void visited.push(url.pathname),
  });
  assert.ok(r.ok);
  assert.equal(r.bytes, PAYLOAD.length);
  assert.deepEqual(visited, ['/redirect', '/file']);
});

test('downloadOnce: бесконечный редирект ограничен', async () => {
  const r = await downloadOnce(`${target.base}/redirect-loop`, { timeoutMs: 5000 });
  assert.ok(!r.ok);
  assert.match(r.error, /редирект/);
});

test('downloadOnce: guard блокирует запрос до обращения к серверу', async () => {
  const before = target.hits.get('/blocked') ?? 0;
  const r = await downloadOnce(`${target.base}/blocked`, {
    timeoutMs: 5000,
    guard: async () => {
      throw new GuardError('запрещено');
    },
  });
  assert.ok(!r.ok);
  assert.equal(r.error, 'запрещено');
  assert.equal(r.retryable, undefined);
  assert.equal(target.hits.get('/blocked') ?? 0, before);
});

test('downloadWithRetry: повторяет после 503 и успешно завершается', async () => {
  const r = await downloadWithRetry(`${target.base}/flaky`, { timeoutMs: 5000, retries: 2 });
  assert.ok(r.ok);
  assert.equal(r.attempts, 2);
});

test('downloadWithRetry: без повторов ошибка 503 возвращается сразу', async () => {
  const r = await downloadWithRetry(`${target.base}/always-503`, { timeoutMs: 5000, retries: 0 });
  assert.ok(!r.ok);
  assert.equal(r.attempts, 1);
});

test('downloadWithRetry: не повторяет неповторяемые ошибки', async () => {
  const r = await downloadWithRetry(`${target.base}/missing`, { timeoutMs: 5000, retries: 3 });
  assert.ok(!r.ok);
  assert.equal(r.attempts, 1);
});

test('downloadWithRetry: исчерпывает лимит повторов', async () => {
  const r = await downloadWithRetry(`${target.base}/always-503`, { timeoutMs: 5000, retries: 2 });
  assert.ok(!r.ok);
  assert.equal(r.attempts, 3);
});

test('parseRetryAfter: секунды, дата и мусор', () => {
  assert.equal(parseRetryAfter('3'), 3000);
  assert.equal(parseRetryAfter(null), undefined);
  assert.equal(parseRetryAfter('abc'), undefined);
  const inPast = new Date(Date.now() - 10_000).toUTCString();
  assert.equal(parseRetryAfter(inPast), 0);
});

test('runBenchmark: прогрев не входит в статистику', async () => {
  const path = '/warmup-check';
  const outcome = await runBenchmark({
    url: `${target.base}${path}`,
    requests: 3,
    timeoutMs: 5000,
    warmup: true,
    retries: 0,
  });
  assert.equal(outcome.results.length, 3);
  assert.equal(outcome.summary.requested, 3);
  assert.equal(target.hits.get(path), 4);
});

test('runBenchmark: прерывание сигналом останавливает прогон', async () => {
  const controller = new AbortController();
  const outcome = await runBenchmark(
    { url: `${target.base}/file`, requests: 1000, timeoutMs: 5000, warmup: false, retries: 0 },
    {
      signal: controller.signal,
      onResult: (index) => {
        if (index === 3) controller.abort();
      },
    },
  );
  assert.equal(outcome.interrupted, true);
  assert.ok(outcome.results.length >= 3 && outcome.results.length < 1000);
});
