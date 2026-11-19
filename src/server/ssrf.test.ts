import assert from 'node:assert/strict';
import { test } from 'node:test';
import { GuardError } from '../core/errors.js';
import { createGuard, isPrivateAddress } from './ssrf.js';

test('isPrivateAddress: внутренние IPv4', () => {
  for (const ip of [
    '127.0.0.1',
    '10.1.2.3',
    '172.16.0.1',
    '172.31.255.255',
    '192.168.1.1',
    '169.254.169.254',
    '100.64.0.1',
    '0.0.0.0',
    '224.0.0.1',
    '255.255.255.255',
  ]) {
    assert.equal(isPrivateAddress(ip), true, ip);
  }
});

test('isPrivateAddress: публичные IPv4', () => {
  for (const ip of [
    '8.8.8.8',
    '1.1.1.1',
    '93.184.216.34',
    '172.15.0.1',
    '172.32.0.1',
    '100.63.0.1',
  ]) {
    assert.equal(isPrivateAddress(ip), false, ip);
  }
});

test('isPrivateAddress: внутренние IPv6 и вложенные IPv4', () => {
  for (const ip of [
    '::1',
    '::',
    'fe80::1',
    'fc00::1',
    'fd12:3456::1',
    'ff02::1',
    '::ffff:127.0.0.1',
    '::ffff:7f00:1',
    '::ffff:10.0.0.1',
    '64:ff9b::192.168.0.1',
  ]) {
    assert.equal(isPrivateAddress(ip), true, ip);
  }
});

test('isPrivateAddress: публичные IPv6', () => {
  for (const ip of ['2606:4700:4700::1111', '2001:4860:4860::8888', '::ffff:8.8.8.8']) {
    assert.equal(isPrivateAddress(ip), false, ip);
  }
});

test('createGuard: блокирует внутренние адреса и localhost', async () => {
  const guard = createGuard();
  for (const url of [
    'http://127.0.0.1/',
    'http://[::1]/',
    'http://169.254.169.254/latest/meta-data/',
    'http://10.0.0.5:8080/',
    'http://localhost/',
  ]) {
    await assert.rejects(guard(new URL(url)), GuardError, url);
  }
});

test('createGuard: пропускает публичный IP-адрес без обращения к DNS', async () => {
  await createGuard()(new URL('http://8.8.8.8/'));
});
