<script setup lang="ts">
import { ref, onMounted } from "vue";
import { useAppStore } from "../stores/app";
import { bridge } from "../bridge";
const store = useAppStore();

const proxyUrl = ref("");
const proxySaved = ref(false);

onMounted(async () => {
  try {
    const cfg = await bridge.getProxy();
    proxyUrl.value = cfg?.proxy || "";
  } catch { /* ignore */ }
});

async function saveProxy() {
  const r = await bridge.saveProxy(proxyUrl.value);
  if (r.ok) {
    store.showToast("代理配置已保存", "ok");
    proxySaved.value = true;
    setTimeout(() => { proxySaved.value = false; }, 2000);
  } else {
    store.showToast("保存失败: " + r.error, "err");
  }
}
</script>

<template>
  <div>
    <div class="ant-card">
      <div class="ant-card-head"><div class="ant-card-title">服务配置</div></div>
      <div class="ant-card-body">
        <div class="ant-form-item">
          <label class="ant-form-label">监听端口</label>
          <input class="ant-input" type="text" v-model.number="store.serverPort" style="width:140px" />
        </div>
        <div class="ant-form-item">
          <label class="ant-form-label">监听地址</label>
          <select class="ant-select" style="width:220px" disabled>
            <option>127.0.0.1（仅本机）</option>
          </select>
        </div>
      </div>
    </div>

    <div class="ant-card">
      <div class="ant-card-head"><div class="ant-card-title">代理配置</div></div>
      <div class="ant-card-body">
        <p style="margin-bottom:12px;color:var(--text-secondary)">
          Playwright 启动的浏览器不会继承系统代理。如果需要通过代理访问 claude.ai 或 deepseek.com，请在此配置。
          也可通过环境变量 <span class="ant-code">HTTPS_PROXY</span> 设置。
        </p>
        <div class="ant-form-item">
          <label class="ant-form-label">代理地址</label>
          <div style="display:flex;gap:8px;align-items:center">
            <input class="ant-input" v-model="proxyUrl" placeholder="http://127.0.0.1:7890 或 socks5://127.0.0.1:1080" style="flex:1" />
            <button class="ant-btn ant-btn-primary" @click="saveProxy">{{ proxySaved ? '✓ 已保存' : '保存' }}</button>
          </div>
        </div>
        <p style="color:var(--text-quaternary);font-size:var(--font-size-sm)">
          留空则不使用代理。支持 http、https、socks5 协议。保存后下次捕获凭证时生效。
        </p>
      </div>
    </div>

    <div class="ant-card">
      <div class="ant-card-head"><div class="ant-card-title">快捷键</div></div>
      <div class="ant-card-body" style="padding:0">
        <table class="ant-table">
          <tr><th>快捷键</th><th>功能</th></tr>
          <tr><td><span class="ant-code">Ctrl+1</span> ~ <span class="ant-code">Ctrl+7</span></td><td>切换页面</td></tr>
          <tr><td><span class="ant-code">Ctrl+Enter</span></td><td>API 调试页发送请求</td></tr>
          <tr><td><span class="ant-code">Escape</span></td><td>中止 API 调试请求</td></tr>
          <tr><td><span class="ant-code">Enter</span></td><td>聊天测试发送消息</td></tr>
        </table>
      </div>
    </div>

    <div class="ant-card">
      <div class="ant-card-head"><div class="ant-card-title">关于</div></div>
      <div class="ant-card-body">
        <p>FreeSeek 是一个 DeepSeek / Claude 网页版反向代理工具，在本地提供兼容 OpenAI API 格式的 HTTP 服务。支持多厂商模型路由，仅供个人学习研究使用。</p>
      </div>
    </div>
  </div>
</template>
