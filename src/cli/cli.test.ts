import assert from 'node:assert/strict';
import { after, before, test } from 'node:test';
import { PAYLOAD, startTarget, type TargetServer } from '../testing/target-server.js';
import {
  EXIT_BELOW_MIN_SPEED,
  EXIT_FAILURE,
  EXIT_OK,
  EXIT_PARTIAL,
  main,
  type Output,
} from './cli.js';

let target: TargetServer;
before(async () => {
  target = await startTarget();
});
after(() => target.close());

function capture(): { output: Output; out: string[]; err: string[] } {
  const out: string[] = [];
  const err: string[] = [];
  return { output: { out: (l) => out.push(l), err: (l) => err.push(l) }, out, err };
}

test('main: 10 запросов по умолчанию, код 0', async () => {
  const { output, out } = capture();
  const path = '/default-ten';
  assert.equal(await main([`${target.base}${path}`], { output }), EXIT_OK);
  assert.equal(target.hits.get(path), 10);
  assert.ok(out.some((l) => l.includes('Скорость скачивания')));
});

test('main: частичные ошибки дают код 2', async () => {
  const { output } = capture();
  // /flaky: первый запрос 503, остальные успешны.
  assert.equal(await main([`${target.base}/flaky`, '-n', '3'], { output }), EXIT_PARTIAL);
});

test('main: повторы исправляют временную ошибку, код 0', async () => {
  const { output, out } = capture();
  target.hits.delete('/flaky');
  assert.equal(await main([`${target.base}/flaky`, '-n', '2', '-r', '1'], { output }), EXIT_OK);
  assert.ok(out.some((l) => l.includes('попыток: 2')));
});

test('main: ни одного ответа — код 1', async () => {
  const { output, err } = capture();
  assert.equal(await main([`${target.base}/missing`, '-n', '2'], { output }), EXIT_FAILURE);
  assert.ok(err.some((l) => l.includes('ни одного ответа')));
});

test('main: --json выводит валидный JSON', async () => {
  const { output, out } = capture();
  assert.equal(await main([`${target.base}/file`, '-n', '2', '--json'], { output }), EXIT_OK);
  assert.equal(out.length, 1);
  const data = JSON.parse(out[0] as string);
  assert.equal(data.summary.ok, 2);
  assert.equal(data.summary.totalBytes, PAYLOAD.length * 2);
  assert.equal(data.requests.length, 2);
});

test('main: --csv выводит заголовок и строки', async () => {
  const { output, out } = capture();
  assert.equal(await main([`${target.base}/file`, '-n', '2', '--csv'], { output }), EXIT_OK);
  assert.equal(out.length, 3);
  assert.ok(out[0]?.startsWith('request,ok'));
});

test('main: --min-speed — код 3, если скорость ниже порога', async () => {
  const slow = capture();
  assert.equal(
    await main([`${target.base}/file`, '-n', '2', '--min-speed', '100000000'], {
      output: slow.output,
    }),
    EXIT_BELOW_MIN_SPEED,
  );
  assert.ok(slow.out.some((l) => l.includes('НЕ выполнен')));

  const fast = capture();
  assert.equal(
    await main([`${target.base}/file`, '-n', '2', '--min-speed', '0.001'], { output: fast.output }),
    EXIT_OK,
  );
});

test('main: --warmup делает на один запрос больше', async () => {
  const { output } = capture();
  const path = '/warmup-cli';
  assert.equal(await main([`${target.base}${path}`, '-n', '2', '-w'], { output }), EXIT_OK);
  assert.equal(target.hits.get(path), 3);
});

test('main: --self-test работает без внешних адресов', async () => {
  const { output, out } = capture();
  assert.equal(await main(['--self-test', '-n', '2'], { output }), EXIT_OK);
  assert.ok(out.some((l) => l.includes('встроенный тестовый сервер')));
});

test('main: живой прогресс пишется отдельно от вывода', async () => {
  const { output, out } = capture();
  const progress: string[] = [];
  assert.equal(
    await main(['--self-test', '-n', '1'], { output, progress: (t) => progress.push(t) }),
    EXIT_OK,
  );
  assert.ok(progress.some((t) => t.includes('█') || t.includes('МБ')));
  assert.ok(out.every((l) => !l.includes('\r')));
});

test('main: ошибка аргументов — код 1 и справка', async () => {
  const { output, err } = capture();
  assert.equal(await main(['bad'], { output }), EXIT_FAILURE);
  assert.ok(err[0]?.includes('Использование'));
});

test('main: --help — код 0', async () => {
  const { output, out } = capture();
  assert.equal(await main(['--help'], { output }), EXIT_OK);
  assert.ok(out[0]?.includes('serve'));
});

test('main: прерывание сигналом печатает итог и код 2', async () => {
  const { output, out } = capture();
  const controller = new AbortController();
  const promise = main([`${target.base}/file`, '-n', '1000'], {
    output,
    signal: controller.signal,
  });
  setTimeout(() => controller.abort(), 100);
  assert.equal(await promise, EXIT_PARTIAL);
  assert.ok(out.some((l) => l.includes('Прервано')));
});

test('main serve: запускается и корректно останавливается по сигналу', async () => {
  const { output, out } = capture();
  const controller = new AbortController();
  const promise = main(['serve', '--port', '0'], { output, signal: controller.signal });
  await new Promise((resolve) => setTimeout(resolve, 200));
  controller.abort();
  assert.equal(await promise, EXIT_OK);
  assert.ok(out.some((l) => l.startsWith('Сервер запущен')));
});
