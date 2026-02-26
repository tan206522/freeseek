<script setup lang="ts">
import { useAppStore } from "../stores/app";
const store = useAppStore();

const sections = [
  { label: "概览", items: [
    { id: "dashboard", name: "仪表盘", icon: "grid" },
  ]},
  { label: "凭证", items: [
    { id: "auth", name: "登录 & 凭证", icon: "lock" },
  ]},
  { label: "服务", items: [
    { id: "api", name: "API 接口", icon: "file" },
    { id: "debug", name: "API 调试", icon: "send" },
    { id: "test", name: "聊天测试", icon: "chat" },
    { id: "logs", name: "运行日志", icon: "activity" },
  ]},
  { label: "配置", items: [
    { id: "settings", name: "设置", icon: "gear" },
  ]},
];

const icons: Record<string, string> = {
  grid: '<rect x="3" y="3" width="7" height="7" rx="1.5"/><rect x="14" y="3" width="7" height="7" rx="1.5"/><rect x="3" y="14" width="7" height="7" rx="1.5"/><rect x="14" y="14" width="7" height="7" rx="1.5"/>',
  lock: '<rect x="3" y="11" width="18" height="11" rx="2"/><path d="M7 11V7a5 5 0 0110 0v4"/>',
  file: '<path d="M13 2H6a2 2 0 00-2 2v16a2 2 0 002 2h12a2 2 0 002-2V9z"/><polyline points="13 2 13 9 20 9"/>',
  send: '<path d="M20 7l-8 5-8-5"/><rect x="4" y="3" width="16" height="18" rx="2"/>',
  chat: '<path d="M21 15a2 2 0 01-2 2H7l-4 4V5a2 2 0 012-2h14a2 2 0 012 2z"/>',
  activity: '<polyline points="22 12 18 12 15 21 9 3 6 12 2 12"/>',
  gear: '<circle cx="12" cy="12" r="3"/><path d="M19.4 15a1.65 1.65 0 00.33 1.82l.06.06a2 2 0 01-2.83 2.83l-.06-.06a1.65 1.65 0 00-1.82-.33 1.65 1.65 0 00-1 1.51V21a2 2 0 01-4 0v-.09A1.65 1.65 0 009 19.4a1.65 1.65 0 00-1.82.33l-.06.06a2 2 0 01-2.83-2.83l.06-.06A1.65 1.65 0 004.68 15a1.65 1.65 0 00-1.51-1H3a2 2 0 010-4h.09A1.65 1.65 0 004.6 9a1.65 1.65 0 00-.33-1.82l-.06-.06a2 2 0 012.83-2.83l.06.06A1.65 1.65 0 009 4.68a1.65 1.65 0 001-1.51V3a2 2 0 014 0v.09a1.65 1.65 0 001 1.51 1.65 1.65 0 001.82-.33l.06-.06a2 2 0 012.83 2.83l-.06.06a1.65 1.65 0 00-.33 1.82V9a1.65 1.65 0 001.51 1H21a2 2 0 010 4h-.09a1.65 1.65 0 00-1.51 1z"/>',
};
</script>

<template>
  <div class="sidebar">
    <template v-for="sec in sections" :key="sec.label">
      <div class="section-label">{{ sec.label }}</div>
      <div
        v-for="item in sec.items" :key="item.id"
        :class="['nav-item', { active: store.activePage === item.id }]"
        @click="store.activePage = item.id"
      >
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" v-html="icons[item.icon]"></svg>
        <span>{{ item.name }}</span>
      </div>
    </template>
  </div>
</template>

<style scoped>
.sidebar {
  background: var(--bg-container);
  border-right: 1px solid var(--border-secondary);
  padding: 8px;
  display: flex;
  flex-direction: column;
  gap: 1px;
}
.section-label {
  font-size: 12px;
  color: var(--text-quaternary);
  padding: 16px 12px 6px;
  font-weight: 600;
  text-transform: uppercase;
  letter-spacing: 0.5px;
}
.nav-item {
  padding: 8px 12px;
  cursor: pointer;
  font-size: 14px;
  display: flex;
  align-items: center;
  gap: 10px;
  color: var(--text-secondary);
  border-radius: var(--radius);
  transition: all 0.15s;
  font-weight: 400;
}
.nav-item:hover { background: var(--fill-quaternary); color: var(--text); }
.nav-item.active {
  background: var(--primary-bg);
  color: var(--primary);
  font-weight: 500;
}
.nav-item svg { width: 16px; height: 16px; flex-shrink: 0; }
.nav-item.active svg { color: var(--primary); }
</style>
