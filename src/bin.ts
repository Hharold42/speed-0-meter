#!/usr/bin/env node
import { main } from './cli.js';

const controller = new AbortController();
process.once('SIGINT', () => controller.abort());

main(process.argv.slice(2), undefined, controller.signal).then(
  (code) => {
    process.exitCode = code;
  },
  (err: unknown) => {
    console.error(err instanceof Error ? err.stack : err);
    process.exitCode = 1;
  },
);
