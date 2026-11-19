import type { Options, RequestResult, Summary, Unit } from './types.js';

export const formatMB = (bytes: number): string => `${(bytes / 1e6).toFixed(2)} МБ`;

export function formatSpeed(summary: Summary, unit: Unit): string {
  return unit === 'mbit'
    ? `${summary.mbitPerSec.toFixed(2)} Мбит/с`
    : `${summary.mbytePerSec.toFixed(2)} МБ/с`;
}

export function formatHeader(options: Options): string[] {
  return [`Адрес: ${options.url}`, `Запросов: ${options.requests} (последовательно)`, ''];
}

export function formatRequestLine(index: number, total: number, result: RequestResult): string {
  const label = `[${String(index).padStart(String(total).length)}/${total}]`;
  return result.ok
    ? `${label} ${result.seconds.toFixed(3).padStart(7)} с  ${formatMB(result.bytes).padStart(10)}`
    : `${label} ${result.error}`;
}

export function formatSummary(summary: Summary, unit: Unit): string[] {
  const lines = ['', '--- Итог ---', `Успешных запросов:     ${summary.okCount} из ${summary.requested}`];
  if (summary.failedCount > 0) {
    lines.push(`Неуспешных запросов:   ${summary.failedCount}`);
  }
  if (summary.okCount === 0) return lines;

  lines.push(
    `Среднее время запроса: ${summary.avgSeconds.toFixed(3)} с`,
    `Медиана / мин / макс:  ${summary.medianSeconds.toFixed(3)} / ${summary.minSeconds.toFixed(3)} / ${summary.maxSeconds.toFixed(3)} с`,
    `Скачано всего:         ${formatMB(summary.totalBytes)}`,
    `Скорость скачивания:   ${formatSpeed(summary, unit)}`,
  );
  return lines;
}

export function formatJson(options: Options, results: readonly RequestResult[], summary: Summary): string {
  return JSON.stringify(
    {
      url: options.url,
      summary: {
        requested: summary.requested,
        ok: summary.okCount,
        failed: summary.failedCount,
        totalBytes: summary.totalBytes,
        totalSeconds: round(summary.totalSeconds),
        avgSeconds: round(summary.avgSeconds),
        medianSeconds: round(summary.medianSeconds),
        minSeconds: round(summary.minSeconds),
        maxSeconds: round(summary.maxSeconds),
        speedMbitPerSec: round(summary.mbitPerSec),
        speedMBytePerSec: round(summary.mbytePerSec),
      },
      requests: results.map((r) =>
        r.ok ? { ok: true, seconds: round(r.seconds), bytes: r.bytes } : { ok: false, error: r.error },
      ),
    },
    null,
    2,
  );
}

const round = (n: number): number => Math.round(n * 1000) / 1000;
