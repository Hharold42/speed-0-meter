import { downloadWithRetry } from './retry.js';
import { summarize } from './stats.js';
import type { BenchmarkOptions, Progress, RequestResult, Summary, UrlGuard } from './types.js';

export interface BenchmarkHooks {
  /** Прерывание прогона (Ctrl+C, отмена задачи). */
  signal?: AbortSignal | undefined;
  guard?: UrlGuard | undefined;
  /** Вызывается по мере загрузки. `index` = 0 для прогревочного запроса. */
  onProgress?: (index: number, progress: Progress) => void;
  onWarmup?: (result: RequestResult) => void;
  onResult?: (index: number, total: number, result: RequestResult) => void;
}

export interface BenchmarkOutcome {
  results: RequestResult[];
  summary: Summary;
  /** Прогон остановлен сигналом до выполнения всех запросов. */
  interrupted: boolean;
}

/**
 * Ядро замера: N последовательных запросов. Не знает ни про консоль, ни про HTTP-сервер,
 * поэтому одинаково используется в CLI и в серверном режиме.
 */
export async function runBenchmark(
  options: BenchmarkOptions,
  hooks: BenchmarkHooks = {},
): Promise<BenchmarkOutcome> {
  const { signal, guard } = hooks;
  const base = {
    timeoutMs: options.timeoutMs,
    retries: options.retries,
    ...(signal && { signal }),
    ...(guard && { guard }),
  };

  if (options.warmup && !signal?.aborted) {
    const warmup = await downloadWithRetry(options.url, {
      ...base,
      onProgress: (p) => hooks.onProgress?.(0, p),
    });
    if (!signal?.aborted) hooks.onWarmup?.(warmup);
  }

  const results: RequestResult[] = [];
  for (let i = 1; i <= options.requests; i++) {
    if (signal?.aborted) break;
    const result = await downloadWithRetry(options.url, {
      ...base,
      onProgress: (p) => hooks.onProgress?.(i, p),
    });
    // Запрос, прерванный пользователем, в статистику не берём.
    if (signal?.aborted) break;
    results.push(result);
    hooks.onResult?.(i, options.requests, result);
  }

  return {
    results,
    summary: summarize(results),
    interrupted: signal?.aborted === true,
  };
}
