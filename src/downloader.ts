import { performance } from 'node:perf_hooks';
import type { RequestResult } from './types.js';

/**
 * Один запрос: время от старта до полного получения тела ответа.
 * Никогда не бросает исключений — ошибка возвращается в результате.
 */
export async function downloadOnce(
  url: string,
  timeoutMs: number,
  signal?: AbortSignal,
): Promise<RequestResult> {
  const timeout = AbortSignal.timeout(timeoutMs);
  const combined = signal ? AbortSignal.any([signal, timeout]) : timeout;
  const started = performance.now();

  try {
    const response = await fetch(url, {
      headers: {
        'User-Agent': 'speedtest-cli/1.0',
        // Без сжатия: считаем ровно то, что реально прошло по сети.
        'Accept-Encoding': 'identity',
        'Cache-Control': 'no-cache',
      },
      signal: combined,
    });

    if (!response.ok) {
      // Закрываем тело, чтобы освободить соединение.
      await response.body?.cancel();
      return { ok: false, error: `HTTP ${response.status} ${response.statusText}`.trim() };
    }

    let bytes = 0;
    if (response.body) {
      const reader = response.body.getReader();
      for (;;) {
        const { done, value } = await reader.read();
        if (done) break;
        bytes += value.byteLength;
      }
    }
    return { ok: true, seconds: (performance.now() - started) / 1000, bytes };
  } catch (err) {
    return { ok: false, error: describeError(err, timeoutMs) };
  }
}

function describeError(err: unknown, timeoutMs: number): string {
  if (err instanceof Error) {
    if (err.name === 'TimeoutError') return `таймаут (${timeoutMs / 1000} с)`;
    if (err.name === 'AbortError') return 'прервано';
    const cause = (err as { cause?: { code?: string; message?: string } }).cause;
    return `ошибка: ${cause?.code ?? cause?.message ?? err.message}`;
  }
  return `ошибка: ${String(err)}`;
}
