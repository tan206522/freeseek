import { contextBridge, ipcRenderer } from "electron";

contextBridge.exposeInMainWorld("freeseek", {
  // 服务控制
  startServer: (port: number) => ipcRenderer.invoke("server:start", port),
  stopServer: () => ipcRenderer.invoke("server:stop"),
  getServerStatus: () => ipcRenderer.invoke("server:status"),
  getStats: () => ipcRenderer.invoke("server:stats"),
  resetSessions: () => ipcRenderer.invoke("server:resetSessions"),

  // DeepSeek 凭证管理
  startAuth: () => ipcRenderer.invoke("auth:start"),
  getCredentials: () => ipcRenderer.invoke("auth:get"),
  clearCredentials: () => ipcRenderer.invoke("auth:clear"),
  checkCredentialExpiry: () => ipcRenderer.invoke("auth:checkExpiry"),
  saveManualCredentials: (creds: {
    cookie: string;
    bearer: string;
    userAgent: string;
  }) => ipcRenderer.invoke("auth:saveManual", creds),

  // Claude 凭证管理
  startClaudeAuth: () => ipcRenderer.invoke("claude:start"),
  getClaudeCredentials: () => ipcRenderer.invoke("claude:get"),
  clearClaudeCredentials: () => ipcRenderer.invoke("claude:clear"),
  saveClaudeManualCredentials: (creds: {
    sessionKey: string;
    cookie?: string;
    userAgent?: string;
  }) => ipcRenderer.invoke("claude:saveManual", creds),

  // 通义千问凭证管理
  startQwenAuth: () => ipcRenderer.invoke("qwen:start"),
  getQwenCredentials: () => ipcRenderer.invoke("qwen:get"),
  clearQwenCredentials: () => ipcRenderer.invoke("qwen:clear"),
  checkQwenExpiry: () => ipcRenderer.invoke("qwen:checkExpiry"),
  saveQwenManualCredentials: (creds: {
    cookie: string;
    token?: string;
    bxUa?: string;
    bxUmidtoken?: string;
    userAgent?: string;
  }) => ipcRenderer.invoke("qwen:saveManual", creds),

  // 通用凭证池管理
  listCredentials: (providerId: string) =>
    ipcRenderer.invoke("credentials:list", providerId),
  addCredential: (providerId: string, data: Record<string, any>) =>
    ipcRenderer.invoke("credentials:add", providerId, data),
  removeCredential: (providerId: string, credentialId: string) =>
    ipcRenderer.invoke("credentials:remove", providerId, credentialId),
  resetCredential: (providerId: string, credentialId: string) =>
    ipcRenderer.invoke("credentials:reset", providerId, credentialId),
  reorderCredentials: (providerId: string, ids: string[]) =>
    ipcRenderer.invoke("credentials:reorder", providerId, ids),
  setCredentialStrategy: (providerId: string, strategy: string) =>
    ipcRenderer.invoke("credentials:strategy", providerId, strategy),

  // 请求队列
  getQueueStatus: () => ipcRenderer.invoke("queue:status"),

  // 凭证刷新器
  getRefresherStatus: () => ipcRenderer.invoke("refresher:status"),

  // 日志监听
  onLog: (callback: (log: any) => void) => {
    const handler = (_event: any, log: any) => callback(log);
    ipcRenderer.on("log", handler);
    return () => ipcRenderer.removeListener("log", handler);
  },

  // DeepSeek 凭证捕获状态
  onAuthStatus: (callback: (msg: string) => void) => {
    const handler = (_event: any, msg: string) => callback(msg);
    ipcRenderer.on("auth:status", handler);
    return () => ipcRenderer.removeListener("auth:status", handler);
  },

  // Claude 凭证捕获状态
  onClaudeStatus: (callback: (msg: string) => void) => {
    const handler = (_event: any, msg: string) => callback(msg);
    ipcRenderer.on("claude:status", handler);
    return () => ipcRenderer.removeListener("claude:status", handler);
  },

  // 通义千问凭证捕获状态
  onQwenStatus: (callback: (msg: string) => void) => {
    const handler = (_event: any, msg: string) => callback(msg);
    ipcRenderer.on("qwen:status", handler);
    return () => ipcRenderer.removeListener("qwen:status", handler);
  },

  // 代理配置
  getProxy: () => ipcRenderer.invoke("proxy:get"),
  saveProxy: (proxy: string) => ipcRenderer.invoke("proxy:save", proxy),

  // 设置
  getSettings: () => ipcRenderer.invoke("settings:get"),
  saveSettings: (data: {
    apiKey?: string;
    host?: string;
    rateLimits?: Record<string, number>;
    autoRefresh?: { enabled?: boolean; leadTimeMinutes?: number; checkIntervalSeconds?: number };
  }) => ipcRenderer.invoke("settings:save", data),
});
