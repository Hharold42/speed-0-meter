import { parseArgs } from 'node:util';
import type { BenchmarkOptions, Unit } from '../core/types.js';
import type { ServeOptions } from '../server/options.js';

export const DEFAULT_REQUESTS = 10;
export const DEFAULT_TIMEOUT_S = 60;
export const DEFAULT_PORT = 3000;

export type OutputFormat = 'text' | 'json' | 'csv';

export interface RunOptions {
  target: { kind: 'url'; url: string } | { kind: 'self-test' };
  benchmark: Omit<BenchmarkOptions, 'url'>;
  unit: Unit;
  format: OutputFormat;
  /** Порог скорости в выбранных единицах; ниже — код выхода 3. */
  minSpeed?: number;
  /** `undefined` — определить автоматически (TTY и NO_COLOR). */
  color?: boolean;
}

export type CliCommand =
  | { kind: 'help' }
  | { kind: 'run'; options: RunOptions }
  | { kind: 'serve'; options: ServeOptions };

export class UsageError extends Error {
  override name = 'UsageError';
}

export const USAGE = `Использование:
  speedtest <url> [параметры]     замер скорости скачивания из консоли
  speedtest --self-test           демо на встроенном локальном сервере (без интернета)
  speedtest serve [параметры]     HTTP-сервер с API и веб-интерфейсом

Параметры замера:
  -n, --requests <N>    число запросов (по умолчанию ${DEFAULT_REQUESTS})
  -t, --timeout <с>     таймаут одного запроса, секунды (по умолчанию ${DEFAULT_TIMEOUT_S})
  -u, --unit <ед.>      единица скорости: mbit (Мбит/с, по умолчанию) или mbyte (МБ/с)
  -r, --retries <N>     повторы при временных ошибках: 429, 5xx, сеть (по умолчанию 0)
  -w, --warmup          прогревочный запрос, не входящий в статистику
      --min-speed <X>   порог скорости в выбранных единицах; ниже порога код выхода 3
      --json            итог в JSON
      --csv             результаты запросов в CSV
      --no-color        отключить цвета (также учитывается NO_COLOR)
  -h, --help            справка

Параметры serve:
  -p, --port <N>        порт (по умолчанию ${DEFAULT_PORT}, или PORT)
      --host <адрес>    интерфейс (по умолчанию 127.0.0.1; в Docker нужен 0.0.0.0)
      --token <строка>  требовать Bearer-токен для API (лучше задать SPEEDTEST_TOKEN)
      --max-concurrent <N>  одновременных замеров (по умолчанию 1)
      --max-requests <N>    максимум запросов в замере (по умолчанию 20)
      --max-queue <N>       длина очереди замеров (по умолчанию 20)
      --allow-private   разрешить адреса внутренней сети (отключает защиту от SSRF)

Переменные окружения: SPEEDTEST_REQUESTS, SPEEDTEST_TIMEOUT, SPEEDTEST_UNIT, SPEEDTEST_RETRIES.

Коды выхода: 0 — успех; 1 — ошибка или нет ни одного ответа;
2 — часть запросов не удалась или прогон прерван; 3 — скорость ниже --min-speed.`;

type Env = Readonly<Record<string, string | undefined>>;

export function parseCli(argv: readonly string[], env: Env = process.env): CliCommand {
  if (argv[0] === 'serve') return parseServe(argv.slice(1), env);
  return parseRun(argv, env);
}

function parse<T extends Parameters<typeof parseArgs>[0]>(config: T): ReturnType<typeof parseArgs> {
  try {
    return parseArgs(config);
  } catch (err) {
    throw new UsageError(err instanceof Error ? err.message : String(err));
  }
}

function parseRun(argv: readonly string[], env: Env): CliCommand {
  const { values, positionals } = parse({
    args: [...argv],
    allowPositionals: true,
    options: {
      requests: {
        type: 'string',
        short: 'n',
        default: env.SPEEDTEST_REQUESTS ?? String(DEFAULT_REQUESTS),
      },
      timeout: {
        type: 'string',
        short: 't',
        default: env.SPEEDTEST_TIMEOUT ?? String(DEFAULT_TIMEOUT_S),
      },
      unit: { type: 'string', short: 'u', default: env.SPEEDTEST_UNIT ?? 'mbit' },
      retries: { type: 'string', short: 'r', default: env.SPEEDTEST_RETRIES ?? '0' },
      warmup: { type: 'boolean', short: 'w', default: false },
      'min-speed': { type: 'string' },
      json: { type: 'boolean', default: false },
      csv: { type: 'boolean', default: false },
      'no-color': { type: 'boolean', default: false },
      'self-test': { type: 'boolean', default: false },
      help: { type: 'boolean', short: 'h', default: false },
    },
  });

  if (values.help) return { kind: 'help' };

  const selfTest = values['self-test'] === true;
  if (selfTest ? positionals.length > 0 : positionals.length !== 1) {
    throw new UsageError(
      selfTest ? '--self-test не принимает адрес' : 'нужно передать ровно один адрес',
    );
  }

  let target: RunOptions['target'] = { kind: 'self-test' };
  if (!selfTest) {
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
    target = { kind: 'url', url: url.href };
  }

  const requests = Number(values.requests);
  if (!Number.isInteger(requests) || requests < 1) {
    throw new UsageError('--requests должно быть целым числом >= 1');
  }
  const timeout = Number(values.timeout);
  if (!(timeout > 0)) throw new UsageError('--timeout должно быть числом > 0');
  const retries = Number(values.retries);
  if (!Number.isInteger(retries) || retries < 0) {
    throw new UsageError('--retries должно быть целым числом >= 0');
  }
  if (values.unit !== 'mbit' && values.unit !== 'mbyte') {
    throw new UsageError('--unit: допустимо mbit или mbyte');
  }
  if (values.json && values.csv) throw new UsageError('--json и --csv нельзя использовать вместе');

  let minSpeed: number | undefined;
  if (values['min-speed'] !== undefined) {
    minSpeed = Number(values['min-speed']);
    if (!(minSpeed > 0)) throw new UsageError('--min-speed должно быть числом > 0');
  }

  return {
    kind: 'run',
    options: {
      target,
      benchmark: { requests, timeoutMs: timeout * 1000, warmup: values.warmup === true, retries },
      unit: values.unit as Unit,
      format: values.json ? 'json' : values.csv ? 'csv' : 'text',
      ...(minSpeed !== undefined && { minSpeed }),
      ...(values['no-color'] && { color: false }),
    },
  };
}

function parseServe(argv: readonly string[], env: Env): CliCommand {
  const { values, positionals } = parse({
    args: [...argv],
    allowPositionals: true,
    options: {
      port: {
        type: 'string',
        short: 'p',
        default: env.SPEEDTEST_PORT ?? env.PORT ?? String(DEFAULT_PORT),
      },
      host: { type: 'string', default: env.SPEEDTEST_HOST ?? '127.0.0.1' },
      token: { type: 'string' },
      'max-concurrent': { type: 'string', default: '1' },
      'max-requests': { type: 'string', default: '20' },
      'max-queue': { type: 'string', default: '20' },
      'allow-private': { type: 'boolean', default: false },
      help: { type: 'boolean', short: 'h', default: false },
    },
  });

  if (values.help) return { kind: 'help' };
  if (positionals.length > 0) throw new UsageError('serve не принимает позиционных аргументов');

  const integer = (
    name: string,
    raw: unknown,
    min: number,
    max = Number.MAX_SAFE_INTEGER,
  ): number => {
    const value = Number(raw);
    if (!Number.isInteger(value) || value < min || value > max) {
      throw new UsageError(`--${name}: нужно целое число от ${min} до ${max}`);
    }
    return value;
  };

  const token = (values.token as string | undefined) ?? env.SPEEDTEST_TOKEN;
  return {
    kind: 'serve',
    options: {
      host: values.host as string,
      port: integer('port', values.port, 0, 65535),
      maxConcurrent: integer('max-concurrent', values['max-concurrent'], 1, 16),
      maxRequests: integer('max-requests', values['max-requests'], 1, 1000),
      maxQueue: integer('max-queue', values['max-queue'], 0, 1000),
      ...(token ? { token } : {}),
      allowPrivate: values['allow-private'] === true,
      historyLimit: 100,
    },
  };
}
