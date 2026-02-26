/**
 * 前端通信桥接层
 * Electron 模式: 使用 window.freeseek (preload IPC)
 * Web 模式: 使用 HTTP API 调用管理面板后端
 */

const isElectron = !!(window as any).freeseek;

// Web 模式下管理面板 API 基地址（同源）
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
    // Web 模式下服务已经在运行
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

  // 代理
  getProxy: async () => {
    if (isElectron) return (window as any).freeseek.getProxy();
    return apiGet("/api/proxy/get");
  },
  saveProxy: async (proxy: string) => {
    if (isElectron) return (window as any).freeseek.saveProxy(proxy);
    return apiPost("/api/proxy/save", { proxy });
  },

  // 日志监听
  onLog: (callback: LogCallback) => {
    if (isElectron) return (window as any).freeseek.onLog(callback);
    // Web 模式：轮询
    logCallbacks.push(callback);
    startLogPolling();
    return () => {
      logCallbacks = logCallbacks.filter(cb => cb !== callback);
    };
  },

  // Auth 状态（Web 模式下不支持实时推送，返回空 cleanup）
  onAuthStatus: (callback: (msg: string) => void) => {
    if (isElectron) return (window as any).freeseek.onAuthStatus(callback);
    return () => {};
  },
  onClaudeStatus: (callback: (msg: string) => void) => {
    if (isElectron) return (window as any).freeseek.onClaudeStatus(callback);
    return () => {};
  },

  // 模式检测
  isElectron,
  isWeb: !isElectron,
};
