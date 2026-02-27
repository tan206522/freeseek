/**
 * FreeSeek 独立 Web 模式入口
 * 不依赖 Electron，纯 Node.js 运行
 * 用法: node dist/main/server-standalone.js [--port 3000] [--admin-port 3001] [--host 0.0.0.0]
 */
import express from "express";
import path from "node:path";
import fs from "node:fs";
import { getStats, resetSessions, startServer, type ServerLog } from "./server";
import { registry } from "./providers";
import { loadSettings, saveSettings } from "./settings";
import { requestQueue } from "./request-queue";
import { credentialRefresher } from "./credential-refresher";

const args = process.argv.slice(2);
function getArg(name: string, def: string): string {
  const idx = args.indexOf(name);
  return idx >= 0 && args[idx + 1] ? args[idx + 1] : def;
}

const settings = loadSettings();
const API_PORT = parseInt(getArg("--port", process.env.PORT || "3000"), 10);
const ADMIN_PORT = parseInt(getArg("--admin-port", process.env.ADMIN_PORT || "3001"), 10);
const API_HOST = getArg("--host", process.env.HOST || settings.host || "127.0.0.1");
const DATA_DIR = path.join(__dirname, "..", "..", "data");

// 初始化限速配置
if (settings.rateLimits) {
  for (const [pid, max] of Object.entries(settings.rateLimits)) {
    requestQueue.setConfig(pid, { maxPerMinute: max as number });
  }
}

// 启动凭证自动刷新
credentialRefresher.start({
  enabled: settings.autoRefresh?.enabled ?? true,
  leadTimeMs: (settings.autoRefresh?.leadTimeMinutes ?? 10) * 60 * 1000,
  checkIntervalMs: (settings.autoRefresh?.checkIntervalSeconds ?? 60) * 1000,
});

// 日志收集
const recentLogs: ServerLog[] = [];
function onLog(log: ServerLog) {
  recentLogs.push(log);
  if (recentLogs.length > 500) recentLogs.splice(0, recentLogs.length - 300);
  const prefix = log.level === "ok" ? "✅" : log.level === "warn" ? "⚠️" : log.level === "err" ? "❌" : "ℹ️";
  console.log(`[${log.time}] ${prefix} ${log.msg}`);
}

// 自动刷新通知接入日志
credentialRefresher.setNotify((providerId, message, level) => {
  onLog({
    time: new Date().toLocaleTimeString("zh-CN", { hour12: false }),
    level: level === "info" ? "info" : level === "warn" ? "warn" : "err",
    msg: `[AutoRefresh] ${message}`,
  });
});

// ========== 启动 API 代理服务 ==========
const apiServer = startServer(API_PORT, onLog, API_HOST);
const startedAt = Date.now();

// ========== 管理面板 HTTP API ==========
const admin = express();
admin.use(express.json());

// CORS
admin.use((_req, res, next) => {
  res.header("Access-Control-Allow-Origin", "*");
  res.header("Access-Control-Allow-Headers", "*");
  res.header("Access-Control-Allow-Methods", "GET, POST, DELETE, OPTIONS");
  if (_req.method === "OPTIONS") return res.sendStatus(200);
  next();
});

// 托管前端静态文件
const rendererDir = path.join(__dirname, "..", "renderer");
if (fs.existsSync(rendererDir)) {
  admin.use(express.static(rendererDir));
}

// --- 服务状态 ---
admin.get("/api/server/status", (_req, res) => {
  const deepseek = registry.get("deepseek");
  const creds = deepseek?.loadCredentials();
  res.json({
    running: true,
    port: API_PORT,
    hasCredentials: !!creds,
    capturedAt: creds?.capturedAt ?? null,
    uptime: Date.now() - startedAt,
  });
});

admin.get("/api/server/stats", (_req, res) => {
  res.json(getStats());
});

admin.post("/api/server/resetSessions", (_req, res) => {
  resetSessions();
  res.json({ ok: true });
});

// --- 通用 Provider API ---
admin.get("/api/providers", (_req, res) => {
  const providers = registry.all().map((p) => ({
    id: p.id,
    name: p.name,
    hasCredentials: !!p.loadCredentials(),
    models: p.getModels(),
    pool: p.getCredentialPool?.()?.getSummary() ?? null,
  }));
  res.json(providers);
});

// --- 通用多凭证管理 API ---
admin.get("/api/credentials/:providerId", (req, res) => {
  const provider = registry.get(req.params.providerId);
  if (!provider) return res.status(404).json({ error: "Provider not found" });
  const pool = provider.getCredentialPool?.();
  if (!pool) return res.json({ entries: [] });
  res.json({ entries: pool.getAll(), strategy: pool.getStrategy() });
});

admin.post("/api/credentials/:providerId/add", (req, res) => {
  const provider = registry.get(req.params.providerId);
  if (!provider) return res.status(404).json({ error: "Provider not found" });
  try {
    const id = provider.addCredentials?.(req.body);
    res.json({ ok: true, id });
  } catch (err: any) {
    res.json({ ok: false, error: err.message });
  }
});

admin.delete("/api/credentials/:providerId/:credentialId", (req, res) => {
  const provider = registry.get(req.params.providerId);
  if (!provider) return res.status(404).json({ error: "Provider not found" });
  const ok = provider.removeCredentials?.(req.params.credentialId) ?? false;
  res.json({ ok });
});

admin.post("/api/credentials/:providerId/:credentialId/reset", (req, res) => {
  const provider = registry.get(req.params.providerId);
  if (!provider) return res.status(404).json({ error: "Provider not found" });
  provider.resetCredentialStatus?.(req.params.credentialId);
  res.json({ ok: true });
});

admin.post("/api/credentials/:providerId/reorder", (req, res) => {
  const provider = registry.get(req.params.providerId);
  if (!provider) return res.status(404).json({ error: "Provider not found" });
  const pool = provider.getCredentialPool?.();
  if (pool && Array.isArray(req.body.ids)) {
    pool.reorder(req.body.ids);
  }
  res.json({ ok: true });
});

admin.post("/api/credentials/:providerId/strategy", (req, res) => {
  const provider = registry.get(req.params.providerId);
  if (!provider) return res.status(404).json({ error: "Provider not found" });
  const pool = provider.getCredentialPool?.();
  if (pool && req.body.strategy) {
    pool.setStrategy(req.body.strategy);
  }
  res.json({ ok: true });
});

// --- DeepSeek 凭证（保持向后兼容） ---
admin.get("/api/auth/get", (_req, res) => {
  const provider = registry.get("deepseek");
  const summary = provider?.getCredentialsSummary();
  res.json(summary || null);
});

admin.post("/api/auth/clear", (_req, res) => {
  const provider = registry.get("deepseek");
  res.json({ ok: provider?.clearCredentials() ?? false });
});

admin.post("/api/auth/checkExpiry", (_req, res) => {
  const provider = registry.get("deepseek");
  if (!provider?.checkExpiry) return res.json({ valid: false, reason: "no_credentials" });
  res.json(provider.checkExpiry());
});

admin.post("/api/auth/saveManual", (req, res) => {
  try {
    const provider = registry.get("deepseek");
    provider?.saveManualCredentials(req.body);
    res.json({ ok: true });
  } catch (err: any) {
    res.json({ ok: false, error: err.message });
  }
});

admin.post("/api/auth/start", async (_req, res) => {
  try {
    const provider = registry.get("deepseek");
    if (!provider) return res.json({ ok: false, error: "DeepSeek provider not found" });
    const creds = await provider.captureCredentials((msg) => {
      console.log(`[Auth] ${msg}`);
    });
    res.json({ ok: true, capturedAt: creds.capturedAt });
  } catch (err: any) {
    res.json({ ok: false, error: err.message });
  }
});

// --- Claude 凭证（保持向后兼容） ---
admin.get("/api/claude/get", (_req, res) => {
  const provider = registry.get("claude");
  const summary = provider?.getCredentialsSummary();
  res.json(summary || null);
});

admin.post("/api/claude/clear", (_req, res) => {
  const provider = registry.get("claude");
  res.json({ ok: provider?.clearCredentials() ?? false });
});

admin.post("/api/claude/saveManual", (req, res) => {
  try {
    const provider = registry.get("claude");
    provider?.saveManualCredentials(req.body);
    res.json({ ok: true });
  } catch (err: any) {
    res.json({ ok: false, error: err.message });
  }
});

admin.post("/api/claude/start", async (_req, res) => {
  try {
    const provider = registry.get("claude");
    if (!provider) return res.json({ ok: false, error: "Claude provider not found" });
    const creds = await provider.captureCredentials((msg) => {
      console.log(`[Claude Auth] ${msg}`);
    });
    res.json({ ok: true, capturedAt: creds.capturedAt });
  } catch (err: any) {
    res.json({ ok: false, error: err.message });
  }
});

// --- 通义千问凭证 ---
admin.get("/api/qwen/get", (_req, res) => {
  const provider = registry.get("qwen");
  const summary = provider?.getCredentialsSummary();
  res.json(summary || null);
});

admin.post("/api/qwen/clear", (_req, res) => {
  const provider = registry.get("qwen");
  res.json({ ok: provider?.clearCredentials() ?? false });
});

admin.post("/api/qwen/checkExpiry", (_req, res) => {
  const provider = registry.get("qwen");
  if (!provider?.checkExpiry) return res.json({ valid: false, reason: "no_credentials" });
  res.json(provider.checkExpiry());
});

admin.post("/api/qwen/saveManual", (req, res) => {
  try {
    const provider = registry.get("qwen");
    provider?.saveManualCredentials(req.body);
    res.json({ ok: true });
  } catch (err: any) {
    res.json({ ok: false, error: err.message });
  }
});

admin.post("/api/qwen/start", async (_req, res) => {
  try {
    const provider = registry.get("qwen");
    if (!provider) return res.json({ ok: false, error: "Qwen provider not found" });
    const creds = await provider.captureCredentials((msg) => {
      console.log(`[Qwen Auth] ${msg}`);
    });
    res.json({ ok: true, capturedAt: creds.capturedAt });
  } catch (err: any) {
    res.json({ ok: false, error: err.message });
  }
});

// --- 代理配置 ---
admin.get("/api/proxy/get", (_req, res) => {
  try {
    const f = path.join(DATA_DIR, "proxy.json");
    if (fs.existsSync(f)) return res.json(JSON.parse(fs.readFileSync(f, "utf-8")));
  } catch { /* ignore */ }
  res.json({ proxy: "" });
});

admin.post("/api/proxy/save", (req, res) => {
  try {
    fs.mkdirSync(DATA_DIR, { recursive: true });
    fs.writeFileSync(path.join(DATA_DIR, "proxy.json"), JSON.stringify({ proxy: (req.body.proxy || "").trim() }, null, 2));
    res.json({ ok: true });
  } catch (err: any) {
    res.json({ ok: false, error: err.message });
  }
});

// --- 设置 ---
admin.get("/api/settings/get", (_req, res) => {
  const s = loadSettings();
  res.json(s);
});

admin.post("/api/settings/save", (req, res) => {
  try {
    const { apiKey, host, rateLimits, autoRefresh } = req.body;
    const updates: Record<string, any> = {};
    if (apiKey !== undefined) updates.apiKey = (apiKey as string).trim();
    if (host !== undefined) updates.host = host === "0.0.0.0" ? "0.0.0.0" : "127.0.0.1";
    if (rateLimits !== undefined) {
      updates.rateLimits = rateLimits;
      for (const [pid, max] of Object.entries(rateLimits)) {
        requestQueue.setConfig(pid, { maxPerMinute: max as number });
      }
    }
    if (autoRefresh !== undefined) {
      updates.autoRefresh = autoRefresh;
      credentialRefresher.updateConfig({
        enabled: autoRefresh.enabled,
        leadTimeMs: (autoRefresh.leadTimeMinutes || 10) * 60 * 1000,
        checkIntervalMs: (autoRefresh.checkIntervalSeconds || 60) * 1000,
      });
    }
    saveSettings(updates);
    res.json({ ok: true, needRestart: apiKey !== undefined || host !== undefined });
  } catch (err: any) {
    res.json({ ok: false, error: err.message });
  }
});

// --- 请求队列状态 ---
admin.get("/api/queue/status", (_req, res) => {
  res.json(requestQueue.getStatus());
});

// --- 凭证刷新器状态 ---
admin.get("/api/refresher/status", (_req, res) => {
  res.json({
    running: credentialRefresher.isRunning(),
    config: credentialRefresher.getConfig(),
  });
});

// --- 日志 ---
admin.get("/api/logs", (_req, res) => {
  res.json(recentLogs.slice(-200));
});

// SPA fallback
admin.get("*", (_req, res) => {
  const indexPath = path.join(rendererDir, "index.html");
  if (fs.existsSync(indexPath)) {
    res.sendFile(indexPath);
  } else {
    res.status(404).send("管理界面未构建，请先运行 npm run build:renderer");
  }
});

admin.listen(ADMIN_PORT, "0.0.0.0", () => {
  console.log(`\n========================================`);
  console.log(`  FreeSeek 独立 Web 模式`);
  console.log(`  API 代理:   http://${API_HOST}:${API_PORT}`);
  console.log(`  管理面板:   http://0.0.0.0:${ADMIN_PORT}`);
  if (settings.apiKey) console.log(`  API Key:    已启用`);
  if (credentialRefresher.isRunning()) console.log(`  自动刷新:   已启用`);
  console.log(`========================================\n`);
});
