#!/usr/bin/env node
import { main } from './cli.js';

const controller = new AbortController();
// SIGTERM нужен для Docker (`docker stop`): без обработчика PID 1 его игнорирует.
for (const signal of ['SIGINT', 'SIGTERM'] as const) {
  process.once(signal, () => controller.abort());
}

main(process.argv.slice(2), undefined, controller.signal).then(
  (code) => {
    process.exitCode = code;
  },
  (err: unknown) => {
    console.error(err instanceof Error ? err.stack : err);
    process.exitCode = 1;
  },
);
