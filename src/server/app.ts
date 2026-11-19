import { createHash, timingSafeEqual } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { createServer, type IncomingMessage, type ServerResponse } from 'node:http';
import type { AddressInfo } from 'node:net';
import { fileURLToPath } from 'node:url';
import { GuardError } from '../core/errors.js';
import { serializeResult, serializeSummary } from '../core/serialize.js';
import { summarize } from '../core/stats.js';
import type { BenchmarkOptions, Summary } from '../core/types.js';
import { MAX_RETRIES, MAX_TIMEOUT_SECONDS, type ServeOptions } from './options.js';
import { isFinished, QueueFullError, RunManager, type RunRecord } from './runs.js';
import { createGuard } from './ssrf.js';

const MAX_BODY_BYTES = 10_000;
const RUN_PATH = /^\/api\/runs(?:\/([0-9a-f-]{36}))?$/;

const ASSETS: Record<string, { file: string; type: string }> = {
  '/': { file: 'index.html', type: 'text/html; charset=utf-8' },
  '/index.html': { file: 'index.html', type: 'text/html; charset=utf-8' },
  '/app.js': { file: 'app.js', type: 'text/javascript; charset=utf-8' },
  '/styles.css': { file: 'styles.css', type: 'text/css; charset=utf-8' },
};

const SECURITY_HEADERS = {
  'X-Content-Type-Options': 'nosniff',
  'Referrer-Policy': 'no-referrer',
  'Content-Security-Policy':
    "default-src 'none'; script-src 'self'; style-src 'self'; connect-src 'self'; img-src 'self' data:; base-uri 'none'; form-action 'none'; frame-ancestors 'none'",
};

class HttpError extends Error {
  constructor(
    readonly status: number,
    message: string,
    readonly headers: Record<string, string> = {},
  ) {
    super(message);
  }
}

export interface ServerHandle {
  host: string;
  port: number;
  close(): Promise<void>;
}

export async function startServer(
  options: ServeOptions,
  log: (line: string) => void = () => undefined,
): Promise<ServerHandle> {
  const guard = options.allowPrivate ? undefined : createGuard();
  const manager = new RunManager({
    maxConcurrent: options.maxConcurrent,
    maxQueue: options.maxQueue,
    historyLimit: options.historyLimit,
    guard,
  });
  const assets = await loadAssets();

  const server = createServer((req, res) => {
    handle(req, res).catch((err: unknown) => {
      if (err instanceof HttpError) {
        sendJson(res, err.status, { error: err.message }, err.headers);
        return;
      }
      log(`Внутренняя ошибка: ${err instanceof Error ? (err.stack ?? err.message) : String(err)}`);
      if (!res.headersSent) sendJson(res, 500, { error: 'внутренняя ошибка сервера' });
      else res.destroy();
    });
  });

  async function handle(req: IncomingMessage, res: ServerResponse): Promise<void> {
    const { pathname } = new URL(req.url ?? '/', 'http://localhost');
    for (const [name, value] of Object.entries(SECURITY_HEADERS)) res.setHeader(name, value);

    if (pathname === '/health') {
      requireMethod(req, 'GET');
      return sendJson(res, 200, { status: 'ok' });
    }

    const asset = assets.get(pathname);
    if (asset) {
      requireMethod(req, 'GET');
      res.writeHead(200, { 'Content-Type': asset.type, 'Cache-Control': 'no-cache' });
      res.end(asset.body);
      return;
    }

    if (pathname.startsWith('/api/')) return handleApi(req, res, pathname);
    throw new HttpError(404, 'не найдено');
  }

  async function handleApi(
    req: IncomingMessage,
    res: ServerResponse,
    pathname: string,
  ): Promise<void> {
    if (!isAuthorized(req, options.token)) {
      throw new HttpError(401, 'нужен корректный токен', { 'WWW-Authenticate': 'Bearer' });
    }

    const match = RUN_PATH.exec(pathname);
    if (!match) throw new HttpError(404, 'не найдено');
    const id = match[1];

    if (id === undefined) {
      if (req.method === 'GET') {
        return sendJson(res, 200, { runs: manager.list().map((r) => publicRun(r, false)) });
      }
      if (req.method === 'POST') return createRun(req, res);
      throw new HttpError(405, 'метод не поддерживается', { Allow: 'GET, POST' });
    }

    const record = manager.get(id);
    if (!record) throw new HttpError(404, 'замер не найден');

    if (req.method === 'GET') return sendJson(res, 200, publicRun(record, true));
    if (req.method === 'DELETE') {
      if (isFinished(record.status)) throw new HttpError(409, 'замер уже завершён');
      const cancelled = manager.cancel(id) ?? record;
      return sendJson(res, 200, publicRun(cancelled, true));
    }
    throw new HttpError(405, 'метод не поддерживается', { Allow: 'GET, DELETE' });
  }

  async function createRun(req: IncomingMessage, res: ServerResponse): Promise<void> {
    const input = validateRunInput(await readJson(req), options);
    try {
      await guard?.(new URL(input.url));
    } catch (err) {
      if (err instanceof GuardError) throw new HttpError(400, err.message);
      throw err;
    }

    let record: RunRecord;
    try {
      record = manager.submit(input);
    } catch (err) {
      if (err instanceof QueueFullError) {
        throw new HttpError(429, err.message, { 'Retry-After': '5' });
      }
      throw err;
    }
    sendJson(res, 202, publicRun(record, true), { Location: `/api/runs/${record.id}` });
  }

  await new Promise<void>((resolve, reject) => {
    server.once('error', reject);
    server.listen(options.port, options.host, () => {
      server.off('error', reject);
      resolve();
    });
  });
  const address = server.address() as AddressInfo;

  return {
    host: options.host,
    port: address.port,
    async close() {
      await manager.shutdown();
      await new Promise<void>((resolve) => {
        server.close(() => resolve());
        server.closeAllConnections();
      });
    },
  };
}

// --- вспомогательные функции -------------------------------------------------

async function loadAssets(): Promise<Map<string, { type: string; body: Buffer }>> {
  const publicDir = new URL('../../public/', import.meta.url);
  const assets = new Map<string, { type: string; body: Buffer }>();
  for (const [route, { file, type }] of Object.entries(ASSETS)) {
    const body = await readFile(fileURLToPath(new URL(file, publicDir)));
    assets.set(route, { type, body });
  }
  return assets;
}

function requireMethod(req: IncomingMessage, method: string): void {
  if (req.method !== method) {
    throw new HttpError(405, 'метод не поддерживается', { Allow: method });
  }
}

function isAuthorized(req: IncomingMessage, token: string | undefined): boolean {
  if (!token) return true;
  const match = /^Bearer (.+)$/.exec(req.headers.authorization ?? '');
  if (!match) return false;
  // Сравнение хешей фиксированной длины: не зависит от длины и содержимого токена.
  const digest = (value: string): Buffer => createHash('sha256').update(value).digest();
  return timingSafeEqual(digest(match[1] ?? ''), digest(token));
}

function sendJson(
  res: ServerResponse,
  status: number,
  body: unknown,
  headers: Record<string, string> = {},
): void {
  if (res.headersSent) return;
  res.writeHead(status, {
    'Content-Type': 'application/json; charset=utf-8',
    'Cache-Control': 'no-store',
    ...headers,
  });
  res.end(JSON.stringify(body));
}

async function readJson(req: IncomingMessage): Promise<unknown> {
  const chunks: Buffer[] = [];
  let size = 0;
  for await (const chunk of req) {
    const buffer = chunk as Buffer;
    size += buffer.length;
    if (size > MAX_BODY_BYTES) throw new HttpError(413, 'слишком большое тело запроса');
    chunks.push(buffer);
  }
  try {
    return JSON.parse(Buffer.concat(chunks).toString('utf8'));
  } catch {
    throw new HttpError(400, 'тело запроса должно быть корректным JSON');
  }
}

/** Проверяет входные данные POST /api/runs и приводит их к опциям замера. */
export function validateRunInput(body: unknown, limits: ServeOptions): BenchmarkOptions {
  if (typeof body !== 'object' || body === null || Array.isArray(body)) {
    throw new HttpError(400, 'ожидается JSON-объект');
  }
  const input = body as Record<string, unknown>;

  if (typeof input.url !== 'string') throw new HttpError(400, 'поле url обязательно');
  let url: URL;
  try {
    url = new URL(input.url);
  } catch {
    throw new HttpError(400, 'url: некорректный адрес');
  }
  if (url.protocol !== 'http:' && url.protocol !== 'https:') {
    throw new HttpError(400, 'url: поддерживаются только http:// и https://');
  }

  const integer = (name: string, fallback: number, min: number, max: number): number => {
    const value = input[name] ?? fallback;
    if (typeof value !== 'number' || !Number.isInteger(value) || value < min || value > max) {
      throw new HttpError(400, `${name}: нужно целое число от ${min} до ${max}`);
    }
    return value;
  };

  const timeout = input.timeout ?? 30;
  if (typeof timeout !== 'number' || !(timeout > 0) || timeout > MAX_TIMEOUT_SECONDS) {
    throw new HttpError(400, `timeout: число секунд от 0 до ${MAX_TIMEOUT_SECONDS}`);
  }
  const warmup = input.warmup ?? false;
  if (typeof warmup !== 'boolean') throw new HttpError(400, 'warmup: нужно true или false');

  return {
    url: url.href,
    requests: integer('requests', 10, 1, limits.maxRequests),
    timeoutMs: timeout * 1000,
    warmup,
    retries: integer('retries', 0, 0, MAX_RETRIES),
  };
}

function summaryOf(record: RunRecord): Summary | undefined {
  if (record.summary) return record.summary;
  return record.results.length > 0 ? summarize(record.results) : undefined;
}

function publicRun(record: RunRecord, withResults: boolean): Record<string, unknown> {
  return {
    id: record.id,
    url: record.options.url,
    status: record.status,
    options: {
      requests: record.options.requests,
      timeout: record.options.timeoutMs / 1000,
      warmup: record.options.warmup,
      retries: record.options.retries,
    },
    createdAt: record.createdAt,
    startedAt: record.startedAt,
    finishedAt: record.finishedAt,
    progress: record.progress,
    // Пока замер идёт, показываем промежуточную статистику по уже выполненным запросам.
    summary: summaryOf(record) ? serializeSummary(summaryOf(record) as Summary) : undefined,
    error: record.error,
    results: withResults ? record.results.map(serializeResult) : undefined,
  };
}
