import { parseCli, UsageError, USAGE } from './args.js';
import { downloadOnce } from './downloader.js';
import { formatHeader, formatJson, formatRequestLine, formatSummary } from './reporter.js';
import { summarize } from './stats.js';
import type { Output, RequestResult } from './types.js';

export const EXIT_OK = 0;
export const EXIT_FAILURE = 1;
export const EXIT_PARTIAL = 2;

const consoleOutput: Output = {
  out: (line) => console.log(line),
  err: (line) => console.error(line),
};

/**
 * Точка входа приложения. Возвращает код выхода, сама процесс не завершает.
 * `signal` позволяет прервать прогон (Ctrl+C): итог по уже выполненным запросам всё равно печатается.
 */
export async function main(
  argv: readonly string[],
  output: Output = consoleOutput,
  signal?: AbortSignal,
): Promise<number> {
  let command;
  try {
    command = parseCli(argv);
  } catch (err) {
    if (err instanceof UsageError) {
      output.err(`Ошибка: ${err.message}\n\n${USAGE}`);
      return EXIT_FAILURE;
    }
    throw err;
  }

  if (command.kind === 'help') {
    output.out(USAGE);
    return EXIT_OK;
  }

  const { options } = command;
  if (!options.json) {
    formatHeader(options).forEach((line) => output.out(line));
  }

  const results: RequestResult[] = [];
  for (let i = 1; i <= options.requests; i++) {
    const result = await downloadOnce(options.url, options.timeoutMs, signal);
    // Запрос, прерванный пользователем, в статистику не берём.
    if (signal?.aborted) break;
    results.push(result);
    if (!options.json) {
      output.out(formatRequestLine(i, options.requests, result));
    }
  }

  const summary = summarize(results);
  const interrupted = signal?.aborted === true;

  if (options.json) {
    output.out(formatJson(options, results, summary));
  } else {
    if (interrupted) output.out('\nПрервано пользователем.');
    formatSummary(summary, options.unit).forEach((line) => output.out(line));
  }

  if (summary.okCount === 0) {
    output.err('Не удалось получить ни одного ответа.');
    return EXIT_FAILURE;
  }
  return summary.failedCount > 0 || interrupted ? EXIT_PARTIAL : EXIT_OK;
}
