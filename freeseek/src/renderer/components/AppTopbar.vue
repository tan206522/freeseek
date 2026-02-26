<script setup lang="ts">
import { useAppStore } from "../stores/app";
const store = useAppStore();
</script>

<template>
  <div class="topbar">
    <div class="logo">
      <div class="logo-icon">
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M16 3h5v5M4 20L21 3M21 16v5h-5M15 15l6 6M4 4l5 5"/></svg>
      </div>
      <span class="logo-text">FreeSeek</span>
    </div>
    <div class="right">
      <div :class="['status-badge', store.serverRunning ? 'running' : 'stopped']">
        <span class="ant-badge-dot" :class="store.serverRunning ? 'success' : 'error'" />
        {{ store.serverRunning ? '服务运行中' : '服务已停止' }}
      </div>
      <span class="ver">v1.0.0</span>
    </div>
  </div>
</template>

<style scoped>
.topbar {
  background: var(--bg-container);
  border-bottom: 1px solid var(--border-secondary);
  padding: 0 20px;
  height: 48px;
  display: flex;
  align-items: center;
  justify-content: space-between;
  -webkit-app-region: drag;
}
.logo { display: flex; align-items: center; gap: 10px; }
.logo-icon {
  width: 28px; height: 28px;
  background: var(--primary);
  border-radius: var(--radius);
  display: flex; align-items: center; justify-content: center;
}
.logo-icon svg { width: 16px; height: 16px; color: #fff; }
.logo-text { font-size: 15px; font-weight: 600; color: var(--text); letter-spacing: -0.3px; }
.right { display: flex; align-items: center; gap: 12px; -webkit-app-region: no-drag; }
.status-badge {
  font-size: var(--font-size-sm);
  padding: 2px 10px;
  border-radius: 10px;
  display: flex;
  align-items: center;
  font-weight: 500;
}
.status-badge.running { background: var(--success-bg); color: var(--success); border: 1px solid var(--success-border); }
.status-badge.stopped { background: var(--error-bg); color: var(--error); border: 1px solid var(--error-border); }
.ver { font-size: var(--font-size-sm); color: var(--text-quaternary); }
</style>
