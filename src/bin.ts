#!/usr/bin/env node
import { main } from './cli/cli.js';
import { shouldUseColor } from './cli/style.js';

const controller = new AbortController();
// SIGTERM нужен для Docker (`docker stop`): без обработчика PID 1 его игнорирует.
for (const signal of ['SIGINT', 'SIGTERM'] as const) {
  process.once(signal, () => controller.abort());
}

main(process.argv.slice(2), {
  signal: controller.signal,
  color: shouldUseColor(process.stdout.isTTY, process.env),
  // Живой прогресс рисуем в stderr и только в терминале, чтобы не портить пайпы и JSON.
  ...(process.stderr.isTTY && { progress: (text: string) => void process.stderr.write(text) }),
}).then(
  (code) => {
    process.exitCode = code;
  },
  (err: unknown) => {
    console.error(err instanceof Error ? err.stack : err);
    process.exitCode = 1;
  },
);
