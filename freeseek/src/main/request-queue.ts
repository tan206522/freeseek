/**
 * 请求队列与限速
 *
 * 每个 Provider 维护独立请求队列，可配置每分钟最大请求数。
 * 超限时排队等待，不返回 429。
 */
import crypto from "node:crypto";

export interface QueueConfig {
  /** 每分钟最大请求数，0 或负数表示不限制 */
  maxPerMinute: number;
}

interface QueuedTask {
  id: string;
  execute: () => Promise<any>;
  resolve: (value: any) => void;
  reject: (reason: any) => void;
  createdAt: number;
}

export interface QueueStatus {
  providerId: string;
  queued: number;
  processing: number;
  maxPerMinute: number;
  requestsInWindow: number;
}

export class RequestQueue {
  private queues = new Map<string, QueuedTask[]>();
  private processing = new Map<string, number>();
  private timestamps = new Map<string, number[]>();
  private configs = new Map<string, QueueConfig>();
  private timers = new Map<string, ReturnType<typeof setTimeout>>();

  setConfig(providerId: string, config: QueueConfig): void {
    this.configs.set(providerId, config);
  }

  getConfig(providerId: string): QueueConfig {
    return this.configs.get(providerId) || { maxPerMinute: 0 };
  }

  /** 入队执行任务，自动按限速排队 */
  async enqueue<T>(providerId: string, task: () => Promise<T>): Promise<T> {
    const config = this.configs.get(providerId);
    if (!config || config.maxPerMinute <= 0) {
      return task();
    }

    return new Promise<T>((resolve, reject) => {
      if (!this.queues.has(providerId)) this.queues.set(providerId, []);
      this.queues.get(providerId)!.push({
        id: crypto.randomUUID(),
        execute: task,
        resolve,
        reject,
        createdAt: Date.now(),
      });
      this.processQueue(providerId);
    });
  }

  private processQueue(providerId: string): void {
    const queue = this.queues.get(providerId);
    if (!queue || queue.length === 0) return;

    const config = this.configs.get(providerId);
    if (!config || config.maxPerMinute <= 0) {
      const task = queue.shift()!;
      task.execute().then(task.resolve).catch(task.reject);
      return;
    }

    const now = Date.now();
    const windowMs = 60_000;

    const ts = this.timestamps.get(providerId) || [];
    const recentTs = ts.filter((t) => now - t < windowMs);
    this.timestamps.set(providerId, recentTs);

    if (recentTs.length >= config.maxPerMinute) {
      const oldestTs = recentTs[0];
      const waitMs = oldestTs + windowMs - now + 100;

      if (!this.timers.has(providerId)) {
        this.timers.set(
          providerId,
          setTimeout(() => {
            this.timers.delete(providerId);
            this.processQueue(providerId);
          }, waitMs),
        );
      }
      return;
    }

    const task = queue.shift()!;
    this.processing.set(
      providerId,
      (this.processing.get(providerId) || 0) + 1,
    );
    recentTs.push(now);

    task
      .execute()
      .then(task.resolve)
      .catch(task.reject)
      .finally(() => {
        this.processing.set(
          providerId,
          Math.max(0, (this.processing.get(providerId) || 1) - 1),
        );
        this.processQueue(providerId);
      });
  }

  getStatus(): QueueStatus[] {
    const result: QueueStatus[] = [];
    const allProviders = new Set([
      ...this.queues.keys(),
      ...this.configs.keys(),
    ]);
    const now = Date.now();
    for (const providerId of allProviders) {
      const config = this.configs.get(providerId) || { maxPerMinute: 0 };
      const ts = (this.timestamps.get(providerId) || []).filter(
        (t) => now - t < 60_000,
      );
      result.push({
        providerId,
        queued: this.queues.get(providerId)?.length || 0,
        processing: this.processing.get(providerId) || 0,
        maxPerMinute: config.maxPerMinute,
        requestsInWindow: ts.length,
      });
    }
    return result;
  }
}

export const requestQueue = new RequestQueue();
