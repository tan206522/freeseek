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

  // 代理配置
  getProxy: () => ipcRenderer.invoke("proxy:get"),
  saveProxy: (proxy: string) => ipcRenderer.invoke("proxy:save", proxy),
});
