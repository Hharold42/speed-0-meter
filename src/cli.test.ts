import assert from 'node:assert/strict';
import { createServer, type Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import { after, before, test } from 'node:test';
import { EXIT_FAILURE, EXIT_OK, EXIT_PARTIAL, main } from './cli.js';
import { downloadOnce } from './downloader.js';
import type { Output } from './types.js';

const PAYLOAD = Buffer.alloc(200_000, 'x');
let server: Server;
let base: string;
let hits = 0;

before(async () => {
  server = createServer((req, res) => {
    hits++;
    if (req.url === '/missing') {
      res.writeHead(404).end();
    } else if (req.url === '/flaky' && hits % 2 === 0) {
      res.writeHead(500).end();
    } else if (req.url === '/slow') {
      // Заголовки отправляем, тело не завершаем — для проверки таймаута.
      res.writeHead(200, { 'Content-Length': 10 });
      res.write('x');
    } else {
      res.writeHead(200, { 'Content-Length': PAYLOAD.length });
      res.end(PAYLOAD);
    }
  });
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
});

after(() => {
  server.closeAllConnections();
  server.close();
});

function capture(): { output: Output; out: string[]; err: string[] } {
  const out: string[] = [];
  const err: string[] = [];
  return { output: { out: (l) => out.push(l), err: (l) => err.push(l) }, out, err };
}

test('downloadOnce: скачивает тело целиком', async () => {
  const r = await downloadOnce(`${base}/file`, 5000);
  assert.ok(r.ok);
  assert.equal(r.bytes, PAYLOAD.length);
});

test('downloadOnce: HTTP-ошибка попадает в результат', async () => {
  const r = await downloadOnce(`${base}/missing`, 5000);
  assert.ok(!r.ok);
  assert.match(r.error, /404/);
});

test('downloadOnce: недоступный хост не бросает исключение', async () => {
  const r = await downloadOnce('http://127.0.0.1:1/', 2000);
  assert.ok(!r.ok);
});

test('downloadOnce: таймаут на зависшем теле', async () => {
  const r = await downloadOnce(`${base}/slow`, 300);
  assert.ok(!r.ok);
  assert.match(r.error, /таймаут/);
});

test('main: 10 запросов по умолчанию, код 0', async () => {
  const { output, out } = capture();
  hits = 0;
  assert.equal(await main([`${base}/file`], output), EXIT_OK);
  assert.equal(hits, 10);
  assert.ok(out.some((l) => l.includes('Скорость скачивания')));
});

test('main: частичные ошибки дают код 2', async () => {
  const { output } = capture();
  hits = 0;
  assert.equal(await main([`${base}/flaky`, '-n', '4'], output), EXIT_PARTIAL);
});

test('main: ни одного ответа — код 1', async () => {
  const { output, err } = capture();
  assert.equal(await main([`${base}/missing`, '-n', '2'], output), EXIT_FAILURE);
  assert.ok(err.some((l) => l.includes('ни одного ответа')));
});

test('main: --json выводит валидный JSON', async () => {
  const { output, out } = capture();
  assert.equal(await main([`${base}/file`, '-n', '2', '--json'], output), EXIT_OK);
  assert.equal(out.length, 1);
  const data = JSON.parse(out[0] as string);
  assert.equal(data.summary.ok, 2);
  assert.equal(data.summary.totalBytes, PAYLOAD.length * 2);
  assert.equal(data.requests.length, 2);
});

test('main: ошибка аргументов — код 1 и справка', async () => {
  const { output, err } = capture();
  assert.equal(await main(['bad'], output), EXIT_FAILURE);
  assert.ok(err[0]?.includes('Использование'));
});

test('main: прерывание сигналом печатает итог и код 2', async () => {
  const { output, out } = capture();
  const controller = new AbortController();
  hits = 0;
  const promise = main([`${base}/file`, '-n', '1000'], output, controller.signal);
  setTimeout(() => controller.abort(), 100);
  const code = await promise;
  assert.equal(code, EXIT_PARTIAL);
  assert.ok(out.some((l) => l.includes('Прервано')));
  assert.ok(hits < 1000);
});
