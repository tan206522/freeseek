import { defineStore } from "pinia";
import { ref, computed } from "vue";
import { bridge } from "../bridge";

export interface LogEntry {
  time: string;
  level: string;
  msg: string;
}

export const useAppStore = defineStore("app", () => {
  // --- Server ---
  const serverRunning = ref(false);
  const serverPort = ref(3000);
  const uptime = ref(0);
  const requestCount = ref(0);
  const totalTokens = ref(0);

  // --- Credentials ---
  const hasCredentials = ref(false);
  const cookieCount = ref(0);
  const hasSessionId = ref(false);
  const bearerLength = ref(0);
  const capturedAt = ref<string | null>(null);
  const expiryStatus = ref<"valid" | "expiring" | "expired" | "unknown">("unknown");
  const expiryDetail = ref("");

  // --- Claude Credentials ---
  const hasClaudeCredentials = ref(false);
  const claudeSessionKeyPrefix = ref("");
  const claudeHasOrganizationId = ref(false);
  const claudeCapturedAt = ref<string | null>(null);

  // --- Logs ---
  const logs = ref<LogEntry[]>([]);
  const logFilter = ref("all");
  const filteredLogs = computed(() =>
    logFilter.value === "all" ? logs.value : logs.value.filter((l) => l.level === logFilter.value)
  );

  // --- Toasts ---
  const toasts = ref<{ id: number; msg: string; type: string }[]>([]);
  let toastId = 0;

  function showToast(msg: string, type = "info") {
    const id = ++toastId;
    toasts.value.push({ id, msg, type });
    setTimeout(() => {
      toasts.value = toasts.value.filter((t) => t.id !== id);
    }, 3000);
  }

  // --- Active page ---
  const activePage = ref("dashboard");

  // --- Actions ---
  async function refreshStatus() {
    try {
      const st = await bridge.getServerStatus();
      serverRunning.value = st.running;
      serverPort.value = st.port;
      uptime.value = st.uptime;
      hasCredentials.value = st.hasCredentials;

      const stats = await bridge.getStats();
      requestCount.value = stats.requestCount;
      totalTokens.value = stats.totalTokens;

      await refreshCredentials();
      await refreshClaudeCredentials();
    } catch (e) {
      console.error(e);
    }
  }

  async function refreshCredentials() {
    const c = await bridge.getCredentials();
    if (c) {
      hasCredentials.value = true;
      cookieCount.value = c.cookieCount;
      hasSessionId.value = c.hasSessionId;
      bearerLength.value = c.bearerLength;
      capturedAt.value = c.capturedAt;
      try {
        const ex = await bridge.checkCredentialExpiry();
        if (ex.expired) { expiryStatus.value = "expired"; expiryDetail.value = "已过期"; }
        else if (ex.expiringSoon) { expiryStatus.value = "expiring"; expiryDetail.value = formatUptime(ex.remainingMs!) + "后过期"; }
        else if (ex.expiresAt) { expiryStatus.value = "valid"; expiryDetail.value = new Date(ex.expiresAt).toLocaleString("zh-CN"); }
        else { expiryStatus.value = "unknown"; expiryDetail.value = "无法解析"; }
      } catch { /* ignore */ }
    } else {
      hasCredentials.value = false;
      cookieCount.value = 0;
      bearerLength.value = 0;
      capturedAt.value = null;
      expiryStatus.value = "unknown";
      expiryDetail.value = "";
    }
  }

  async function refreshClaudeCredentials() {
    try {
      const c = await bridge.getClaudeCredentials();
      if (c) {
        hasClaudeCredentials.value = true;
        claudeSessionKeyPrefix.value = c.sessionKeyPrefix || "";
        claudeHasOrganizationId.value = c.hasOrganizationId || false;
        claudeCapturedAt.value = c.capturedAt;
      } else {
        hasClaudeCredentials.value = false;
        claudeSessionKeyPrefix.value = "";
        claudeHasOrganizationId.value = false;
        claudeCapturedAt.value = null;
      }
    } catch { /* ignore */ }
  }

  async function toggleServer() {
    if (serverRunning.value) {
      await bridge.stopServer();
      showToast("服务已停止", "info");
    } else {
      await bridge.startServer(serverPort.value);
      showToast("服务已启动", "ok");
    }
    setTimeout(refreshStatus, 500);
  }

  function addLog(log: LogEntry) {
    logs.value.push(log);
    if (logs.value.length > 2000) logs.value = logs.value.slice(-1500);
  }

  function clearLogs() { logs.value = []; }

  return {
    serverRunning, serverPort, uptime, requestCount, totalTokens,
    hasCredentials, cookieCount, hasSessionId, bearerLength, capturedAt,
    expiryStatus, expiryDetail,
    hasClaudeCredentials, claudeSessionKeyPrefix, claudeHasOrganizationId, claudeCapturedAt,
    logs, logFilter, filteredLogs,
    toasts, showToast,
    activePage,
    refreshStatus, refreshCredentials, refreshClaudeCredentials, toggleServer, addLog, clearLogs,
  };
});

// --- Helpers ---
export function formatUptime(ms: number): string {
  const s = Math.floor(ms / 1000);
  if (s < 60) return s + "s";
  const m = Math.floor(s / 60);
  if (m < 60) return m + "m" + ("0" + (s % 60)).slice(-2) + "s";
  const h = Math.floor(m / 60);
  if (h < 24) return h + "h" + ("0" + (m % 60)).slice(-2) + "m";
  return Math.floor(h / 24) + "d" + ("0" + (h % 24)).slice(-2) + "h";
}

export function formatTokens(n: number): string {
  if (n >= 1e6) return (n / 1e6).toFixed(1) + "M";
  if (n >= 1e3) return (n / 1e3).toFixed(1) + "K";
  return String(n);
}

import katex from "katex";

export function escapeHtml(s: string): string {
  return s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}

/**
 * 渲染 KaTeX 数学公式
 * 支持: \[...\] $$...$$ (块级) 和 \(...\) $...$ (行内)
 */
function renderMath(html: string): string {
  // 块级公式: \[...\] 和 $$...$$
  html = html.replace(/\\\[([\s\S]*?)\\\]/g, (_, tex) => {
    try {
      return katex.renderToString(tex.trim(), { displayMode: true, throwOnError: false });
    } catch { return `<pre class="katex-error">${tex}</pre>`; }
  });
  html = html.replace(/\$\$([\s\S]*?)\$\$/g, (_, tex) => {
    try {
      return katex.renderToString(tex.trim(), { displayMode: true, throwOnError: false });
    } catch { return `<pre class="katex-error">${tex}</pre>`; }
  });
  // 行内公式: \(...\) 和 $...$（不匹配 $$）
  html = html.replace(/\\\(([\s\S]*?)\\\)/g, (_, tex) => {
    try {
      return katex.renderToString(tex.trim(), { displayMode: false, throwOnError: false });
    } catch { return `<code class="katex-error">${tex}</code>`; }
  });
  html = html.replace(/(?<!\$)\$(?!\$)([^\n$]+?)\$(?!\$)/g, (_, tex) => {
    try {
      return katex.renderToString(tex.trim(), { displayMode: false, throwOnError: false });
    } catch { return `<code class="katex-error">${tex}</code>`; }
  });
  return html;
}

export function renderMd(text: string): string {
  if (!text) return "";

  // 先提取数学公式，用占位符保护它们不被 escapeHtml 破坏
  const mathBlocks: string[] = [];
  let processed = text;

  // 保护块级公式 \[...\] 和 $$...$$
  processed = processed.replace(/\\\[([\s\S]*?)\\\]/g, (m) => {
    mathBlocks.push(m);
    return `%%MATH_BLOCK_${mathBlocks.length - 1}%%`;
  });
  processed = processed.replace(/\$\$([\s\S]*?)\$\$/g, (m) => {
    mathBlocks.push(m);
    return `%%MATH_BLOCK_${mathBlocks.length - 1}%%`;
  });
  // 保护行内公式 \(...\) 和 $...$
  processed = processed.replace(/\\\(([\s\S]*?)\\\)/g, (m) => {
    mathBlocks.push(m);
    return `%%MATH_BLOCK_${mathBlocks.length - 1}%%`;
  });
  processed = processed.replace(/(?<!\$)\$(?!\$)([^\n$]+?)\$(?!\$)/g, (m) => {
    mathBlocks.push(m);
    return `%%MATH_BLOCK_${mathBlocks.length - 1}%%`;
  });

  // Markdown 渲染
  let html = escapeHtml(processed);
  html = html.replace(/```(\w*)\n([\s\S]*?)```/g, (_, _lang, code) => "<pre><code>" + code.trim() + "</code></pre>");
  html = html.replace(/`([^`\n]+)`/g, "<code>$1</code>");
  html = html.replace(/^#### (.+)$/gm, "<h4>$1</h4>");
  html = html.replace(/^### (.+)$/gm, "<h3>$1</h3>");
  html = html.replace(/^## (.+)$/gm, "<h2>$1</h2>");
  html = html.replace(/^# (.+)$/gm, "<h1>$1</h1>");
  html = html.replace(/\*\*\*(.+?)\*\*\*/g, "<strong><em>$1</em></strong>");
  html = html.replace(/\*\*(.+?)\*\*/g, "<strong>$1</strong>");
  html = html.replace(/\*(.+?)\*/g, "<em>$1</em>");
  html = html.replace(/~~(.+?)~~/g, "<del>$1</del>");
  html = html.replace(/^&gt; (.+)$/gm, "<blockquote>$1</blockquote>");
  html = html.replace(/^---$/gm, "<hr>");
  html = html.replace(/^[\-\*] (.+)$/gm, "<li>$1</li>");
  html = html.replace(/^\d+\. (.+)$/gm, "<li>$1</li>");
  html = html.replace(/((?:<li>.*<\/li>\n?)+)/g, "<ul>$1</ul>");
  html = html.replace(/\[([^\]]+)\]\(([^)]+)\)/g, '<a href="$2" target="_blank">$1</a>');
  html = html.replace(/^(?!<[hupblodat]|<\/|<li|<hr|<code|<pre|<strong|<em|<del|<blockquote|<ul)(.+)$/gm, "<p>$1</p>");
  html = html.replace(/<p><\/p>/g, "");
  html = html.replace(/\n{2,}/g, "\n");

  // 还原数学公式占位符并渲染 KaTeX
  for (let i = 0; i < mathBlocks.length; i++) {
    html = html.replace(`%%MATH_BLOCK_${i}%%`, () => renderMath(mathBlocks[i]));
  }

  return html;
}
