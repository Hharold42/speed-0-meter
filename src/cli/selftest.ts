import { createServer } from 'node:http';
import type { AddressInfo } from 'node:net';
import { once } from 'node:events';
import { sleep } from '../core/retry.js';

export interface SelfTestServer {
  url: string;
  close(): Promise<void>;
}

export interface SelfTestOptions {
  sizeBytes?: number;
  chunkBytes?: number;
  delayMs?: number;
}

/**
 * Локальный сервер, отдающий файл с небольшой задержкой между кусками.
 * Нужен для демонстрации без интернета: прогресс-бар успевает отрисоваться.
 */
export async function startSelfTestServer(options: SelfTestOptions = {}): Promise<SelfTestServer> {
  const { sizeBytes = 8_000_000, chunkBytes = 256 * 1024, delayMs = 15 } = options;
  const chunk = Buffer.alloc(chunkBytes, 0x61);

  const server = createServer((_req, res) => {
    void (async () => {
      res.writeHead(200, {
        'Content-Type': 'application/octet-stream',
        'Content-Length': sizeBytes,
      });
      let sent = 0;
      while (sent < sizeBytes && !res.destroyed) {
        const part = Math.min(chunkBytes, sizeBytes - sent);
        if (!res.write(part === chunkBytes ? chunk : chunk.subarray(0, part))) {
          await once(res, 'drain').catch(() => undefined);
        }
        sent += part;
        await sleep(delayMs);
      }
      res.end();
    })();
  });

  await new Promise<void>((resolve, reject) => {
    server.once('error', reject);
    server.listen(0, '127.0.0.1', resolve);
  });
  const { port } = server.address() as AddressInfo;

  return {
    url: `http://127.0.0.1:${port}/`,
    close: () =>
      new Promise<void>((resolve) => {
        server.close(() => resolve());
        server.closeAllConnections();
      }),
  };
}
