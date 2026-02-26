<script setup lang="ts">
import { onMounted, onUnmounted } from "vue";
import { useAppStore } from "./stores/app";
import { bridge } from "./bridge";
import AppTopbar from "./components/AppTopbar.vue";
import AppSidebar from "./components/AppSidebar.vue";
import ToastContainer from "./components/ToastContainer.vue";
import PageDashboard from "./pages/PageDashboard.vue";
import PageAuth from "./pages/PageAuth.vue";
import PageApi from "./pages/PageApi.vue";
import PageDebug from "./pages/PageDebug.vue";
import PageChat from "./pages/PageChat.vue";
import PageLogs from "./pages/PageLogs.vue";
import PageSettings from "./pages/PageSettings.vue";

const store = useAppStore();

const pages: Record<string, any> = {
  dashboard: PageDashboard, auth: PageAuth, api: PageApi,
  debug: PageDebug, test: PageChat, logs: PageLogs, settings: PageSettings,
};

let timer: ReturnType<typeof setInterval>;
let cleanupLog: (() => void) | undefined;
let cleanupAuth: (() => void) | undefined;

onMounted(() => {
  store.refreshStatus();
  timer = setInterval(() => store.refreshStatus(), 5000);
  cleanupLog = bridge.onLog((log) => store.addLog(log));
  cleanupAuth = bridge.onAuthStatus((msg) => {
    /* handled by auth page directly */
  });
});

onUnmounted(() => {
  clearInterval(timer);
  cleanupLog?.();
  cleanupAuth?.();
});

function onKeydown(e: KeyboardEvent) {
  const pageKeys = ["dashboard", "auth", "api", "debug", "test", "logs", "settings"];
  if (e.ctrlKey && e.key >= "1" && e.key <= "7") {
    e.preventDefault();
    store.activePage = pageKeys[+e.key - 1];
  }
}
</script>

<template>
  <div @keydown="onKeydown" tabindex="-1" style="outline:none">
    <ToastContainer />
    <AppTopbar />
    <div class="layout">
      <AppSidebar />
      <div class="content">
        <component :is="pages[store.activePage]" />
      </div>
    </div>
  </div>
</template>

<style scoped>
.layout {
  display: grid;
  grid-template-columns: 200px 1fr;
  height: calc(100vh - 48px);
  overflow: hidden;
}
.content {
  padding: 24px;
  overflow-y: auto;
  background: var(--bg-layout);
}
</style>
