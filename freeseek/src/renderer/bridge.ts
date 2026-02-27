/**
 * 前端通信桥接层
 * Electron 模式: 使用 window.freeseek (preload IPC)
 * Web 模式: 使用 HTTP API 调用管理面板后端
 */

const isElectron = !!(window as any).freeseek;

function apiBase(): string {
  return window.location.origin;
}

async function apiGet(path: string) {
  const res = await fetch(`${apiBase()}${path}`);
  return res.json();
}

async function apiPost(path: string, body?: any) {
  const res = await fetch(`${apiBase()}${path}`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: body !== undefined ? JSON.stringify(body) : undefined,
  });
  return res.json();
}

async function apiDelete(path: string) {
  const res = await fetch(`${apiBase()}${path}`, { method: "DELETE" });
  return res.json();
}

// 日志轮询（Web 模式替代 IPC 推送）
type LogCallback = (log: any) => void;
let logPollingTimer: ReturnType<typeof setInterval> | null = null;
let logCallbacks: LogCallback[] = [];
let lastLogCount = 0;

function startLogPolling() {
  if (logPollingTimer) return;
  logPollingTimer = setInterval(async () => {
    if (logCallbacks.length === 0) return;
    try {
      const logs = await apiGet("/api/logs");
      if (Array.isArray(logs) && logs.length > lastLogCount) {
        const newLogs = logs.slice(lastLogCount);
        lastLogCount = logs.length;
        for (const log of newLogs) {
          for (const cb of logCallbacks) cb(log);
        }
      }
    } catch { /* ignore */ }
  }, 2000);
}

/** 统一 API 接口，Electron 和 Web 模式通用 */
export const bridge = {
  // 服务控制
  startServer: async (port: number) => {
    if (isElectron) return (window as any).freeseek.startServer(port);
    return { ok: true, port };
  },
  stopServer: async () => {
    if (isElectron) return (window as any).freeseek.stopServer();
    return { ok: false, error: "Web 模式下不支持停止服务" };
  },
  getServerStatus: async () => {
    if (isElectron) return (window as any).freeseek.getServerStatus();
    return apiGet("/api/server/status");
  },
  getStats: async () => {
    if (isElectron) return (window as any).freeseek.getStats();
    return apiGet("/api/server/stats");
  },
  resetSessions: async () => {
    if (isElectron) return (window as any).freeseek.resetSessions();
    return apiPost("/api/server/resetSessions");
  },

  // DeepSeek 凭证
  startAuth: async () => {
    if (isElectron) return (window as any).freeseek.startAuth();
    return apiPost("/api/auth/start");
  },
  getCredentials: async () => {
    if (isElectron) return (window as any).freeseek.getCredentials();
    return apiGet("/api/auth/get");
  },
  clearCredentials: async () => {
    if (isElectron) return (window as any).freeseek.clearCredentials();
    return apiPost("/api/auth/clear");
  },
  checkCredentialExpiry: async () => {
    if (isElectron) return (window as any).freeseek.checkCredentialExpiry();
    return apiPost("/api/auth/checkExpiry");
  },
  saveManualCredentials: async (creds: { cookie: string; bearer: string; userAgent: string }) => {
    if (isElectron) return (window as any).freeseek.saveManualCredentials(creds);
    return apiPost("/api/auth/saveManual", creds);
  },

  // Claude 凭证
  startClaudeAuth: async () => {
    if (isElectron) return (window as any).freeseek.startClaudeAuth();
    return apiPost("/api/claude/start");
  },
  getClaudeCredentials: async () => {
    if (isElectron) return (window as any).freeseek.getClaudeCredentials();
    return apiGet("/api/claude/get");
  },
  clearClaudeCredentials: async () => {
    if (isElectron) return (window as any).freeseek.clearClaudeCredentials();
    return apiPost("/api/claude/clear");
  },
  saveClaudeManualCredentials: async (creds: { sessionKey: string; cookie?: string; userAgent?: string }) => {
    if (isElectron) return (window as any).freeseek.saveClaudeManualCredentials(creds);
    return apiPost("/api/claude/saveManual", creds);
  },

  // 通义千问凭证
  startQwenAuth: async () => {
    if (isElectron) return (window as any).freeseek.startQwenAuth();
    return apiPost("/api/qwen/start");
  },
  getQwenCredentials: async () => {
    if (isElectron) return (window as any).freeseek.getQwenCredentials();
    return apiGet("/api/qwen/get");
  },
  clearQwenCredentials: async () => {
    if (isElectron) return (window as any).freeseek.clearQwenCredentials();
    return apiPost("/api/qwen/clear");
  },
  checkQwenExpiry: async () => {
    if (isElectron) return (window as any).freeseek.checkQwenExpiry();
    return apiPost("/api/qwen/checkExpiry");
  },
  saveQwenManualCredentials: async (creds: { cookie: string; token?: string; bxUa?: string; bxUmidtoken?: string; userAgent?: string }) => {
    if (isElectron) return (window as any).freeseek.saveQwenManualCredentials(creds);
    return apiPost("/api/qwen/saveManual", creds);
  },

  // 通用凭证池管理
  listCredentials: async (providerId: string) => {
    if (isElectron) return (window as any).freeseek.listCredentials(providerId);
    return apiGet(`/api/credentials/${providerId}`);
  },
  addCredential: async (providerId: string, data: Record<string, any>) => {
    if (isElectron) return (window as any).freeseek.addCredential(providerId, data);
    return apiPost(`/api/credentials/${providerId}/add`, data);
  },
  removeCredential: async (providerId: string, credentialId: string) => {
    if (isElectron) return (window as any).freeseek.removeCredential(providerId, credentialId);
    return apiDelete(`/api/credentials/${providerId}/${credentialId}`);
  },
  resetCredential: async (providerId: string, credentialId: string) => {
    if (isElectron) return (window as any).freeseek.resetCredential(providerId, credentialId);
    return apiPost(`/api/credentials/${providerId}/${credentialId}/reset`);
  },
  reorderCredentials: async (providerId: string, ids: string[]) => {
    if (isElectron) return (window as any).freeseek.reorderCredentials(providerId, ids);
    return apiPost(`/api/credentials/${providerId}/reorder`, { ids });
  },
  setCredentialStrategy: async (providerId: string, strategy: string) => {
    if (isElectron) return (window as any).freeseek.setCredentialStrategy(providerId, strategy);
    return apiPost(`/api/credentials/${providerId}/strategy`, { strategy });
  },

  // 请求队列
  getQueueStatus: async () => {
    if (isElectron) return (window as any).freeseek.getQueueStatus();
    return apiGet("/api/queue/status");
  },

  // 凭证刷新器
  getRefresherStatus: async () => {
    if (isElectron) return (window as any).freeseek.getRefresherStatus();
    return apiGet("/api/refresher/status");
  },

  // 代理
  getProxy: async () => {
    if (isElectron) return (window as any).freeseek.getProxy();
    return apiGet("/api/proxy/get");
  },
  saveProxy: async (proxy: string) => {
    if (isElectron) return (window as any).freeseek.saveProxy(proxy);
    return apiPost("/api/proxy/save", { proxy });
  },

  // 设置
  getSettings: async () => {
    if (isElectron) return (window as any).freeseek.getSettings();
    return apiGet("/api/settings/get");
  },
  saveSettings: async (data: {
    apiKey?: string;
    host?: string;
    rateLimits?: Record<string, number>;
    autoRefresh?: { enabled?: boolean; leadTimeMinutes?: number; checkIntervalSeconds?: number };
  }) => {
    if (isElectron) return (window as any).freeseek.saveSettings(data);
    return apiPost("/api/settings/save", data);
  },

  // 日志监听
  onLog: (callback: LogCallback) => {
    if (isElectron) return (window as any).freeseek.onLog(callback);
    logCallbacks.push(callback);
    startLogPolling();
    return () => {
      logCallbacks = logCallbacks.filter(cb => cb !== callback);
    };
  },

  // Auth 状态
  onAuthStatus: (callback: (msg: string) => void) => {
    if (isElectron) return (window as any).freeseek.onAuthStatus(callback);
    return () => {};
  },
  onClaudeStatus: (callback: (msg: string) => void) => {
    if (isElectron) return (window as any).freeseek.onClaudeStatus(callback);
    return () => {};
  },
  onQwenStatus: (callback: (msg: string) => void) => {
    if (isElectron) return (window as any).freeseek.onQwenStatus(callback);
    return () => {};
  },

  // 模式检测
  isElectron,
  isWeb: !isElectron,
};
