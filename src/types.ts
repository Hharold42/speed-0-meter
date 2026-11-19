export type Unit = 'mbit' | 'mbyte';

export interface Options {
  url: string;
  requests: number;
  timeoutMs: number;
  unit: Unit;
  json: boolean;
}

export type CliCommand =
  | { kind: 'help' }
  | { kind: 'run'; options: Options };

export type RequestResult =
  | { ok: true; seconds: number; bytes: number }
  | { ok: false; error: string };

export interface Summary {
  requested: number;
  okCount: number;
  failedCount: number;
  totalBytes: number;
  totalSeconds: number;
  avgSeconds: number;
  minSeconds: number;
  maxSeconds: number;
  medianSeconds: number;
  /** Мегабайты в секунду (10^6 байт). */
  mbytePerSec: number;
  /** Мегабиты в секунду (10^6 бит). */
  mbitPerSec: number;
}

/** Куда писать вывод. Подменяется в тестах. */
export interface Output {
  out(line: string): void;
  err(line: string): void;
}
