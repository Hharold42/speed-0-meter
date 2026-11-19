import { createServer } from 'node:http';
import type { AddressInfo } from 'node:net';

export const PAYLOAD = Buffer.alloc(200_000, 'x');

export interface TargetServer {
  base: string;
  /** Сколько запросов пришло на каждый путь. */
  hits: Map<string, number>;
  close(): Promise<void>;
}

/** Локальный сервер-мишень с разными сценариями для тестов. */
export async function startTarget(): Promise<TargetServer> {
  const hits = new Map<string, number>();

  const server = createServer((req, res) => {
    const path = req.url ?? '/';
    const count = (hits.get(path) ?? 0) + 1;
    hits.set(path, count);

    switch (path) {
      case '/missing':
        res.writeHead(404).end();
        return;
      case '/always-503':
        res.writeHead(503, { 'Retry-After': '0' }).end();
        return;
      case '/flaky':
        // Первый запрос — 503, дальше всё хорошо.
        if (count === 1) {
          res.writeHead(503, { 'Retry-After': '0' }).end();
          return;
        }
        break;
      case '/slow':
        // Заголовки отправлены, тело не завершается: проверка таймаута.
        res.writeHead(200, { 'Content-Length': 10 });
        res.write('x');
        return;
      case '/redirect':
        res.writeHead(302, { Location: '/file' }).end();
        return;
      case '/redirect-loop':
        res.writeHead(302, { Location: '/redirect-loop' }).end();
        return;
      case '/truncated':
        res.writeHead(200, { 'Content-Length': 1000 });
        res.write('x'.repeat(10));
        setTimeout(() => res.destroy(), 20);
        return;
      default:
        break;
    }

    res.writeHead(200, { 'Content-Length': PAYLOAD.length });
    res.end(PAYLOAD);
  });

  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  const { port } = server.address() as AddressInfo;

  return {
    base: `http://127.0.0.1:${port}`,
    hits,
    close: () =>
      new Promise<void>((resolve) => {
        server.close(() => resolve());
        server.closeAllConnections();
      }),
  };
}
