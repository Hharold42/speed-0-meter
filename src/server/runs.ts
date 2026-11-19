import { randomUUID } from 'node:crypto';
import { runBenchmark, type BenchmarkOutcome } from '../core/benchmark.js';
import { summarize } from '../core/stats.js';
import type { BenchmarkOptions, RequestResult, Summary, UrlGuard } from '../core/types.js';

export type RunStatus = 'queued' | 'running' | 'done' | 'failed' | 'cancelled';

export interface RunRecord {
  id: string;
  options: BenchmarkOptions;
  status: RunStatus;
  createdAt: string;
  startedAt?: string;
  finishedAt?: string;
  progress: { completed: number; total: number };
  results: RequestResult[];
  summary?: Summary;
  error?: string;
}

export class QueueFullError extends Error {
  override name = 'QueueFullError';
}

export interface RunManagerConfig {
  maxConcurrent: number;
  maxQueue: number;
  historyLimit: number;
  guard?: UrlGuard | undefined;
  /** Подменяется в тестах. */
  benchmark?: typeof runBenchmark;
}

const FINISHED: ReadonlySet<RunStatus> = new Set(['done', 'failed', 'cancelled']);
export const isFinished = (status: RunStatus): boolean => FINISHED.has(status);

/**
 * Очередь замеров в памяти. Замеры делят один канал и искажают друг друга,
 * поэтому одновременно выполняется не больше `maxConcurrent` (по умолчанию 1),
 * остальные ждут в очереди ограниченной длины.
 */
export class RunManager {
  private readonly records = new Map<string, RunRecord>();
  private readonly controllers = new Map<string, AbortController>();
  private readonly waiting: string[] = [];
  private readonly idleWaiters: Array<() => void> = [];
  private active = 0;
  private closed = false;
  private readonly benchmark: typeof runBenchmark;

  constructor(private readonly config: RunManagerConfig) {
    this.benchmark = config.benchmark ?? runBenchmark;
  }

  submit(options: BenchmarkOptions): RunRecord {
    if (this.closed) throw new Error('сервер останавливается');
    if (this.active >= this.config.maxConcurrent && this.waiting.length >= this.config.maxQueue) {
      throw new QueueFullError('очередь замеров переполнена, повторите позже');
    }

    const record: RunRecord = {
      id: randomUUID(),
      options,
      status: 'queued',
      createdAt: new Date().toISOString(),
      progress: { completed: 0, total: options.requests },
      results: [],
    };
    this.records.set(record.id, record);
    this.controllers.set(record.id, new AbortController());
    this.waiting.push(record.id);
    this.evict();
    this.pump();
    return record;
  }

  get(id: string): RunRecord | undefined {
    return this.records.get(id);
  }

  /** Новые замеры первыми. */
  list(): RunRecord[] {
    return [...this.records.values()].reverse();
  }

  /** Отменяет замер из очереди или останавливает выполняющийся. Завершённые не трогает. */
  cancel(id: string): RunRecord | undefined {
    const record = this.records.get(id);
    if (!record) return undefined;

    if (record.status === 'queued') {
      const index = this.waiting.indexOf(id);
      if (index >= 0) this.waiting.splice(index, 1);
      this.controllers.delete(id);
      record.status = 'cancelled';
      record.finishedAt = new Date().toISOString();
      record.summary = summarize([]);
    } else if (record.status === 'running') {
      this.controllers.get(id)?.abort();
    }
    return record;
  }

  /** Останавливает приём задач, отменяет всё и дожидается завершения активных замеров. */
  async shutdown(): Promise<void> {
    this.closed = true;
    for (const id of [...this.waiting]) this.cancel(id);
    for (const controller of this.controllers.values()) controller.abort();
    if (this.active > 0) {
      await new Promise<void>((resolve) => this.idleWaiters.push(resolve));
    }
  }

  private pump(): void {
    while (!this.closed && this.active < this.config.maxConcurrent) {
      const id = this.waiting.shift();
      if (id === undefined) return;
      void this.execute(id);
    }
  }

  private async execute(id: string): Promise<void> {
    const record = this.records.get(id);
    const controller = this.controllers.get(id);
    if (!record || !controller) return;

    this.active++;
    record.status = 'running';
    record.startedAt = new Date().toISOString();
    try {
      const outcome: BenchmarkOutcome = await this.benchmark(record.options, {
        signal: controller.signal,
        guard: this.config.guard,
        onResult: (_index, _total, result) => {
          record.results.push(result);
          record.progress.completed = record.results.length;
        },
      });
      record.results = outcome.results;
      record.progress.completed = outcome.results.length;
      record.summary = outcome.summary;

      if (controller.signal.aborted) {
        record.status = 'cancelled';
      } else if (outcome.summary.okCount === 0) {
        record.status = 'failed';
        record.error = firstError(outcome.results) ?? 'не получено ни одного успешного ответа';
      } else {
        record.status = 'done';
      }
    } catch (err) {
      record.status = 'failed';
      record.error = err instanceof Error ? err.message : String(err);
    } finally {
      record.finishedAt = new Date().toISOString();
      this.controllers.delete(id);
      this.active--;
      this.pump();
      if (this.active === 0) {
        for (const resolve of this.idleWaiters.splice(0)) resolve();
      }
    }
  }

  /** Старые завершённые замеры вытесняются, чтобы память не росла бесконечно. */
  private evict(): void {
    for (const [id, record] of this.records) {
      if (this.records.size <= this.config.historyLimit) return;
      if (isFinished(record.status)) this.records.delete(id);
    }
  }
}

function firstError(results: readonly RequestResult[]): string | undefined {
  for (const r of results) if (!r.ok) return r.error;
  return undefined;
}
