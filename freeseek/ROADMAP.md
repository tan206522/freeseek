# FreeSeek 扩展升级计划

> 基于当前架构的功能扩展路线图，按优先级排列。

## P0 — 近期（安全与部署基础） ✅ 已完成

### API Key 鉴权 ✅

- [x] `PageSettings` 新增 API Key 配置项，保存到 `data/settings.json`
- [x] `server.ts` 添加中间件，校验 `Authorization: Bearer <key>`
- [x] 未设置 Key 时跳过校验，保持向后兼容
- [x] Electron / Web 双模式均支持

### Docker 部署 ✅

- [x] 编写 `Dockerfile`（基于 `node:20-slim`，多阶段构建）
- [x] 编写 `docker-compose.yml`（挂载 `data/` 目录持久化凭证）
- [x] 支持环境变量配置端口（`PORT`、`ADMIN_PORT`、`HOST`）
- [x] 编写 `.dockerignore`
- [x] README 补充 Docker 部署说明

### 监听地址可配置 ✅

- [x] `PageSettings` 新增监听地址选项（`127.0.0.1` / `0.0.0.0`）
- [x] 监听 `0.0.0.0` 时提示设置 API Key
- [x] `server-standalone.ts` 支持 `--host` 参数和 `HOST` 环境变量

---

## P1 — 中期（核心能力增强） ✅ 已完成

### 多账号轮询 / 负载均衡 ✅

单账号容易触发频率限制，支持多账号池提升可用性。

- [x] 凭证存储改为数组结构（兼容旧格式，单凭证自动包装为数组）
- [x] Provider 内部维护账号池，支持 Round-Robin / 随机策略
- [x] 单账号请求失败时自动切换下一个
- [x] 管理面板支持添加/删除/排序多组凭证
- [x] 每个账号独立显示状态（有效/过期/失败次数）

### 凭证自动刷新 ✅

DeepSeek 和通义千问的 JWT Token 有过期时间，到期后需手动重新捕获。

- [x] 后台定时检测 Token 过期状态（复用现有 `checkExpiry()`）
- [x] 快过期时（剩余 < 10 分钟）自动触发 `captureCredentials()`
- [x] 刷新失败时通知用户（系统托盘气泡 / 管理面板告警）
- [x] 可配置自动刷新开关和提前量

### 图片 / 多模态支持

`ChatMessage` 类型已定义 `image_url` 字段，但 `buildPrompt()` 仅提取文本。

- [ ] 解析 `image_url`（支持 Base64 data URI 和 HTTP URL）
- [ ] Claude Provider：通过 Web API 传递图片附件
- [ ] 通义千问 Provider：通过 Web API 传递图片
- [ ] DeepSeek Provider：不支持图片时返回明确错误信息
- [ ] 聊天测试页面支持粘贴/上传图片

预计工作量：2 天（待各厂商 Web API 图片接口格式确认后实现）

### 请求队列与限速 ✅

避免短时间大量请求触发厂商反爬。

- [x] 每个 Provider 维护独立请求队列
- [x] 可配置每分钟最大请求数（按 Provider 独立设置）
- [x] 超限时排队等待，返回 `429` 或等待后重试
- [x] 管理面板展示队列状态（排队数 / 处理中）

---

## P2 — 中后期（更多厂商接入）

### Kimi（月之暗面）Provider

国内直连，无需代理，接入门槛低。

- [ ] 实现 `KimiProvider`（Auth + Client + StreamConverter 三件套）
- [ ] 凭证捕获：Playwright 自动登录 kimi.moonshot.cn
- [ ] 模型列表：`kimi-chat`、`kimi-k2` 等
- [ ] SSE 流转换为 OpenAI 格式

预计工作量：2 天

### 豆包（字节跳动）Provider

国内直连，用户基数大。

- [ ] 实现 `DoubaoProvider`
- [ ] 凭证捕获：Playwright 自动登录 doubao.com
- [ ] 模型列表：`doubao-pro`、`doubao-lite` 等
- [ ] SSE 流转换

预计工作量：2 天

### Gemini（Google）Provider

多模态能力强，海外用户需求大。

- [ ] 实现 `GeminiProvider`
- [ ] 凭证捕获：Playwright 登录 gemini.google.com（需代理）
- [ ] 模型列表：`gemini-2.5-pro`、`gemini-2.5-flash` 等
- [ ] 支持图片输入（Gemini 原生多模态）

预计工作量：3 天

---

## P3 — 体验优化

### 请求历史与统计面板

当前统计过于粗略（总请求数 + chars/2 估算 Token）。

- [ ] 记录每次请求的详细信息（时间、模型、厂商、耗时、Token 数）
- [ ] 按厂商 / 模型分组统计
- [ ] 仪表盘展示趋势图表（每日请求量、Token 用量）
- [ ] 最近 N 条请求详情列表（可展开查看完整内容）
- [ ] 支持导出统计数据

预计工作量：2 天

### WebSocket 实时日志

替代当前 5 秒轮询，提升管理面板实时性。

- [ ] `server-standalone.ts` 添加 WebSocket 端点
- [ ] 日志实时推送到前端
- [ ] 流式请求进度实时展示
- [ ] 降级方案：WebSocket 不可用时回退轮询

预计工作量：1 天

### 系统托盘增强

当前托盘菜单仅有"显示窗口"和"退出"。

- [ ] 托盘图标反映服务状态（运行中 / 已停止 / 凭证过期）
- [ ] 右键菜单快捷启停服务
- [ ] 显示最近请求数和 Token 用量
- [ ] 凭证过期时弹出气泡通知

预计工作量：0.5 天

### 凭证加密存储

当前凭证明文存储在 `data/*.json`。

- [ ] Electron 模式：使用 `safeStorage` API 加密
- [ ] Web 模式：使用 AES-256-GCM 加密，密钥从环境变量读取
- [ ] 加密/解密对上层透明，不影响 Provider 接口

预计工作量：1 天

---

## P4 — OpenAI 兼容性完善

### 补全更多端点

- [ ] `POST /v1/completions`（旧版补全接口，部分工具仍在用）
- [ ] `POST /v1/embeddings`（接入免费 embedding 服务或本地模型）
- [ ] 响应中补全 `usage` 字段（`prompt_tokens` / `completion_tokens`）

### 参数透传

- [ ] `temperature`、`top_p` — 对支持的厂商透传，不支持的静默忽略
- [ ] `max_tokens` — 映射为各厂商的对应参数
- [ ] `stop` — 在流转换器中实现截断
- [ ] `n` — 多路并发生成（部分厂商支持）

### 自动化测试

- [ ] Provider 注册与模型路由的单元测试
- [ ] StreamConverter 输出格式的正确性测试
- [ ] API 端点集成测试（mock Provider）
- [ ] CI 流水线（GitHub Actions）

---

## 架构备忘

新增 Provider 的标准流程：

1. 在 `src/main/` 下创建 `xxx-auth.ts`、`xxx-client.ts`、`xxx-stream.ts`
2. 在 `src/main/providers/` 下创建 `xxx.ts`，实现 `Provider` 接口
3. 在 `src/main/providers/registry.ts` 中 `register(new XxxProvider())`
4. 在 `src/main/providers/index.ts` 中导出
5. 管理面板补充对应的凭证管理 UI
6. `server-standalone.ts` 补充对应的 Admin API 路由
