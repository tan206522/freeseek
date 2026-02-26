import { app, BrowserWindow, ipcMain, Tray, Menu, nativeImage } from "electron";
import path from "node:path";
import fs from "node:fs";
import {
  captureCredentials,
  loadCredentials,
  clearCredentials,
} from "./auth";
import {
  captureClaudeCredentials,
  loadClaudeCredentials,
  clearClaudeCredentials,
} from "./claude-auth";
import { startServer, getStats, resetClaudeClient, type ServerLog } from "./server";

let mainWindow: BrowserWindow | null = null;
let tray: Tray | null = null;
let serverInstance: ReturnType<typeof startServer> | null = null;
let serverPort = 3000;
let serverRunning = false;
let serverStartedAt: number | null = null;

function createTray() {
  // 创建一个简单的 16x16 托盘图标
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

  // 加载 renderer HTML
  const htmlPath = path.join(__dirname, "..", "renderer", "index.html");
  mainWindow.loadFile(htmlPath);

  // 关闭窗口时最小化到托盘而不是退出
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

// 标记是否真正退出
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
    serverInstance = startServer(serverPort, sendLog);
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
  const creds = loadCredentials();
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

// 凭证管理
ipcMain.handle("auth:start", async () => {
  try {
    const creds = await captureCredentials((msg) => {
      mainWindow?.webContents.send("auth:status", msg);
    });
    return { ok: true, capturedAt: creds.capturedAt };
  } catch (err: any) {
    return { ok: false, error: err.message };
  }
});

ipcMain.handle("auth:get", async () => {
  const creds = loadCredentials();
  if (!creds) return null;
  return {
    hasCookie: !!creds.cookie,
    cookieCount: creds.cookie.split(";").length,
    hasBearer: !!creds.bearer,
    bearerLength: creds.bearer.length,
    capturedAt: creds.capturedAt,
    hasSessionId:
      creds.cookie.includes("ds_session_id=") ||
      creds.cookie.includes("d_id="),
  };
});

ipcMain.handle("auth:clear", async () => {
  return { ok: clearCredentials() };
});

// 凭证过期检测（解析 JWT exp）
ipcMain.handle("auth:checkExpiry", async () => {
  const creds = loadCredentials();
  if (!creds?.bearer) return { valid: false, reason: "no_credentials" };
  try {
    const parts = creds.bearer.split(".");
    if (parts.length !== 3) return { valid: true, expiresAt: null };
    const payload = JSON.parse(Buffer.from(parts[1], "base64url").toString());
    if (payload.exp) {
      const expiresAt = payload.exp * 1000;
      const now = Date.now();
      const remaining = expiresAt - now;
      return {
        valid: remaining > 0,
        expiresAt: new Date(expiresAt).toISOString(),
        remainingMs: remaining,
        expired: remaining <= 0,
        expiringSoon: remaining > 0 && remaining < 30 * 60 * 1000, // 30 分钟内过期
      };
    }
    return { valid: true, expiresAt: null };
  } catch {
    return { valid: true, expiresAt: null };
  }
});

// 重置会话缓存（当会话失效时调用）
ipcMain.handle("server:resetSessions", async () => {
  const { resetSessions } = await import("./server");
  resetSessions();
  return { ok: true };
});

ipcMain.handle(
  "auth:saveManual",
  async (
    _event,
    data: { cookie: string; bearer: string; userAgent: string },
  ) => {
    try {
      const authDir = path.join(__dirname, "..", "..", "data");
      fs.mkdirSync(authDir, { recursive: true });
      const creds = {
        ...data,
        userAgent:
          data.userAgent ||
          "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36",
        capturedAt: new Date().toISOString(),
      };
      fs.writeFileSync(
        path.join(authDir, "auth.json"),
        JSON.stringify(creds, null, 2),
      );
      return { ok: true };
    } catch (err: any) {
      return { ok: false, error: err.message };
    }
  },
);

// ========== Claude IPC Handlers ==========

ipcMain.handle("claude:start", async () => {
  try {
    const creds = await captureClaudeCredentials((msg) => {
      mainWindow?.webContents.send("claude:status", msg);
    });
    resetClaudeClient();
    return { ok: true, capturedAt: creds.capturedAt };
  } catch (err: any) {
    return { ok: false, error: err.message };
  }
});

ipcMain.handle("claude:get", async () => {
  const creds = loadClaudeCredentials();
  if (!creds) return null;
  return {
    hasSessionKey: !!creds.sessionKey,
    sessionKeyPrefix: creds.sessionKey?.slice(0, 20) + "...",
    hasCookie: !!creds.cookie,
    hasOrganizationId: !!creds.organizationId,
    capturedAt: creds.capturedAt,
  };
});

ipcMain.handle("claude:clear", async () => {
  resetClaudeClient();
  return { ok: clearClaudeCredentials() };
});

ipcMain.handle("claude:saveManual", async (
  _event,
  data: { sessionKey: string; cookie?: string; userAgent?: string },
) => {
  try {
    const authDir = path.join(__dirname, "..", "..", "data");
    fs.mkdirSync(authDir, { recursive: true });
    const creds = {
      sessionKey: data.sessionKey.trim(),
      cookie: data.cookie?.trim() || `sessionKey=${data.sessionKey.trim()}`,
      userAgent: data.userAgent?.trim() || "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36",
      capturedAt: new Date().toISOString(),
    };
    fs.writeFileSync(
      path.join(authDir, "claude-auth.json"),
      JSON.stringify(creds, null, 2),
    );
    resetClaudeClient();
    return { ok: true };
  } catch (err: any) {
    return { ok: false, error: err.message };
  }
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

// ========== App Lifecycle ==========

app.whenReady().then(() => {
  // 设置中文应用菜单
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

  // 自动启动服务（如果有凭证）
  const creds = loadCredentials();
  if (creds) {
    serverInstance = startServer(serverPort, sendLog);
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
