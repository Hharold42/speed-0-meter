import type { RequestResult, Summary } from './types.js';

/** Агрегаты по успешным запросам. Неуспешные в расчёт не входят. */
export function summarize(results: readonly RequestResult[]): Summary {
  const times: number[] = [];
  let totalBytes = 0;
  let ttfbSum = 0;
  let transferSeconds = 0;
  for (const r of results) {
    if (!r.ok) continue;
    times.push(r.seconds);
    totalBytes += r.bytes;
    ttfbSum += r.ttfbSeconds;
    transferSeconds += Math.max(0, r.seconds - r.ttfbSeconds);
  }

  const okCount = times.length;
  const totalSeconds = times.reduce((sum, t) => sum + t, 0);
  const avgSeconds = okCount ? totalSeconds / okCount : 0;
  const sorted = [...times].sort((a, b) => a - b);
  const mbytePerSec = perSecond(totalBytes, totalSeconds);
  const downloadMbytePerSec = perSecond(totalBytes, transferSeconds);

  return {
    requested: results.length,
    okCount,
    failedCount: results.length - okCount,
    totalBytes,
    totalSeconds,
    avgSeconds,
    minSeconds: sorted[0] ?? 0,
    maxSeconds: sorted[sorted.length - 1] ?? 0,
    medianSeconds: median(sorted),
    p95Seconds: percentile(sorted, 0.95),
    stdDevSeconds: stdDev(times, avgSeconds),
    avgTtfbSeconds: okCount ? ttfbSum / okCount : 0,
    mbytePerSec,
    mbitPerSec: mbytePerSec * 8,
    downloadMbytePerSec,
    downloadMbitPerSec: downloadMbytePerSec * 8,
  };
}

const perSecond = (bytes: number, seconds: number): number =>
  seconds > 0 ? bytes / seconds / 1e6 : 0;

function median(sorted: readonly number[]): number {
  if (sorted.length === 0) return 0;
  const mid = Math.floor(sorted.length / 2);
  if (sorted.length % 2 === 1) return sorted[mid] ?? 0;
  return ((sorted[mid - 1] ?? 0) + (sorted[mid] ?? 0)) / 2;
}

/** Метод ближайшего ранга. */
export function percentile(sorted: readonly number[], p: number): number {
  if (sorted.length === 0) return 0;
  const rank = Math.max(1, Math.ceil(p * sorted.length));
  return sorted[rank - 1] ?? 0;
}

/** Выборочное стандартное отклонение. */
function stdDev(values: readonly number[], mean: number): number {
  if (values.length < 2) return 0;
  const variance = values.reduce((sum, v) => sum + (v - mean) ** 2, 0) / (values.length - 1);
  return Math.sqrt(variance);
}
