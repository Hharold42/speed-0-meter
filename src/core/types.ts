export type Unit = 'mbit' | 'mbyte';

export interface BenchmarkOptions {
  url: string;
  /** Число запросов, которые попадают в статистику. */
  requests: number;
  timeoutMs: number;
  /** Один дополнительный запрос до замера: прогревает DNS, TLS и кеши, в статистику не входит. */
  warmup: boolean;
  /** Сколько раз повторять запрос при временной ошибке (429, 5xx, сеть). */
  retries: number;
}

export interface Progress {
  bytes: number;
  /** Размер из Content-Length, если сервер его сообщил. */
  total?: number;
  seconds: number;
}

export type RequestResult =
  | {
      ok: true;
      /** От отправки запроса до последнего байта тела (последняя попытка). */
      seconds: number;
      /** До получения заголовков ответа. */
      ttfbSeconds: number;
      bytes: number;
      attempts: number;
    }
  | {
      ok: false;
      error: string;
      attempts: number;
      /** Имеет ли смысл повторять запрос. */
      retryable?: boolean;
      retryAfterMs?: number;
    };

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
  p95Seconds: number;
  stdDevSeconds: number;
  avgTtfbSeconds: number;
  /** Скорость по полному времени запроса, МБ/с (10^6 байт). */
  mbytePerSec: number;
  /** То же в Мбит/с. */
  mbitPerSec: number;
  /** Скорость без учёта TTFB (только передача тела), МБ/с. */
  downloadMbytePerSec: number;
  downloadMbitPerSec: number;
}

/** Проверка адреса перед каждым обращением (в том числе перед редиректами). Бросает GuardError. */
export type UrlGuard = (url: URL) => Promise<void>;
