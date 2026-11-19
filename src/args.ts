import { parseArgs } from 'node:util';
import type { CliCommand, Unit } from './types.js';

export const DEFAULT_REQUESTS = 10;
export const DEFAULT_TIMEOUT_S = 60;

export class UsageError extends Error {
  override name = 'UsageError';
}

export const USAGE = `Использование: speedtest <url> [параметры]

  <url>               адрес для скачивания (http/https)
  -n, --requests <N>  число запросов (по умолчанию ${DEFAULT_REQUESTS})
  -t, --timeout <с>   таймаут одного запроса, секунды (по умолчанию ${DEFAULT_TIMEOUT_S})
  -u, --unit <ед.>    единица скорости: mbit (Мбит/с, по умолчанию) или mbyte (МБ/с)
      --json          итог в JSON (без построчного вывода)
  -h, --help          справка

Коды выхода: 0 — успех, 1 — ошибка/нет ответов, 2 — часть запросов не удалась.`;

export function parseCli(argv: readonly string[]): CliCommand {
  let parsed;
  try {
    parsed = parseArgs({
      args: [...argv],
      allowPositionals: true,
      options: {
        requests: { type: 'string', short: 'n', default: String(DEFAULT_REQUESTS) },
        timeout: { type: 'string', short: 't', default: String(DEFAULT_TIMEOUT_S) },
        unit: { type: 'string', short: 'u', default: 'mbit' },
        json: { type: 'boolean', default: false },
        help: { type: 'boolean', short: 'h', default: false },
      },
    });
  } catch (err) {
    throw new UsageError(err instanceof Error ? err.message : String(err));
  }
  const { values, positionals } = parsed;

  if (values.help) return { kind: 'help' };

  if (positionals.length !== 1) {
    throw new UsageError('нужно передать ровно один адрес');
  }
  const rawUrl = positionals[0] as string;
  let url: URL;
  try {
    url = new URL(rawUrl);
  } catch {
    throw new UsageError(`некорректный адрес: ${rawUrl}`);
  }
  if (url.protocol !== 'http:' && url.protocol !== 'https:') {
    throw new UsageError('поддерживаются только http:// и https://');
  }

  const requests = Number(values.requests);
  if (!Number.isInteger(requests) || requests < 1) {
    throw new UsageError('--requests должно быть целым числом >= 1');
  }
  const timeout = Number(values.timeout);
  if (!(timeout > 0)) {
    throw new UsageError('--timeout должно быть числом > 0');
  }
  if (values.unit !== 'mbit' && values.unit !== 'mbyte') {
    throw new UsageError('--unit: допустимо mbit или mbyte');
  }

  return {
    kind: 'run',
    options: {
      url: url.href,
      requests,
      timeoutMs: timeout * 1000,
      unit: values.unit as Unit,
      json: values.json,
    },
  };
}
