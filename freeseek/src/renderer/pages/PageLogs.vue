<script setup lang="ts">
import { ref, watch, nextTick } from "vue";
import { useAppStore } from "../stores/app";
const store = useAppStore();

const logArea = ref<HTMLElement | null>(null);

watch(() => store.filteredLogs.length, () => {
  nextTick(() => { if (logArea.value) logArea.value.scrollTop = logArea.value.scrollHeight; });
});
</script>

<template>
  <div>
    <div class="ant-card">
      <div class="ant-card-head">
        <div class="ant-card-title">实时日志</div>
        <div style="display:flex;gap:8px;align-items:center">
          <select class="ant-select" v-model="store.logFilter" style="width:100px">
            <option value="all">全部</option>
            <option value="info">INFO</option>
            <option value="ok">OK</option>
            <option value="warn">WARN</option>
            <option value="err">ERROR</option>
          </select>
          <button class="ant-btn ant-btn-sm" @click="store.clearLogs()">清空</button>
        </div>
      </div>
      <div class="ant-card-body" style="padding:0">
        <div class="log-area" ref="logArea">
          <div v-for="(log, i) in store.filteredLogs" :key="i" class="log-line">
            <span class="log-time">{{ log.time }}</span>
            <span :class="['log-level', log.level]">{{ log.level.toUpperCase() }}</span>
            <span class="log-msg">{{ log.msg }}</span>
          </div>
          <div v-if="!store.filteredLogs.length" class="log-empty">暂无日志</div>
        </div>
      </div>
    </div>
  </div>
</template>

<style scoped>
.log-area {
  padding: 12px 16px;
  font-family: var(--font-mono);
  font-size: 12px;
  height: 480px;
  overflow-y: auto;
  line-height: 1.8;
}
.log-line { display: flex; gap: 10px; padding: 2px 0; }
.log-line:hover { background: var(--fill-quaternary); }
.log-time { color: var(--text-quaternary); flex-shrink: 0; }
.log-level { flex-shrink: 0; font-weight: 600; min-width: 40px; }
.log-level.info { color: var(--primary); }
.log-level.ok { color: var(--success); }
.log-level.warn { color: var(--warning); }
.log-level.err { color: var(--error); }
.log-msg { color: var(--text-secondary); }
.log-empty { text-align: center; color: var(--text-quaternary); padding: 40px; }
</style>
