import { performance } from 'node:perf_hooks';
import type { Progress, Unit } from '../core/types.js';

const BAR_WIDTH = 20;
const CLEAR_LINE = '\r\x1b[K';

const megabytes = (bytes: number): string => (bytes / 1e6).toFixed(2);

export function formatProgress(label: string, progress: Progress, unit: Unit): string {
  const bytesPerSec = progress.seconds > 0 ? progress.bytes / progress.seconds : 0;
  const speed =
    unit === 'mbit'
      ? `${((bytesPerSec * 8) / 1e6).toFixed(1)} Мбит/с`
      : `${(bytesPerSec / 1e6).toFixed(2)} МБ/с`;

  if (progress.total && progress.total > 0) {
    const ratio = Math.min(1, progress.bytes / progress.total);
    const filled = Math.round(ratio * BAR_WIDTH);
    const bar = '█'.repeat(filled) + '░'.repeat(BAR_WIDTH - filled);
    return `${label} ${bar} ${String(Math.round(ratio * 100)).padStart(3)}%  ${megabytes(progress.bytes)} / ${megabytes(progress.total)} МБ  ${speed}`;
  }
  return `${label} ${megabytes(progress.bytes)} МБ  ${speed}`;
}

export interface ProgressRenderer {
  update(label: string, progress: Progress, unit: Unit): void;
  clear(): void;
}

/** Перерисовывает одну строку прогресса не чаще, чем раз в `intervalMs`. */
export function createProgressRenderer(
  write: (text: string) => void,
  intervalMs = 100,
  now: () => number = () => performance.now(),
): ProgressRenderer {
  let last = Number.NEGATIVE_INFINITY;
  return {
    update(label, progress, unit) {
      const t = now();
      if (t - last < intervalMs) return;
      last = t;
      write(`${CLEAR_LINE}${formatProgress(label, progress, unit)}`);
    },
    clear() {
      last = Number.NEGATIVE_INFINITY;
      write(CLEAR_LINE);
    },
  };
}
