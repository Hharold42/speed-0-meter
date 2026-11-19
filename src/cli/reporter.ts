import { serializeResult, serializeSummary } from '../core/serialize.js';
import type { RequestResult, Summary, Unit } from '../core/types.js';
import type { Style } from './style.js';

export const formatMB = (bytes: number): string => `${(bytes / 1e6).toFixed(2)} МБ`;

const seconds = (value: number): string => `${value.toFixed(3)} с`;

export function speedValue(
  summary: Summary,
  unit: Unit,
  kind: 'total' | 'download' = 'total',
): number {
  if (kind === 'download') {
    return unit === 'mbit' ? summary.downloadMbitPerSec : summary.downloadMbytePerSec;
  }
  return unit === 'mbit' ? summary.mbitPerSec : summary.mbytePerSec;
}

export const unitLabel = (unit: Unit): string => (unit === 'mbit' ? 'Мбит/с' : 'МБ/с');

export function formatSpeed(
  summary: Summary,
  unit: Unit,
  kind: 'total' | 'download' = 'total',
): string {
  return `${speedValue(summary, unit, kind).toFixed(2)} ${unitLabel(unit)}`;
}

const attemptsNote = (attempts: number): string => (attempts > 1 ? `  (попыток: ${attempts})` : '');

export function formatRequestLine(
  index: number,
  total: number,
  result: RequestResult,
  style: Style,
): string {
  const label = `[${String(index).padStart(String(total).length)}/${total}]`;
  if (!result.ok) {
    return `${label} ${style.red(result.error)}${attemptsNote(result.attempts)}`;
  }
  const time = style.green(`${result.seconds.toFixed(3).padStart(7)} с`);
  const ttfb = style.dim(`TTFB ${result.ttfbSeconds.toFixed(3)} с`);
  return `${label} ${time}  ${ttfb}  ${formatMB(result.bytes).padStart(10)}${attemptsNote(result.attempts)}`;
}

const SPARK_CHARS = '▁▂▃▄▅▆▇█';

/** Мини-график времени запросов: выше столбик — дольше запрос. */
export function sparkline(values: readonly number[]): string {
  if (values.length === 0) return '';
  const min = Math.min(...values);
  const max = Math.max(...values);
  const span = max - min;
  return values
    .map((v) => {
      const level = span === 0 ? 3 : Math.round(((v - min) / span) * (SPARK_CHARS.length - 1));
      return SPARK_CHARS[level] ?? '';
    })
    .join('');
}

export function formatSummary(
  summary: Summary,
  results: readonly RequestResult[],
  unit: Unit,
  style: Style,
): string[] {
  const lines = [
    '',
    style.bold('--- Итог ---'),
    `Успешных запросов:     ${summary.okCount} из ${summary.requested}`,
  ];
  if (summary.failedCount > 0) {
    lines.push(`Неуспешных запросов:   ${style.red(String(summary.failedCount))}`);
  }
  if (summary.okCount === 0) return lines;

  const times = results.flatMap((r) => (r.ok ? [r.seconds] : []));
  lines.push(
    `Среднее время запроса: ${seconds(summary.avgSeconds)}`,
    `Медиана / мин / макс:  ${summary.medianSeconds.toFixed(3)} / ${summary.minSeconds.toFixed(3)} / ${summary.maxSeconds.toFixed(3)} с`,
    `p95 / σ:               ${summary.p95Seconds.toFixed(3)} / ${summary.stdDevSeconds.toFixed(3)} с`,
    `Средний TTFB:          ${seconds(summary.avgTtfbSeconds)}`,
    `Скачано всего:         ${formatMB(summary.totalBytes)}`,
    `Скорость скачивания:   ${style.bold(formatSpeed(summary, unit))}`,
    `Скорость без TTFB:     ${formatSpeed(summary, unit, 'download')}`,
    `Время запросов:        ${sparkline(times)}`,
  );
  return lines;
}

export function formatMinSpeedLine(
  summary: Summary,
  unit: Unit,
  minSpeed: number,
  style: Style,
): string {
  const passed = speedValue(summary, unit) >= minSpeed;
  const verdict = passed ? style.green('выполнен') : style.red('НЕ выполнен');
  return `Порог ${minSpeed} ${unitLabel(unit)}:`.padEnd(23) + verdict;
}

export interface MinSpeedCheck {
  threshold: number;
  unit: Unit;
  passed: boolean;
}

export function formatJson(
  url: string,
  results: readonly RequestResult[],
  summary: Summary,
  minSpeedCheck?: MinSpeedCheck,
): string {
  return JSON.stringify(
    {
      url,
      summary: serializeSummary(summary),
      ...(minSpeedCheck && { minSpeedCheck }),
      requests: results.map(serializeResult),
    },
    null,
    2,
  );
}

const csvCell = (value: string | number | boolean): string => {
  const text = String(value);
  return /[",\n\r]/.test(text) ? `"${text.replaceAll('"', '""')}"` : text;
};

export function formatCsv(results: readonly RequestResult[]): string[] {
  const rows = results.map((r, i) =>
    (r.ok
      ? [i + 1, true, r.seconds.toFixed(3), r.ttfbSeconds.toFixed(3), r.bytes, r.attempts, '']
      : [i + 1, false, '', '', '', r.attempts, r.error]
    )
      .map(csvCell)
      .join(','),
  );
  return ['request,ok,seconds,ttfb_seconds,bytes,attempts,error', ...rows];
}
