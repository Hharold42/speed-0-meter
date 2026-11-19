import { runBenchmark } from '../core/benchmark.js';
import { startServer } from '../server/app.js';
import type { ServeOptions } from '../server/options.js';
import { parseCli, UsageError, USAGE, type RunOptions } from './args.js';
import { createProgressRenderer } from './progress.js';
import {
  formatCsv,
  formatJson,
  formatMinSpeedLine,
  formatRequestLine,
  formatSummary,
  speedValue,
} from './reporter.js';
import { startSelfTestServer, type SelfTestServer } from './selftest.js';
import { createStyle } from './style.js';

export const EXIT_OK = 0;
export const EXIT_FAILURE = 1;
export const EXIT_PARTIAL = 2;
export const EXIT_BELOW_MIN_SPEED = 3;

/** Куда писать вывод. Подменяется в тестах. */
export interface Output {
  out(line: string): void;
  err(line: string): void;
}

export interface CliContext {
  output?: Output;
  /** Прерывание (Ctrl+C / SIGTERM). Для `serve` — сигнал остановки сервера. */
  signal?: AbortSignal;
  env?: Readonly<Record<string, string | undefined>>;
  /** Запись «живой» строки прогресса (stderr в терминале). Не задан — прогресса нет. */
  progress?: (text: string) => void;
  /** Включены ли цвета по умолчанию (определяет bin.ts по TTY и NO_COLOR). */
  color?: boolean;
}

const consoleOutput: Output = {
  out: (line) => console.log(line),
  err: (line) => console.error(line),
};

/**
 * Точка входа приложения. Возвращает код выхода, сам процесс не завершает.
 */
export async function main(argv: readonly string[], ctx: CliContext = {}): Promise<number> {
  const output = ctx.output ?? consoleOutput;

  let command;
  try {
    command = parseCli(argv, ctx.env ?? process.env);
  } catch (err) {
    if (err instanceof UsageError) {
      output.err(`Ошибка: ${err.message}\n\n${USAGE}`);
      return EXIT_FAILURE;
    }
    throw err;
  }

  switch (command.kind) {
    case 'help':
      output.out(USAGE);
      return EXIT_OK;
    case 'serve':
      return runServer(command.options, ctx, output);
    case 'run':
      return runMeasurement(command.options, ctx, output);
  }
}

async function runServer(options: ServeOptions, ctx: CliContext, output: Output): Promise<number> {
  let handle;
  try {
    handle = await startServer(options, (line) => output.err(line));
  } catch (err) {
    output.err(`Не удалось запустить сервер: ${err instanceof Error ? err.message : String(err)}`);
    return EXIT_FAILURE;
  }

  output.out(`Сервер запущен: http://${handle.host}:${handle.port}`);
  const isLoopback = ['127.0.0.1', 'localhost', '::1'].includes(options.host);
  if (!options.token && !isLoopback) {
    output.err(
      'Внимание: сервер доступен по сети без токена. Задайте --token или SPEEDTEST_TOKEN.',
    );
  }
  if (options.allowPrivate) {
    output.err('Внимание: защита от SSRF отключена (--allow-private).');
  }

  await new Promise<void>((resolve) => {
    if (ctx.signal?.aborted) return resolve();
    ctx.signal?.addEventListener('abort', () => resolve(), { once: true });
  });

  output.out('Останавливаю сервер…');
  await handle.close();
  return EXIT_OK;
}

async function runMeasurement(
  options: RunOptions,
  ctx: CliContext,
  output: Output,
): Promise<number> {
  let selfTest: SelfTestServer | undefined;
  try {
    selfTest = options.target.kind === 'self-test' ? await startSelfTestServer() : undefined;
    const url =
      options.target.kind === 'url' ? options.target.url : (selfTest as SelfTestServer).url;
    return await measure(url, selfTest !== undefined, options, ctx, output);
  } finally {
    await selfTest?.close();
  }
}

async function measure(
  url: string,
  isSelfTest: boolean,
  options: RunOptions,
  ctx: CliContext,
  output: Output,
): Promise<number> {
  const { benchmark, unit, format, minSpeed } = options;
  const style = createStyle(options.color ?? ctx.color ?? false);
  const renderer = ctx.progress ? createProgressRenderer(ctx.progress) : undefined;
  const isText = format === 'text';
  const labelFor = (index: number): string =>
    index === 0
      ? 'прогрев'
      : `[${String(index).padStart(String(benchmark.requests).length)}/${benchmark.requests}]`;

  if (isText) {
    output.out(`Адрес: ${url}${isSelfTest ? style.dim('  (встроенный тестовый сервер)') : ''}`);
    const extras = [
      benchmark.warmup && 'прогрев',
      benchmark.retries > 0 && `повторов: ${benchmark.retries}`,
    ].filter(Boolean);
    output.out(
      `Запросов: ${benchmark.requests} (последовательно)${extras.length ? `, ${extras.join(', ')}` : ''}`,
    );
    output.out('');
  }

  const outcome = await runBenchmark(
    { ...benchmark, url },
    {
      signal: ctx.signal,
      onProgress: (index, progress) => renderer?.update(labelFor(index), progress, unit),
      onWarmup: (result) => {
        renderer?.clear();
        if (!isText) return;
        output.out(
          style.dim(
            result.ok
              ? `Прогрев: ${result.seconds.toFixed(3)} с (в статистику не входит)`
              : `Прогрев не удался: ${result.error} (продолжаем)`,
          ),
        );
      },
      onResult: (index, total, result) => {
        renderer?.clear();
        if (isText) output.out(formatRequestLine(index, total, result, style));
      },
    },
  );
  renderer?.clear();

  const { results, summary, interrupted } = outcome;
  const speed = speedValue(summary, unit);
  const belowMin = minSpeed !== undefined && summary.okCount > 0 && speed < minSpeed;

  if (format === 'json') {
    output.out(
      formatJson(
        url,
        results,
        summary,
        minSpeed !== undefined ? { threshold: minSpeed, unit, passed: !belowMin } : undefined,
      ),
    );
  } else if (format === 'csv') {
    formatCsv(results).forEach((line) => output.out(line));
  } else {
    if (interrupted) output.out(style.yellow('\nПрервано пользователем.'));
    formatSummary(summary, results, unit, style).forEach((line) => output.out(line));
    if (minSpeed !== undefined && summary.okCount > 0) {
      output.out(formatMinSpeedLine(summary, unit, minSpeed, style));
    }
  }

  if (summary.okCount === 0) {
    output.err('Не удалось получить ни одного ответа.');
    return EXIT_FAILURE;
  }
  if (belowMin) return EXIT_BELOW_MIN_SPEED;
  return summary.failedCount > 0 || interrupted ? EXIT_PARTIAL : EXIT_OK;
}
