import { downloadOnce, type DownloadOptions } from './downloader.js';
import type { RequestResult } from './types.js';

export interface RetryOptions extends DownloadOptions {
  /** Сколько раз повторять после первой попытки. */
  retries: number;
  baseDelayMs?: number;
  maxDelayMs?: number;
}

/** Пауза, которую можно прервать сигналом. */
export function sleep(ms: number, signal?: AbortSignal): Promise<void> {
  return new Promise((resolve) => {
    if (signal?.aborted) {
      resolve();
      return;
    }
    const done = (): void => {
      clearTimeout(timer);
      signal?.removeEventListener('abort', done);
      resolve();
    };
    const timer = setTimeout(done, ms);
    signal?.addEventListener('abort', done, { once: true });
  });
}

/**
 * Запрос с повторами при временных ошибках (429, 5xx, сеть, таймаут).
 * Пауза растёт экспоненциально либо берётся из `Retry-After`. В время запроса паузы не входят.
 */
export async function downloadWithRetry(
  url: string,
  options: RetryOptions,
): Promise<RequestResult> {
  const { retries, baseDelayMs = 500, maxDelayMs = 10_000, ...download } = options;

  for (let attempt = 1; ; attempt++) {
    const result = await downloadOnce(url, download);
    const final = { ...result, attempts: attempt };
    if (result.ok || !result.retryable || attempt > retries || download.signal?.aborted) {
      return final;
    }
    const delay = Math.min(result.retryAfterMs ?? baseDelayMs * 2 ** (attempt - 1), maxDelayMs);
    await sleep(delay, download.signal);
    if (download.signal?.aborted) return final;
  }
}
