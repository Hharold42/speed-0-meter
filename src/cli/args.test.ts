import assert from 'node:assert/strict';
import { test } from 'node:test';
import { parseCli, UsageError } from './args.js';

const noEnv = {};

test('parseCli: значения по умолчанию', () => {
  const cmd = parseCli(['http://example.com'], noEnv);
  assert.ok(cmd.kind === 'run');
  assert.equal(cmd.options.benchmark.requests, 10);
  assert.equal(cmd.options.benchmark.timeoutMs, 60_000);
  assert.equal(cmd.options.benchmark.retries, 0);
  assert.equal(cmd.options.benchmark.warmup, false);
  assert.equal(cmd.options.unit, 'mbit');
  assert.equal(cmd.options.format, 'text');
});

test('parseCli: параметры', () => {
  const cmd = parseCli(
    [
      'http://example.com',
      '-n',
      '3',
      '-t',
      '5',
      '-u',
      'mbyte',
      '-r',
      '2',
      '-w',
      '--min-speed',
      '50',
      '--json',
    ],
    noEnv,
  );
  assert.ok(cmd.kind === 'run');
  assert.equal(cmd.options.benchmark.requests, 3);
  assert.equal(cmd.options.benchmark.timeoutMs, 5000);
  assert.equal(cmd.options.benchmark.retries, 2);
  assert.equal(cmd.options.benchmark.warmup, true);
  assert.equal(cmd.options.unit, 'mbyte');
  assert.equal(cmd.options.minSpeed, 50);
  assert.equal(cmd.options.format, 'json');
});

test('parseCli: значения по умолчанию берутся из переменных окружения', () => {
  const cmd = parseCli(['http://example.com'], {
    SPEEDTEST_REQUESTS: '4',
    SPEEDTEST_UNIT: 'mbyte',
  });
  assert.ok(cmd.kind === 'run');
  assert.equal(cmd.options.benchmark.requests, 4);
  assert.equal(cmd.options.unit, 'mbyte');
});

test('parseCli: --self-test не требует адреса', () => {
  const cmd = parseCli(['--self-test'], noEnv);
  assert.ok(cmd.kind === 'run');
  assert.equal(cmd.options.target.kind, 'self-test');
});

test('parseCli: --help', () => {
  assert.equal(parseCli(['--help'], noEnv).kind, 'help');
  assert.equal(parseCli(['serve', '--help'], noEnv).kind, 'help');
});

test('parseCli: serve с параметрами и токеном из окружения', () => {
  const cmd = parseCli(['serve', '-p', '8080', '--host', '0.0.0.0', '--max-queue', '5'], {
    SPEEDTEST_TOKEN: 'secret',
  });
  assert.ok(cmd.kind === 'serve');
  assert.equal(cmd.options.port, 8080);
  assert.equal(cmd.options.host, '0.0.0.0');
  assert.equal(cmd.options.maxQueue, 5);
  assert.equal(cmd.options.token, 'secret');
  assert.equal(cmd.options.allowPrivate, false);
  assert.equal(cmd.options.maxConcurrent, 1);
});

test('parseCli: serve по умолчанию слушает только localhost', () => {
  const cmd = parseCli(['serve'], noEnv);
  assert.ok(cmd.kind === 'serve');
  assert.equal(cmd.options.host, '127.0.0.1');
  assert.equal(cmd.options.port, 3000);
});

test('parseCli: некорректный ввод даёт UsageError', () => {
  const bad = [
    [],
    ['a', 'b'],
    ['not-a-url'],
    ['ftp://example.com'],
    ['--self-test', 'http://example.com'],
    ['http://example.com', '-n', '0'],
    ['http://example.com', '-n', '1.5'],
    ['http://example.com', '-t', '-1'],
    ['http://example.com', '-r', '-1'],
    ['http://example.com', '-u', 'gbit'],
    ['http://example.com', '--min-speed', '0'],
    ['http://example.com', '--json', '--csv'],
    ['http://example.com', '--unknown'],
    ['serve', 'extra'],
    ['serve', '--port', '70000'],
    ['serve', '--max-concurrent', '0'],
  ];
  for (const argv of bad) {
    assert.throws(() => parseCli(argv, noEnv), UsageError, `argv: ${JSON.stringify(argv)}`);
  }
});
