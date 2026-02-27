/**
 * 凭证自动刷新后台服务
 *
 * 定时检测各 Provider 的 Token 过期状态，
 * 快过期时（默认 < 10 分钟）自动触发 captureCredentials()。
 * 刷新失败时通过回调通知上层（系统托盘 / 日志）。
 */
import { registry } from "./providers";

export interface RefresherConfig {
  enabled: boolean;
  /** 提前多久触发刷新（毫秒），默认 10 分钟 */
  leadTimeMs: number;
  /** 检查间隔（毫秒），默认 60 秒 */
  checkIntervalMs: number;
}

export type RefresherNotifyCallback = (
  providerId: string,
  message: string,
  level: "info" | "warn" | "err",
) => void;

export class CredentialRefresher {
  private timer: ReturnType<typeof setInterval> | null = null;
  private refreshing = new Set<string>();
  private config: RefresherConfig = {
    enabled: true,
    leadTimeMs: 10 * 60 * 1000,
    checkIntervalMs: 60 * 1000,
  };
  private notify: RefresherNotifyCallback;

  constructor(notify?: RefresherNotifyCallback) {
    this.notify = notify || (() => {});
  }

  setNotify(fn: RefresherNotifyCallback): void {
    this.notify = fn;
  }

  start(config?: Partial<RefresherConfig>): void {
    if (config) this.config = { ...this.config, ...config };
    this.stop();
    if (!this.config.enabled) return;

    this.timer = setInterval(() => this.check(), this.config.checkIntervalMs);
    console.log(
      `[Refresher] 凭证自动刷新已启动 (提前量: ${Math.round(this.config.leadTimeMs / 60000)}min, 间隔: ${Math.round(this.config.checkIntervalMs / 1000)}s)`,
    );
  }

  stop(): void {
    if (this.timer) {
      clearInterval(this.timer);
      this.timer = null;
    }
  }

  updateConfig(config: Partial<RefresherConfig>): void {
    const wasRunning = this.isRunning();
    this.config = { ...this.config, ...config };
    if (wasRunning) this.start();
  }

  getConfig(): RefresherConfig {
    return { ...this.config };
  }

  isRunning(): boolean {
    return this.timer !== null;
  }

  private check(): void {
    for (const provider of registry.all()) {
      if (!provider.checkExpiry) continue;
      try {
        const status = provider.checkExpiry();
        if (!status.valid) {
          this.notify(provider.id, `${provider.name} 凭证已过期`, "warn");
          continue;
        }
        const shouldRefresh =
          status.expiringSoon ||
          (status.remainingMs !== undefined &&
            status.remainingMs < this.config.leadTimeMs);
        if (shouldRefresh && !this.refreshing.has(provider.id)) {
          this.refresh(provider);
        }
      } catch (e: any) {
        console.error(
          `[Refresher] 检查 ${provider.name} 过期状态失败:`,
          e.message,
        );
      }
    }
  }

  private async refresh(provider: any): Promise<void> {
    if (this.refreshing.has(provider.id)) return;
    this.refreshing.add(provider.id);

    this.notify(
      provider.id,
      `${provider.name} 凭证即将过期，正在自动刷新...`,
      "info",
    );
    console.log(`[Refresher] 正在自动刷新 ${provider.name} 凭证...`);

    try {
      await provider.captureCredentials((msg: string) => {
        console.log(`[Refresher] [${provider.name}] ${msg}`);
      });
      this.notify(provider.id, `${provider.name} 凭证已自动刷新`, "info");
      console.log(`[Refresher] ${provider.name} 凭证刷新成功`);
    } catch (e: any) {
      this.notify(
        provider.id,
        `${provider.name} 凭证自动刷新失败: ${e.message}`,
        "err",
      );
      console.error(
        `[Refresher] ${provider.name} 凭证刷新失败:`,
        e.message,
      );
    } finally {
      this.refreshing.delete(provider.id);
    }
  }
}

export const credentialRefresher = new CredentialRefresher();
