import { performance } from 'node:perf_hooks';
import { GuardError } from './errors.js';
import type { Progress, RequestResult, UrlGuard } from './types.js';

export interface DownloadOptions {
  timeoutMs: number;
  signal?: AbortSignal;
  /** Если задан, вызывается перед каждым обращением, включая редиректы. */
  guard?: UrlGuard;
  onProgress?: (progress: Progress) => void;
  maxRedirects?: number;
}

const REDIRECT_STATUSES = new Set([301, 302, 303, 307, 308]);
const DEFAULT_MAX_REDIRECTS = 5;

const REQUEST_HEADERS = {
  'User-Agent': 'speedtest-cli/1.0',
  // Без сжатия: считаем ровно то, что реально прошло по сети.
  'Accept-Encoding': 'identity',
  'Cache-Control': 'no-cache',
};

interface FailureExtra {
  retryable?: boolean;
  retryAfterMs?: number | undefined;
}

const failure = (error: string, extra: FailureExtra = {}): RequestResult => ({
  ok: false,
  error,
  attempts: 1,
  ...extra,
});

/**
 * Один запрос: время от старта до полного получения тела ответа.
 * Редиректы обрабатываются вручную, чтобы проверять каждый переход через `guard`.
 * Никогда не бросает исключений: ошибка возвращается в результате.
 */
export async function downloadOnce(
  rawUrl: string,
  options: DownloadOptions,
): Promise<RequestResult> {
  const { timeoutMs, signal, guard, onProgress, maxRedirects = DEFAULT_MAX_REDIRECTS } = options;
  const timeout = AbortSignal.timeout(timeoutMs);
  const combined = signal ? AbortSignal.any([signal, timeout]) : timeout;

  const started = performance.now();
  // Время работы guard (DNS-проверка) в замер не входит.
  let guardMs = 0;
  const elapsed = (): number => (performance.now() - started - guardMs) / 1000;

  try {
    let current = new URL(rawUrl);
    let response: Response;
    for (let hops = 0; ; hops++) {
      if (guard) {
        const guardStarted = performance.now();
        await guard(current);
        guardMs += performance.now() - guardStarted;
      }
      response = await fetch(current, {
        headers: REQUEST_HEADERS,
        redirect: 'manual',
        signal: combined,
      });
      if (!REDIRECT_STATUSES.has(response.status)) break;

      const location = response.headers.get('location');
      await response.body?.cancel();
      if (!location) return failure(`HTTP ${response.status} без заголовка Location`);
      if (hops >= maxRedirects) return failure('слишком много редиректов');
      current = new URL(location, current);
      if (current.protocol !== 'http:' && current.protocol !== 'https:') {
        return failure('редирект на неподдерживаемый протокол');
      }
    }

    const ttfbSeconds = elapsed();

    if (!response.ok) {
      // Закрываем тело, чтобы освободить соединение.
      await response.body?.cancel();
      return failure(`HTTP ${response.status} ${response.statusText}`.trim(), {
        retryable: response.status === 429 || response.status >= 500,
        retryAfterMs: parseRetryAfter(response.headers.get('retry-after')),
      });
    }

    const declared = declaredLength(response.headers);
    let bytes = 0;
    if (response.body) {
      const reader = response.body.getReader();
      for (;;) {
        const { done, value } = await reader.read();
        if (done) break;
        bytes += value.byteLength;
        onProgress?.({
          bytes,
          ...(declared !== undefined && { total: declared }),
          seconds: elapsed(),
        });
      }
    }

    // Обрезанный ответ не должен давать «красивую» скорость.
    if (declared !== undefined && bytes !== declared) {
      return failure(`получено ${bytes} из ${declared} байт`, { retryable: true });
    }
    return { ok: true, seconds: elapsed(), ttfbSeconds, bytes, attempts: 1 };
  } catch (err) {
    return describeError(err, timeoutMs);
  }
}

/** Content-Length сравнимо с числом байт только если сервер не сжимал тело. */
function declaredLength(headers: Headers): number | undefined {
  const encoding = headers.get('content-encoding');
  if (encoding && encoding !== 'identity') return undefined;
  const raw = headers.get('content-length');
  if (!raw) return undefined;
  const value = Number(raw);
  return Number.isInteger(value) && value >= 0 ? value : undefined;
}

export function parseRetryAfter(value: string | null): number | undefined {
  if (!value) return undefined;
  if (/^\d+$/.test(value)) return Number(value) * 1000;
  const date = Date.parse(value);
  return Number.isNaN(date) ? undefined : Math.max(0, date - Date.now());
}

function describeError(err: unknown, timeoutMs: number): RequestResult {
  if (err instanceof GuardError) return failure(err.message);
  if (err instanceof Error) {
    if (err.name === 'TimeoutError') {
      return failure(`таймаут (${timeoutMs / 1000} с)`, { retryable: true });
    }
    if (err.name === 'AbortError') return failure('прервано');
    const cause = (err as { cause?: { code?: string; message?: string } }).cause;
    return failure(`ошибка: ${cause?.code ?? cause?.message ?? err.message}`, { retryable: true });
  }
  return failure(`ошибка: ${String(err)}`);
}
