import assert from 'node:assert/strict';
import { after, before, test } from 'node:test';
import { PAYLOAD, startTarget, type TargetServer } from '../testing/target-server.js';
import { startServer, type ServerHandle } from './app.js';
import type { ServeOptions } from './options.js';

const baseOptions: ServeOptions = {
  host: '127.0.0.1',
  port: 0,
  maxConcurrent: 1,
  maxRequests: 20,
  maxQueue: 5,
  allowPrivate: true, // мишень слушает 127.0.0.1
  historyLimit: 100,
};

let target: TargetServer;
let api: ServerHandle;
let root: string;

before(async () => {
  target = await startTarget();
  api = await startServer(baseOptions);
  root = `http://127.0.0.1:${api.port}`;
});
after(async () => {
  await api.close();
  await target.close();
});

interface Run {
  id: string;
  status: string;
  progress: { completed: number; total: number };
  summary?: { ok: number; totalBytes: number };
  results?: unknown[];
  error?: string;
}

async function call(path: string, init: RequestInit = {}, base = root): Promise<Response> {
  return fetch(`${base}${path}`, init);
}

async function post(
  body: unknown,
  base = root,
  headers: Record<string, string> = {},
): Promise<Response> {
  return call(
    '/api/runs',
    {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', ...headers },
      body: typeof body === 'string' ? body : JSON.stringify(body),
    },
    base,
  );
}

async function waitFinished(
  id: string,
  base = root,
  headers: Record<string, string> = {},
): Promise<Run> {
  for (let i = 0; i < 100; i++) {
    const run = (await (await call(`/api/runs/${id}`, { headers }, base)).json()) as Run;
    if (['done', 'failed', 'cancelled'].includes(run.status)) return run;
    await new Promise((resolve) => setTimeout(resolve, 50));
  }
  throw new Error('замер не завершился вовремя');
}

test('GET /health', async () => {
  const res = await call('/health');
  assert.equal(res.status, 200);
  assert.deepEqual(await res.json(), { status: 'ok' });
});

test('раздаёт веб-интерфейс с заголовками безопасности', async () => {
  const res = await call('/');
  assert.equal(res.status, 200);
  assert.match(res.headers.get('content-type') ?? '', /text\/html/);
  assert.match(res.headers.get('content-security-policy') ?? '', /default-src 'none'/);
  assert.match(await res.text(), /Замер скорости скачивания/);
  assert.equal((await call('/app.js')).status, 200);
  assert.equal((await call('/styles.css')).status, 200);
});

test('POST /api/runs: создаёт замер, он завершается с корректной статистикой', async () => {
  const res = await post({ url: `${target.base}/file`, requests: 3 });
  assert.equal(res.status, 202);
  const created = (await res.json()) as Run;
  assert.match(res.headers.get('location') ?? '', /^\/api\/runs\//);

  const run = await waitFinished(created.id);
  assert.equal(run.status, 'done');
  assert.equal(run.summary?.ok, 3);
  assert.equal(run.summary?.totalBytes, PAYLOAD.length * 3);
  assert.equal(run.results?.length, 3);
  assert.equal(run.progress.completed, 3);
});

test('GET /api/runs: история без подробных результатов', async () => {
  const data = (await (await call('/api/runs')).json()) as { runs: Run[] };
  assert.ok(data.runs.length >= 1);
  assert.equal(data.runs[0]?.results, undefined);
});

test('замер с ошибкой получает статус failed и причину', async () => {
  const created = (await (
    await post({ url: `${target.base}/missing`, requests: 2 })
  ).json()) as Run;
  const run = await waitFinished(created.id);
  assert.equal(run.status, 'failed');
  assert.match(run.error ?? '', /404/);
});

test('валидация входных данных: 400', async () => {
  const bad: unknown[] = [
    {},
    { url: 123 },
    { url: 'not a url' },
    { url: 'ftp://example.com/file' },
    { url: `${target.base}/file`, requests: 0 },
    { url: `${target.base}/file`, requests: 21 },
    { url: `${target.base}/file`, requests: 1.5 },
    { url: `${target.base}/file`, timeout: 0 },
    { url: `${target.base}/file`, timeout: 999 },
    { url: `${target.base}/file`, retries: 10 },
    { url: `${target.base}/file`, warmup: 'yes' },
    [],
    'not json',
  ];
  for (const body of bad) {
    const res = await post(body);
    assert.equal(res.status, 400, JSON.stringify(body));
    assert.ok(((await res.json()) as { error: string }).error);
  }
});

test('слишком большое тело запроса: 413', async () => {
  const res = await post(JSON.stringify({ url: `${target.base}/file`, pad: 'x'.repeat(20_000) }));
  assert.equal(res.status, 413);
});

test('неизвестные маршруты, методы и идентификаторы', async () => {
  assert.equal((await call('/nope')).status, 404);
  assert.equal((await call('/api/runs/00000000-0000-0000-0000-000000000000')).status, 404);
  assert.equal((await call('/api/runs/not-an-id')).status, 404);
  assert.equal((await call('/api/runs', { method: 'PUT' })).status, 405);
  assert.equal((await call('/health', { method: 'POST' })).status, 405);
});

test('DELETE: останавливает выполняющийся замер', async () => {
  const created = (await (
    await post({ url: `${target.base}/slow`, requests: 5, timeout: 30 })
  ).json()) as Run;
  await new Promise((resolve) => setTimeout(resolve, 150));

  const cancel = await call(`/api/runs/${created.id}`, { method: 'DELETE' });
  assert.equal(cancel.status, 200);
  const run = await waitFinished(created.id);
  assert.equal(run.status, 'cancelled');

  // Повторная отмена завершённого замера — конфликт.
  assert.equal((await call(`/api/runs/${created.id}`, { method: 'DELETE' })).status, 409);
});

test('замеры выполняются по одному, лишние ждут в очереди и отменяются из неё', async () => {
  const first = (await (
    await post({ url: `${target.base}/slow`, requests: 1, timeout: 30 })
  ).json()) as Run;
  const second = (await (await post({ url: `${target.base}/file`, requests: 1 })).json()) as Run;
  await new Promise((resolve) => setTimeout(resolve, 100));

  const secondState = (await (await call(`/api/runs/${second.id}`)).json()) as Run;
  assert.equal(secondState.status, 'queued');

  await call(`/api/runs/${second.id}`, { method: 'DELETE' });
  assert.equal((await waitFinished(second.id)).status, 'cancelled');

  await call(`/api/runs/${first.id}`, { method: 'DELETE' });
  await waitFinished(first.id);
});

test('SSRF: внутренние адреса отклоняются', async () => {
  const strict = await startServer({ ...baseOptions, allowPrivate: false });
  try {
    const base = `http://127.0.0.1:${strict.port}`;
    for (const url of [
      'http://127.0.0.1:1/',
      'http://169.254.169.254/',
      'http://[::1]/',
      'http://localhost/',
    ]) {
      const res = await post({ url }, base);
      assert.equal(res.status, 400, url);
      assert.match(((await res.json()) as { error: string }).error, /запрещено|внутренн/);
    }
  } finally {
    await strict.close();
  }
});

test('очередь переполнена: 429 с Retry-After', async () => {
  const tight = await startServer({ ...baseOptions, maxQueue: 0 });
  try {
    const base = `http://127.0.0.1:${tight.port}`;
    const first = (await (
      await post({ url: `${target.base}/slow`, requests: 1, timeout: 30 }, base)
    ).json()) as Run;
    await new Promise((resolve) => setTimeout(resolve, 100));

    const res = await post({ url: `${target.base}/file` }, base);
    assert.equal(res.status, 429);
    assert.equal(res.headers.get('retry-after'), '5');

    await call(`/api/runs/${first.id}`, { method: 'DELETE' }, base);
  } finally {
    await tight.close();
  }
});

test('токен: без него 401, с ним работает, /health и интерфейс открыты', async () => {
  const secured = await startServer({ ...baseOptions, token: 's3cret' });
  try {
    const base = `http://127.0.0.1:${secured.port}`;
    assert.equal((await call('/api/runs', {}, base)).status, 401);
    assert.equal(
      (await call('/api/runs', { headers: { Authorization: 'Bearer wrong' } }, base)).status,
      401,
    );
    assert.equal((await call('/health', {}, base)).status, 200);
    assert.equal((await call('/', {}, base)).status, 200);

    const auth = { Authorization: 'Bearer s3cret' };
    const res = await post({ url: `${target.base}/file`, requests: 1 }, base, auth);
    assert.equal(res.status, 202);
    const run = await waitFinished(((await res.json()) as Run).id, base, auth);
    assert.equal(run.status, 'done');
  } finally {
    await secured.close();
  }
});

test('close: останавливает выполняющийся замер и сервер', async () => {
  const temp = await startServer(baseOptions);
  const base = `http://127.0.0.1:${temp.port}`;
  await post({ url: `${target.base}/slow`, requests: 1, timeout: 30 }, base);
  await new Promise((resolve) => setTimeout(resolve, 100));

  const started = Date.now();
  await temp.close();
  assert.ok(Date.now() - started < 3000);
  await assert.rejects(call('/health', {}, base));
});
