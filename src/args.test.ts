import assert from 'node:assert/strict';
import { test } from 'node:test';
import { parseCli, UsageError } from './args.js';

test('parseCli: значения по умолчанию', () => {
  const cmd = parseCli(['http://example.com']);
  assert.equal(cmd.kind, 'run');
  if (cmd.kind !== 'run') return;
  assert.equal(cmd.options.requests, 10);
  assert.equal(cmd.options.timeoutMs, 60_000);
  assert.equal(cmd.options.unit, 'mbit');
  assert.equal(cmd.options.json, false);
});

test('parseCli: параметры', () => {
  const cmd = parseCli(['http://example.com', '-n', '3', '-t', '5', '-u', 'mbyte', '--json']);
  assert.ok(cmd.kind === 'run');
  assert.equal(cmd.options.requests, 3);
  assert.equal(cmd.options.timeoutMs, 5000);
  assert.equal(cmd.options.unit, 'mbyte');
  assert.equal(cmd.options.json, true);
});

test('parseCli: --help', () => {
  assert.equal(parseCli(['--help']).kind, 'help');
});

test('parseCli: некорректный ввод даёт UsageError', () => {
  const bad = [
    [],
    ['a', 'b'],
    ['not-a-url'],
    ['ftp://example.com'],
    ['http://example.com', '-n', '0'],
    ['http://example.com', '-n', '1.5'],
    ['http://example.com', '-t', '-1'],
    ['http://example.com', '-u', 'gbit'],
    ['http://example.com', '--unknown'],
  ];
  for (const argv of bad) {
    assert.throws(() => parseCli(argv), UsageError, `argv: ${JSON.stringify(argv)}`);
  }
});
