import { app, BrowserWindow, ipcMain, Tray, Menu, nativeImage } from "electron";
import path from "node:path";
import fs from "node:fs";
import { startServer, getStats, type ServerLog } from "./server";
import { registry } from "./providers";
import { loadSettings, saveSettings, getHost } from "./settings";
import { requestQueue } from "./request-queue";
import { credentialRefresher } from "./credential-refresher";

let mainWindow: BrowserWindow | null = null;
let tray: Tray | null = null;
let serverInstance: ReturnType<typeof startServer> | null = null;
let serverPort = 3000;
let serverRunning = false;
let serverStartedAt: number | null = null;

function createTray() {
  const icon = nativeImage.createFromDataURL(
    "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAABAAAAAQCAYAAAAf8/9hAAAARklEQVQ4T2NkYPj/n4EBCxg1gIEBl2YGBgYGRkYGBgYmJiYGBgYGBmZmZgYGBgYGFhYWBgYGBgZWVlYGBgYGBjY2NgYAAABfCA0RVgoyAAAAAElFTkSuQmCC"
  );
  tray = new Tray(icon);
  tray.setToolTip("FreeSeek - DeepSeek 反向代理");

  const contextMenu = Menu.buildFromTemplate([
    { label: "显示窗口", click: () => { mainWindow?.show(); mainWindow?.focus(); } },
    { type: "separator" },
    { label: "退出", click: () => { app.quit(); } },
  ]);
  tray.setContextMenu(contextMenu);
  tray.on("double-click", () => { mainWindow?.show(); mainWindow?.focus(); });
}

function createWindow() {
  mainWindow = new BrowserWindow({
    width: 1200,
    height: 800,
    minWidth: 900,
    minHeight: 600,
    title: "FreeSeek",
    backgroundColor: "#f5f5f5",
    webPreferences: {
      preload: path.join(__dirname, "preload.js"),
      contextIsolation: true,
      nodeIntegration: false,
    },
  });

  const htmlPath = path.join(__dirname, "..", "renderer", "index.html");
  mainWindow.loadFile(htmlPath);

  mainWindow.on("close", (e) => {
    if (!isQuitting) {
      e.preventDefault();
      mainWindow?.hide();
    }
  });

  mainWindow.on("closed", () => {
    mainWindow = null;
  });
}

let isQuitting = false;
app.on("before-quit", () => { isQuitting = true; });

function sendLog(log: ServerLog) {
  mainWindow?.webContents.send("log", log);
}

// ========== IPC Handlers ==========

// 服务控制
ipcMain.handle("server:start", async (_event, port: number) => {
  if (serverRunning) return { ok: true, port: serverPort };
  try {
    serverPort = port || 3000;
    const host = getHost();
    serverInstance = startServer(serverPort, sendLog, host);
    serverRunning = true;
    serverStartedAt = Date.now();
    return { ok: true, port: serverPort };
  } catch (err: any) {
    return { ok: false, error: err.message };
  }
});

ipcMain.handle("server:stop", async () => {
  if (serverInstance) {
    serverInstance.close();
    serverInstance = null;
    serverRunning = false;
    serverStartedAt = null;
  }
  return { ok: true };
});

ipcMain.handle("server:status", async () => {
  const deepseek = registry.get("deepseek");
  const creds = deepseek?.loadCredentials();
  return {
    running: serverRunning,
    port: serverPort,
    hasCredentials: !!creds,
    capturedAt: creds?.capturedAt ?? null,
    uptime: serverRunning && serverStartedAt ? Date.now() - serverStartedAt : 0,
  };
});

ipcMain.handle("server:stats", async () => {
  return getStats();
});

ipcMain.handle("server:resetSessions", async () => {
  registry.resetAll();
  return { ok: true };
});

// --- DeepSeek 凭证（通过 registry） ---
ipcMain.handle("auth:start", async () => {
  try {
    const provider = registry.get("deepseek");
    if (!provider) return { ok: false, error: "DeepSeek provider not found" };
    const creds = await provider.captureCredentials((msg) => {
      mainWindow?.webContents.send("auth:status", msg);
    });
    return { ok: true, capturedAt: creds.capturedAt };
  } catch (err: any) {
    return { ok: false, error: err.message };
  }
});

ipcMain.handle("auth:get", async () => {
  const provider = registry.get("deepseek");
  return provider?.getCredentialsSummary() || null;
});

ipcMain.handle("auth:clear", async () => {
  const provider = registry.get("deepseek");
  return { ok: provider?.clearCredentials() ?? false };
});

ipcMain.handle("auth:checkExpiry", async () => {
  const provider = registry.get("deepseek");
  if (!provider?.checkExpiry) return { valid: false, reason: "no_credentials" };
  return provider.checkExpiry();
});

ipcMain.handle(
  "auth:saveManual",
  async (_event, data: { cookie: string; bearer: string; userAgent: string }) => {
    try {
      const provider = registry.get("deepseek");
      provider?.saveManualCredentials(data);
      return { ok: true };
    } catch (err: any) {
      return { ok: false, error: err.message };
    }
  },
);

// --- Claude 凭证（通过 registry） ---
ipcMain.handle("claude:start", async () => {
  try {
    const provider = registry.get("claude");
    if (!provider) return { ok: false, error: "Claude provider not found" };
    const creds = await provider.captureCredentials((msg) => {
      mainWindow?.webContents.send("claude:status", msg);
    });
    return { ok: true, capturedAt: creds.capturedAt };
  } catch (err: any) {
    return { ok: false, error: err.message };
  }
});

ipcMain.handle("claude:get", async () => {
  const provider = registry.get("claude");
  return provider?.getCredentialsSummary() || null;
});

ipcMain.handle("claude:clear", async () => {
  const provider = registry.get("claude");
  return { ok: provider?.clearCredentials() ?? false };
});

ipcMain.handle("claude:saveManual", async (
  _event,
  data: { sessionKey: string; cookie?: string; userAgent?: string },
) => {
  try {
    const provider = registry.get("claude");
    provider?.saveManualCredentials(data);
    return { ok: true };
  } catch (err: any) {
    return { ok: false, error: err.message };
  }
});

// --- 通义千问凭证（通过 registry） ---
ipcMain.handle("qwen:start", async () => {
  try {
    const provider = registry.get("qwen");
    if (!provider) return { ok: false, error: "Qwen provider not found" };
    const creds = await provider.captureCredentials((msg) => {
      mainWindow?.webContents.send("qwen:status", msg);
    });
    return { ok: true, capturedAt: creds.capturedAt };
  } catch (err: any) {
    return { ok: false, error: err.message };
  }
});

ipcMain.handle("qwen:get", async () => {
  const provider = registry.get("qwen");
  return provider?.getCredentialsSummary() || null;
});

ipcMain.handle("qwen:clear", async () => {
  const provider = registry.get("qwen");
  return { ok: provider?.clearCredentials() ?? false };
});

ipcMain.handle("qwen:checkExpiry", async () => {
  const provider = registry.get("qwen");
  if (!provider?.checkExpiry) return { valid: false, reason: "no_credentials" };
  return provider.checkExpiry();
});

ipcMain.handle("qwen:saveManual", async (
  _event,
  data: { cookie: string; token?: string; bxUa?: string; bxUmidtoken?: string; userAgent?: string },
) => {
  try {
    const provider = registry.get("qwen");
    provider?.saveManualCredentials(data);
    return { ok: true };
  } catch (err: any) {
    return { ok: false, error: err.message };
  }
});

// --- 通用凭证池管理 ---
ipcMain.handle("credentials:list", async (_event, providerId: string) => {
  const provider = registry.get(providerId);
  if (!provider) return { entries: [] };
  const pool = provider.getCredentialPool?.();
  if (!pool) return { entries: [] };
  return { entries: pool.getAll(), strategy: pool.getStrategy() };
});

ipcMain.handle("credentials:add", async (_event, providerId: string, data: Record<string, any>) => {
  const provider = registry.get(providerId);
  if (!provider?.addCredentials) return { ok: false, error: "Not supported" };
  try {
    const id = provider.addCredentials(data);
    return { ok: true, id };
  } catch (err: any) {
    return { ok: false, error: err.message };
  }
});

ipcMain.handle("credentials:remove", async (_event, providerId: string, credentialId: string) => {
  const provider = registry.get(providerId);
  if (!provider?.removeCredentials) return { ok: false };
  return { ok: provider.removeCredentials(credentialId) };
});

ipcMain.handle("credentials:reset", async (_event, providerId: string, credentialId: string) => {
  const provider = registry.get(providerId);
  provider?.resetCredentialStatus?.(credentialId);
  return { ok: true };
});

ipcMain.handle("credentials:reorder", async (_event, providerId: string, ids: string[]) => {
  const provider = registry.get(providerId);
  provider?.getCredentialPool?.()?.reorder(ids);
  return { ok: true };
});

ipcMain.handle("credentials:strategy", async (_event, providerId: string, strategy: string) => {
  const provider = registry.get(providerId);
  provider?.getCredentialPool?.()?.setStrategy(strategy as any);
  return { ok: true };
});

// --- 请求队列状态 ---
ipcMain.handle("queue:status", async () => {
  return requestQueue.getStatus();
});

// --- 凭证刷新器 ---
ipcMain.handle("refresher:status", async () => {
  return {
    running: credentialRefresher.isRunning(),
    config: credentialRefresher.getConfig(),
  };
});

// ========== 代理配置 ==========

ipcMain.handle("proxy:get", async () => {
  try {
    const configFile = path.join(__dirname, "..", "..", "data", "proxy.json");
    if (fs.existsSync(configFile)) {
      return JSON.parse(fs.readFileSync(configFile, "utf-8"));
    }
  } catch { /* ignore */ }
  return { proxy: "" };
});

ipcMain.handle("proxy:save", async (_event, proxy: string) => {
  try {
    const authDir = path.join(__dirname, "..", "..", "data");
    fs.mkdirSync(authDir, { recursive: true });
    fs.writeFileSync(
      path.join(authDir, "proxy.json"),
      JSON.stringify({ proxy: proxy.trim() }, null, 2),
    );
    return { ok: true };
  } catch (err: any) {
    return { ok: false, error: err.message };
  }
});

// ========== 设置 ==========

ipcMain.handle("settings:get", async () => {
  return loadSettings();
});

ipcMain.handle("settings:save", async (_event, data: {
  apiKey?: string;
  host?: string;
  rateLimits?: Record<string, number>;
  autoRefresh?: { enabled?: boolean; leadTimeMinutes?: number; checkIntervalSeconds?: number };
}) => {
  try {
    const updates: Record<string, any> = {};
    if (data.apiKey !== undefined) updates.apiKey = data.apiKey.trim();
    if (data.host !== undefined) updates.host = data.host === "0.0.0.0" ? "0.0.0.0" : "127.0.0.1";
    if (data.rateLimits !== undefined) {
      updates.rateLimits = data.rateLimits;
      for (const [pid, max] of Object.entries(data.rateLimits)) {
        requestQueue.setConfig(pid, { maxPerMinute: max });
      }
    }
    if (data.autoRefresh !== undefined) {
      updates.autoRefresh = data.autoRefresh;
      credentialRefresher.updateConfig({
        enabled: data.autoRefresh.enabled,
        leadTimeMs: (data.autoRefresh.leadTimeMinutes || 10) * 60 * 1000,
        checkIntervalMs: (data.autoRefresh.checkIntervalSeconds || 60) * 1000,
      });
    }
    saveSettings(updates);
    return { ok: true, needRestart: data.apiKey !== undefined || data.host !== undefined };
  } catch (err: any) {
    return { ok: false, error: err.message };
  }
});

// ========== App Lifecycle ==========

app.whenReady().then(() => {
  const menuTemplate: Electron.MenuItemConstructorOptions[] = [
    {
      label: "文件",
      submenu: [
        { label: "退出", accelerator: "CmdOrCtrl+Q", role: "quit" },
      ],
    },
    {
      label: "编辑",
      submenu: [
        { label: "撤销", accelerator: "CmdOrCtrl+Z", role: "undo" },
        { label: "重做", accelerator: "Shift+CmdOrCtrl+Z", role: "redo" },
        { type: "separator" },
        { label: "剪切", accelerator: "CmdOrCtrl+X", role: "cut" },
        { label: "复制", accelerator: "CmdOrCtrl+C", role: "copy" },
        { label: "粘贴", accelerator: "CmdOrCtrl+V", role: "paste" },
        { label: "全选", accelerator: "CmdOrCtrl+A", role: "selectAll" },
      ],
    },
    {
      label: "视图",
      submenu: [
        { label: "重新加载", accelerator: "CmdOrCtrl+R", role: "reload" },
        { label: "强制重新加载", accelerator: "CmdOrCtrl+Shift+R", role: "forceReload" },
        { label: "开发者工具", accelerator: "F12", role: "toggleDevTools" },
        { type: "separator" },
        { label: "实际大小", accelerator: "CmdOrCtrl+0", role: "resetZoom" },
        { label: "放大", accelerator: "CmdOrCtrl+=", role: "zoomIn" },
        { label: "缩小", accelerator: "CmdOrCtrl+-", role: "zoomOut" },
        { type: "separator" },
        { label: "全屏", accelerator: "F11", role: "togglefullscreen" },
      ],
    },
    {
      label: "窗口",
      submenu: [
        { label: "最小化", accelerator: "CmdOrCtrl+M", role: "minimize" },
        { label: "关闭", accelerator: "CmdOrCtrl+W", role: "close" },
      ],
    },
    {
      label: "帮助",
      submenu: [
        { label: "关于 FreeSeek", click: () => { mainWindow?.webContents.send("menu:about"); } },
      ],
    },
  ];
  Menu.setApplicationMenu(Menu.buildFromTemplate(menuTemplate));

  createTray();
  createWindow();

  // 初始化限速配置
  const settings = loadSettings();
  if (settings.rateLimits) {
    for (const [pid, max] of Object.entries(settings.rateLimits)) {
      requestQueue.setConfig(pid, { maxPerMinute: max });
    }
  }

  // 启动凭证自动刷新
  credentialRefresher.setNotify((providerId, message, level) => {
    sendLog({
      time: new Date().toLocaleTimeString("zh-CN", { hour12: false }),
      level: level === "info" ? "info" : level === "warn" ? "warn" : "err",
      msg: `[AutoRefresh] ${message}`,
    });
  });
  credentialRefresher.start({
    enabled: settings.autoRefresh?.enabled ?? true,
    leadTimeMs: (settings.autoRefresh?.leadTimeMinutes ?? 10) * 60 * 1000,
    checkIntervalMs: (settings.autoRefresh?.checkIntervalSeconds ?? 60) * 1000,
  });

  // 自动启动服务（如果有任何凭证）
  const hasAnyCreds = registry.all().some((p) => p.loadCredentials());
  if (hasAnyCreds) {
    const host = getHost();
    serverInstance = startServer(serverPort, sendLog, host);
    serverRunning = true;
    serverStartedAt = Date.now();
  }
});

app.on("window-all-closed", () => {
  // macOS 上不退出，其他平台也不退出（托盘模式）
});

app.on("activate", () => {
  if (!mainWindow) {
    createWindow();
  } else {
    mainWindow.show();
    mainWindow.focus();
  }
});
