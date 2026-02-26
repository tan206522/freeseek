<script setup lang="ts">
import { useAppStore } from "../stores/app";
const store = useAppStore();
</script>

<template>
  <div class="toast-wrap">
    <div v-for="t in store.toasts" :key="t.id" :class="['ant-message', 'ant-message-' + t.type]">
      <span class="ant-message-icon">{{ t.type === 'ok' ? '✓' : t.type === 'err' ? '✕' : 'ℹ' }}</span>
      <span>{{ t.msg }}</span>
    </div>
  </div>
</template>

<style scoped>
.toast-wrap {
  position: fixed;
  top: 16px;
  left: 50%;
  transform: translateX(-50%);
  z-index: 9999;
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 8px;
}
.ant-message {
  padding: 8px 16px;
  border-radius: var(--radius-lg);
  font-size: var(--font-size);
  font-weight: 400;
  animation: msgIn 0.3s ease;
  pointer-events: none;
  box-shadow: var(--shadow-secondary);
  background: var(--bg-container);
  display: flex;
  align-items: center;
  gap: 8px;
  color: var(--text);
}
.ant-message-icon {
  width: 20px;
  height: 20px;
  border-radius: 50%;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  font-size: 12px;
  font-weight: 700;
  flex-shrink: 0;
}
.ant-message-ok .ant-message-icon { background: var(--success-bg); color: var(--success); }
.ant-message-err .ant-message-icon { background: var(--error-bg); color: var(--error); }
.ant-message-info .ant-message-icon { background: var(--primary-bg); color: var(--primary); }
@keyframes msgIn { from { opacity: 0; transform: translateY(-8px); } to { opacity: 1; transform: translateY(0); } }
</style>
