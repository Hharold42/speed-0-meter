export interface Style {
  bold(text: string): string;
  dim(text: string): string;
  green(text: string): string;
  red(text: string): string;
  yellow(text: string): string;
}

const wrap =
  (open: number, close: number) =>
  (text: string): string =>
    `\x1b[${open}m${text}\x1b[${close}m`;

const identity = (text: string): string => text;

export function createStyle(enabled: boolean): Style {
  if (!enabled) {
    return { bold: identity, dim: identity, green: identity, red: identity, yellow: identity };
  }
  return {
    bold: wrap(1, 22),
    dim: wrap(2, 22),
    green: wrap(32, 39),
    red: wrap(31, 39),
    yellow: wrap(33, 39),
  };
}

/** Цвета включаем только в терминале и если не задан NO_COLOR (https://no-color.org). */
export function shouldUseColor(
  isTTY: boolean | undefined,
  env: Readonly<Record<string, string | undefined>>,
): boolean {
  if (!isTTY) return false;
  if (env.NO_COLOR !== undefined && env.NO_COLOR !== '') return false;
  return env.TERM !== 'dumb';
}
