import type { RequestResult, Summary } from './types.js';

/** Агрегаты по успешным запросам. Неуспешные в расчёт не входят. */
export function summarize(results: readonly RequestResult[]): Summary {
  const times: number[] = [];
  let totalBytes = 0;
  for (const r of results) {
    if (r.ok) {
      times.push(r.seconds);
      totalBytes += r.bytes;
    }
  }

  const okCount = times.length;
  const totalSeconds = times.reduce((sum, t) => sum + t, 0);
  const sorted = [...times].sort((a, b) => a - b);
  const mbytePerSec = totalSeconds > 0 ? totalBytes / totalSeconds / 1e6 : 0;

  return {
    requested: results.length,
    okCount,
    failedCount: results.length - okCount,
    totalBytes,
    totalSeconds,
    avgSeconds: okCount ? totalSeconds / okCount : 0,
    minSeconds: sorted[0] ?? 0,
    maxSeconds: sorted[sorted.length - 1] ?? 0,
    medianSeconds: median(sorted),
    mbytePerSec,
    mbitPerSec: mbytePerSec * 8,
  };
}

function median(sorted: readonly number[]): number {
  if (sorted.length === 0) return 0;
  const mid = Math.floor(sorted.length / 2);
  if (sorted.length % 2 === 1) return sorted[mid] ?? 0;
  return ((sorted[mid - 1] ?? 0) + (sorted[mid] ?? 0)) / 2;
}
