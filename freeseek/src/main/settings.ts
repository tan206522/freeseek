import fs from "node:fs";
import path from "node:path";

export interface RateLimitConfig {
  [providerId: string]: number;
}

export interface AutoRefreshConfig {
  enabled: boolean;
  leadTimeMinutes: number;
  checkIntervalSeconds: number;
}

export interface AppSettings {
  apiKey: string;
  host: "127.0.0.1" | "0.0.0.0";
  /** 每个 Provider 每分钟最大请求数，0 表示不限制 */
  rateLimits: RateLimitConfig;
  /** 凭证自动刷新配置 */
  autoRefresh: AutoRefreshConfig;
}

const SETTINGS_FILE = path.join(__dirname, "..", "..", "data", "settings.json");

const defaults: AppSettings = {
  apiKey: "",
  host: "127.0.0.1",
  rateLimits: {},
  autoRefresh: {
    enabled: true,
    leadTimeMinutes: 10,
    checkIntervalSeconds: 60,
  },
};

export function loadSettings(): AppSettings {
  try {
    if (fs.existsSync(SETTINGS_FILE)) {
      const raw = JSON.parse(fs.readFileSync(SETTINGS_FILE, "utf-8"));
      return {
        ...defaults,
        ...raw,
        autoRefresh: { ...defaults.autoRefresh, ...raw.autoRefresh },
      };
    }
  } catch {
    /* ignore */
  }
  return { ...defaults, autoRefresh: { ...defaults.autoRefresh } };
}

export function saveSettings(settings: Partial<AppSettings>): void {
  const current = loadSettings();
  const merged = { ...current, ...settings };
  if (settings.autoRefresh) {
    merged.autoRefresh = { ...current.autoRefresh, ...settings.autoRefresh };
  }
  fs.mkdirSync(path.dirname(SETTINGS_FILE), { recursive: true });
  fs.writeFileSync(SETTINGS_FILE, JSON.stringify(merged, null, 2));
}

export function getApiKey(): string {
  return loadSettings().apiKey;
}

export function getHost(): "127.0.0.1" | "0.0.0.0" {
  return loadSettings().host;
}
