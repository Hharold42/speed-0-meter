import type { RequestResult, Summary } from './types.js';

const round = (n: number): number => Math.round(n * 1000) / 1000;

/** Представление результата запроса для JSON (CLI `--json` и HTTP API). */
export function serializeResult(r: RequestResult): Record<string, unknown> {
  return r.ok
    ? {
        ok: true,
        seconds: round(r.seconds),
        ttfbSeconds: round(r.ttfbSeconds),
        bytes: r.bytes,
        attempts: r.attempts,
      }
    : { ok: false, error: r.error, attempts: r.attempts };
}

export function serializeSummary(s: Summary): Record<string, unknown> {
  return {
    requested: s.requested,
    ok: s.okCount,
    failed: s.failedCount,
    totalBytes: s.totalBytes,
    totalSeconds: round(s.totalSeconds),
    avgSeconds: round(s.avgSeconds),
    medianSeconds: round(s.medianSeconds),
    minSeconds: round(s.minSeconds),
    maxSeconds: round(s.maxSeconds),
    p95Seconds: round(s.p95Seconds),
    stdDevSeconds: round(s.stdDevSeconds),
    avgTtfbSeconds: round(s.avgTtfbSeconds),
    speedMbitPerSec: round(s.mbitPerSec),
    speedMBytePerSec: round(s.mbytePerSec),
    downloadSpeedMbitPerSec: round(s.downloadMbitPerSec),
    downloadSpeedMBytePerSec: round(s.downloadMbytePerSec),
  };
}
