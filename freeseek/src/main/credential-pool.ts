/**
 * 通用凭证池管理器
 *
 * 支持多账号轮询 / 负载均衡：
 * - 凭证存储改为数组结构（兼容旧格式，单凭证自动包装为数组）
 * - 支持 Round-Robin / 随机策略
 * - 单账号请求失败时自动切换下一个
 * - 每个账号独立显示状态（有效/过期/失败次数）
 */
import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";

export interface CredentialEntry {
  id: string;
  credentials: Record<string, any>;
  status: "active" | "expired" | "failed";
  failCount: number;
  lastUsed: string | null;
  lastError: string | null;
  addedAt: string;
}

export type PoolStrategy = "round-robin" | "random";

export interface PoolSummary {
  total: number;
  active: number;
  strategy: PoolStrategy;
  entries: Array<{
    id: string;
    status: string;
    failCount: number;
    lastUsed: string | null;
    lastError: string | null;
    addedAt: string;
    capturedAt: string | null;
  }>;
}

export class CredentialPool {
  private entries: CredentialEntry[] = [];
  private currentIndex = 0;
  private strategy: PoolStrategy = "round-robin";

  constructor(private readonly filePath: string) {
    this.load();
  }

  /**
   * 从文件加载凭证。
   * 向后兼容：单对象自动包装为数组。
   */
  load(): void {
    try {
      if (!fs.existsSync(this.filePath)) return;
      const raw = JSON.parse(fs.readFileSync(this.filePath, "utf-8"));
      if (Array.isArray(raw)) {
        this.entries = raw;
      } else if (raw && typeof raw === "object") {
        this.entries = [
          {
            id: crypto.randomUUID(),
            credentials: raw,
            status: "active",
            failCount: 0,
            lastUsed: null,
            lastError: null,
            addedAt: raw.capturedAt || new Date().toISOString(),
          },
        ];
        this.save();
      }
    } catch {
      /* ignore */
    }
  }

  save(): void {
    fs.mkdirSync(path.dirname(this.filePath), { recursive: true });
    fs.writeFileSync(this.filePath, JSON.stringify(this.entries, null, 2));
  }

  /** 按策略获取下一个可用凭证 */
  next(): CredentialEntry | null {
    const active = this.entries.filter((e) => e.status === "active");
    if (active.length === 0) return null;

    let entry: CredentialEntry;
    if (this.strategy === "random") {
      entry = active[Math.floor(Math.random() * active.length)];
    } else {
      this.currentIndex = this.currentIndex % active.length;
      entry = active[this.currentIndex];
      this.currentIndex = (this.currentIndex + 1) % active.length;
    }
    entry.lastUsed = new Date().toISOString();
    return entry;
  }

  /** 获取第一个可用凭证的 credentials 数据（向后兼容 loadCredentials） */
  first(): Record<string, any> | null {
    const entry = this.entries.find((e) => e.status === "active");
    return entry?.credentials ?? null;
  }

  markFailed(id: string, error: string): void {
    const entry = this.entries.find((e) => e.id === id);
    if (!entry) return;
    entry.failCount++;
    entry.lastError = error;
    if (entry.failCount >= 5) entry.status = "failed";
    this.save();
  }

  markSuccess(id: string): void {
    const entry = this.entries.find((e) => e.id === id);
    if (!entry) return;
    entry.failCount = 0;
    entry.lastError = null;
    if (entry.status === "failed") entry.status = "active";
    this.save();
  }

  markExpired(id: string): void {
    const entry = this.entries.find((e) => e.id === id);
    if (entry) {
      entry.status = "expired";
      this.save();
    }
  }

  resetStatus(id: string): void {
    const entry = this.entries.find((e) => e.id === id);
    if (entry) {
      entry.status = "active";
      entry.failCount = 0;
      entry.lastError = null;
      this.save();
    }
  }

  add(creds: Record<string, any>): string {
    const id = crypto.randomUUID();
    this.entries.push({
      id,
      credentials: creds,
      status: "active",
      failCount: 0,
      lastUsed: null,
      lastError: null,
      addedAt: creds.capturedAt || new Date().toISOString(),
    });
    this.save();
    return id;
  }

  /**
   * 替换凭证（向后兼容 saveManualCredentials 的单凭证模式）。
   * 只有一个凭证时直接替换，多凭证时追加。
   */
  set(creds: Record<string, any>): void {
    if (this.entries.length <= 1) {
      this.entries = [
        {
          id: this.entries[0]?.id || crypto.randomUUID(),
          credentials: creds,
          status: "active",
          failCount: 0,
          lastUsed: null,
          lastError: null,
          addedAt: creds.capturedAt || new Date().toISOString(),
        },
      ];
      this.save();
    } else {
      this.add(creds);
    }
  }

  remove(id: string): boolean {
    const idx = this.entries.findIndex((e) => e.id === id);
    if (idx < 0) return false;
    this.entries.splice(idx, 1);
    if (this.currentIndex >= this.entries.length) this.currentIndex = 0;
    this.save();
    return true;
  }

  clearAll(): boolean {
    if (this.entries.length === 0) return false;
    this.entries = [];
    this.currentIndex = 0;
    try {
      if (fs.existsSync(this.filePath)) fs.unlinkSync(this.filePath);
    } catch {
      /* ignore */
    }
    return true;
  }

  getAll(): CredentialEntry[] {
    return [...this.entries];
  }

  count(): number {
    return this.entries.length;
  }

  activeCount(): number {
    return this.entries.filter((e) => e.status === "active").length;
  }

  reorder(ids: string[]): void {
    const ordered: CredentialEntry[] = [];
    for (const id of ids) {
      const entry = this.entries.find((e) => e.id === id);
      if (entry) ordered.push(entry);
    }
    for (const entry of this.entries) {
      if (!ordered.includes(entry)) ordered.push(entry);
    }
    this.entries = ordered;
    this.save();
  }

  getStrategy(): PoolStrategy {
    return this.strategy;
  }

  setStrategy(s: PoolStrategy): void {
    this.strategy = s;
  }

  getSummary(): PoolSummary {
    return {
      total: this.entries.length,
      active: this.activeCount(),
      strategy: this.strategy,
      entries: this.entries.map((e) => ({
        id: e.id,
        status: e.status,
        failCount: e.failCount,
        lastUsed: e.lastUsed,
        lastError: e.lastError,
        addedAt: e.addedAt,
        capturedAt: e.credentials.capturedAt ?? null,
      })),
    };
  }
}
