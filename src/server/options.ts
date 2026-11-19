export interface ServeOptions {
  host: string;
  port: number;
  /** Сколько замеров выполняется одновременно. Больше 1 искажает результаты: замеры делят канал. */
  maxConcurrent: number;
  /** Максимум запросов в одном замере. */
  maxRequests: number;
  /** Сколько замеров может ждать в очереди. */
  maxQueue: number;
  /** Если задан, API требует `Authorization: Bearer <token>`. */
  token?: string | undefined;
  /** Разрешить адреса внутренней сети (отключает защиту от SSRF). Только для разработки. */
  allowPrivate: boolean;
  /** Сколько завершённых замеров хранить в памяти. */
  historyLimit: number;
}

export const MAX_TIMEOUT_SECONDS = 60;
export const MAX_RETRIES = 3;
