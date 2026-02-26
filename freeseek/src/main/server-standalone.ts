/**
 * FreeSeek 独立 Web 模式入口
 * 不依赖 Electron，纯 Node.js 运行
 * 用法: node dist/main/server-standalone.js [--port 3000] [--admin-port 3001]
 */
import express from "express";
import path from "node:path";
import fs from "node:fs";
import { createApp, getStats, resetSessions, startServer, type ServerLog } from "./server";
import { loadCredentials, clearCredentials } from "./auth";
import {
  loadClaudeCredentials,
  clearClaudeCredentials,
  captureClaudeCredentials,
} from "./claude-auth";
import { captureCredentials } from "./auth";
import { resetClaudeClient } from "./server";

const args = process.argv.slice(2);
function getArg(name: string, def: string): string {
  const idx = args.indexOf(name);
  return idx >= 0 && args[idx + 1] ? args[idx + 1] : def;
}

const API_PORT = parseInt(getArg("--port", "3000"), 10);
const ADMIN_PORT = parseInt(getArg("--admin-port", "3001"), 10);
const DATA_DIR = path.join(__dirname, "..", "..", "data");

// 日志收集
const recentLogs: ServerLog[] = [];
function onLog(log: ServerLog) {
  recentLogs.push(log);
  if (recentLogs.length > 500) recentLogs.splice(0, recentLogs.length - 300);
  const prefix = log.level === "ok" ? "✅" : log.level === "warn" ? "⚠️" : log.level === "err" ? "❌" : "ℹ️";
  console.log(`[${log.time}] ${prefix} ${log.msg}`);
}

// ========== 启动 API 代理服务 ==========
const apiServer = startServer(API_PORT, onLog);
const startedAt = Date.now();

// ========== 管理面板 HTTP API ==========
const admin = express();
admin.use(express.json());

// CORS
admin.use((_req, res, next) => {
  res.header("Access-Control-Allow-Origin", "*");
  res.header("Access-Control-Allow-Headers", "*");
  res.header("Access-Control-Allow-Methods", "GET, POST, OPTIONS");
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
  const creds = loadCredentials();
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

// --- DeepSeek 凭证 ---
admin.get("/api/auth/get", (_req, res) => {
  const creds = loadCredentials();
  if (!creds) return res.json(null);
  res.json({
    hasCookie: !!creds.cookie,
    cookieCount: creds.cookie.split(";").length,
    hasBearer: !!creds.bearer,
    bearerLength: creds.bearer.length,
    capturedAt: creds.capturedAt,
    hasSessionId: creds.cookie.includes("ds_session_id=") || creds.cookie.includes("d_id="),
  });
});

admin.post("/api/auth/clear", (_req, res) => {
  res.json({ ok: clearCredentials() });
});

admin.post("/api/auth/checkExpiry", (_req, res) => {
  const creds = loadCredentials();
  if (!creds?.bearer) return res.json({ valid: false, reason: "no_credentials" });
  try {
    const parts = creds.bearer.split(".");
    if (parts.length !== 3) return res.json({ valid: true, expiresAt: null });
    const payload = JSON.parse(Buffer.from(parts[1], "base64url").toString());
    if (payload.exp) {
      const expiresAt = payload.exp * 1000;
      const remaining = expiresAt - Date.now();
      return res.json({
        valid: remaining > 0,
        expiresAt: new Date(expiresAt).toISOString(),
        remainingMs: remaining,
        expired: remaining <= 0,
        expiringSoon: remaining > 0 && remaining < 30 * 60 * 1000,
      });
    }
    res.json({ valid: true, expiresAt: null });
  } catch {
    res.json({ valid: true, expiresAt: null });
  }
});

admin.post("/api/auth/saveManual", (req, res) => {
  try {
    const { cookie, bearer, userAgent } = req.body;
    fs.mkdirSync(DATA_DIR, { recursive: true });
    const creds = {
      cookie, bearer,
      userAgent: userAgent || "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36",
      capturedAt: new Date().toISOString(),
    };
    fs.writeFileSync(path.join(DATA_DIR, "auth.json"), JSON.stringify(creds, null, 2));
    res.json({ ok: true });
  } catch (err: any) {
    res.json({ ok: false, error: err.message });
  }
});

admin.post("/api/auth/start", async (_req, res) => {
  try {
    const creds = await captureCredentials((msg) => {
      console.log(`[Auth] ${msg}`);
    });
    res.json({ ok: true, capturedAt: creds.capturedAt });
  } catch (err: any) {
    res.json({ ok: false, error: err.message });
  }
});

// --- Claude 凭证 ---
admin.get("/api/claude/get", (_req, res) => {
  const creds = loadClaudeCredentials();
  if (!creds) return res.json(null);
  res.json({
    hasSessionKey: !!creds.sessionKey,
    sessionKeyPrefix: creds.sessionKey?.slice(0, 20) + "...",
    hasCookie: !!creds.cookie,
    hasOrganizationId: !!creds.organizationId,
    capturedAt: creds.capturedAt,
  });
});

admin.post("/api/claude/clear", (_req, res) => {
  resetClaudeClient();
  res.json({ ok: clearClaudeCredentials() });
});

admin.post("/api/claude/saveManual", (req, res) => {
  try {
    const { sessionKey, cookie, userAgent } = req.body;
    fs.mkdirSync(DATA_DIR, { recursive: true });
    const creds = {
      sessionKey: sessionKey.trim(),
      cookie: cookie?.trim() || `sessionKey=${sessionKey.trim()}`,
      userAgent: userAgent?.trim() || "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36",
      capturedAt: new Date().toISOString(),
    };
    fs.writeFileSync(path.join(DATA_DIR, "claude-auth.json"), JSON.stringify(creds, null, 2));
    resetClaudeClient();
    res.json({ ok: true });
  } catch (err: any) {
    res.json({ ok: false, error: err.message });
  }
});

admin.post("/api/claude/start", async (_req, res) => {
  try {
    const creds = await captureClaudeCredentials((msg) => {
      console.log(`[Claude Auth] ${msg}`);
    });
    resetClaudeClient();
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
  console.log(`  API 代理:   http://0.0.0.0:${API_PORT}`);
  console.log(`  管理面板:   http://0.0.0.0:${ADMIN_PORT}`);
  console.log(`========================================\n`);
});
