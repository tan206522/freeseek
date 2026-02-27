# FreeSeek 接入 OpenClaw 完整教程

> 让 OpenClaw 通过 FreeSeek 免费使用 DeepSeek R1/V3 和 Claude，零 API 额度消耗。

## 架构概览

```
┌──────────────────────────────────────────────────────────┐
│                        你的电脑                           │
│                                                          │
│  ┌────────────┐     ┌────────────┐     ┌──────────────┐ │
│  │  OpenClaw   │────▶│  FreeSeek  │────▶│ chat.deep-   │ │
│  │  Agent/TUI  │     │  (代理)    │     │ seek.com     │ │
│  │  Gateway    │     │ :3000      │     │ claude.ai    │ │
│  └────────────┘     └────────────┘     └──────────────┘ │
│   使用 AI 能力         转发请求           实际 AI 服务      │
│   OpenAI 格式           ▲                                │
│                         │                                │
│                    网页版凭证                              │
│                  (Cookie/Token)                           │
└──────────────────────────────────────────────────────────┘
```

- **FreeSeek**：把 DeepSeek / Claude 网页版包装成 OpenAI 兼容 API（`http://localhost:3000/v1`）
- **OpenClaw**：AI Agent 框架，通过 `openai-completions` 协议对接 FreeSeek

---

## 第一部分：安装 FreeSeek

### 1.1 环境要求

- Node.js >= 18
- npm 或 pnpm

### 1.2 安装与启动

```bash
cd ~
git clone https://github.com/你的仓库/freeseek.git
cd freeseek
npm install
```

**桌面模式**（有桌面环境）：

```bash
npm start
# 启动后点「启动自动捕获」，登录 DeepSeek / Claude，凭证自动保存
```

**Web 模式**（Linux 服务器 / 无桌面环境）：

```bash
npm run build
npm run web:start
# API 端口 3000，管理面板端口 3001
```

**Docker 部署**：

```bash
docker compose up -d
# 或手动：
docker build -t freeseek .
docker run -d --name freeseek -p 3000:3000 -p 3001:3001 -v ./data:/app/data freeseek
```

### 1.3 配置凭证

如果无法使用自动捕获，手动配置凭证：

**DeepSeek**：

1. 浏览器打开 `chat.deepseek.com` 并登录
2. F12 → Network → 找到 `/api/v0/` 请求 → 复制 `Cookie` 和 `Authorization`
3. 写入 `data/auth.json`：

```json
{
  "cookie": "ds_session_id=xxx; ...",
  "bearer": "eyJhbGciOiJIUzI1NiIs...",
  "userAgent": "Mozilla/5.0 ...",
  "capturedAt": "2026-01-01T00:00:00.000Z"
}
```

**Claude**：

1. 浏览器打开 `claude.ai` 并登录
2. F12 → Application → Cookies → 复制 `sessionKey`
3. 写入 `data/claude-auth.json`：

```json
{
  "sessionKey": "sk-ant-sid01-xxxxxxxx",
  "cookie": "sessionKey=sk-ant-sid01-xxxxxxxx",
  "userAgent": "Mozilla/5.0 ...",
  "capturedAt": "2026-01-01T00:00:00.000Z"
}
```

### 1.4 验证 FreeSeek 正常运行

```bash
# 检查模型列表
curl http://localhost:3000/v1/models

# 测试对话
curl http://localhost:3000/v1/chat/completions \
  -H "Content-Type: application/json" \
  -d '{"model":"deepseek-chat","messages":[{"role":"user","content":"你好"}],"stream":false}'
```

如果返回正常的 JSON 响应，说明 FreeSeek 已就绪。

---

## 第二部分：安装 OpenClaw

### 2.1 环境要求

- Node.js >= 22.12.0
- pnpm >= 9.0.0

```bash
# 安装 pnpm（如果没有）
npm install -g pnpm

# 检查版本
node -v    # 需要 >= 22.12.0
pnpm -v    # 需要 >= 9.0.0
```

> 如果 Node.js 版本过低，用 nvm 升级：
>
> ```bash
> curl -o- https://raw.githubusercontent.com/nvm-sh/nvm/v0.40.0/install.sh | bash
> source ~/.bashrc
> nvm install 22
> nvm use 22
> ```

### 2.2 克隆与编译

```bash
cd ~
git clone https://github.com/linuxhsj/openclaw-zero-token.git
cd openclaw-zero-token

# 安装依赖
pnpm install

# 编译
pnpm build
```

编译成功后会生成 `dist/` 目录。

---

## 第三部分：配置 OpenClaw 对接 FreeSeek（关键步骤）

### 3.1 确定配置方式

OpenClaw 有两种配置路径，**必须保持一致**，否则会出现 "Connection error"：

| 方式 | 配置文件路径 | 适用场景 |
|------|-------------|---------|
| 项目脚本（`./server.sh`） | `项目目录/.openclaw-state/openclaw.json` | 通过项目脚本管理 |
| 全局命令（`openclaw`） | `~/.openclaw/openclaw.json` | 全局安装后直接使用 |

**推荐方式：使用全局命令 + 全局配置**，更简单不容易出错。

### 3.2 创建配置文件

```bash
# 创建配置目录
mkdir -p ~/.openclaw

# 写入配置
cat > ~/.openclaw/openclaw.json << 'CONF'
{
  "models": {
    "mode": "merge",
    "providers": {
      "freeseek": {
        "baseUrl": "http://localhost:3000/v1",
        "api": "openai-completions",
        "apiKey": "any-value-here",
        "models": [
          {
            "id": "deepseek-chat",
            "name": "DeepSeek V3 (FreeSeek)",
            "reasoning": false,
            "input": ["text"],
            "cost": { "input": 0, "output": 0, "cacheRead": 0, "cacheWrite": 0 },
            "contextWindow": 64000,
            "maxTokens": 8192
          },
          {
            "id": "deepseek-reasoner",
            "name": "DeepSeek R1 (FreeSeek)",
            "reasoning": true,
            "input": ["text"],
            "cost": { "input": 0, "output": 0, "cacheRead": 0, "cacheWrite": 0 },
            "contextWindow": 64000,
            "maxTokens": 8192
          },
          {
            "id": "deepseek-chat-search",
            "name": "DeepSeek V3 + 搜索 (FreeSeek)",
            "reasoning": false,
            "input": ["text"],
            "cost": { "input": 0, "output": 0, "cacheRead": 0, "cacheWrite": 0 },
            "contextWindow": 64000,
            "maxTokens": 8192
          },
          {
            "id": "claude-sonnet-4-6",
            "name": "Claude Sonnet 4 (FreeSeek)",
            "reasoning": false,
            "input": ["text", "image"],
            "cost": { "input": 0, "output": 0, "cacheRead": 0, "cacheWrite": 0 },
            "contextWindow": 200000,
            "maxTokens": 8192
          },
          {
            "id": "claude-opus-4-6",
            "name": "Claude Opus 4 (FreeSeek)",
            "reasoning": false,
            "input": ["text", "image"],
            "cost": { "input": 0, "output": 0, "cacheRead": 0, "cacheWrite": 0 },
            "contextWindow": 200000,
            "maxTokens": 8192
          },
          {
            "id": "claude-haiku-4-6",
            "name": "Claude Haiku 4 (FreeSeek)",
            "reasoning": false,
            "input": ["text", "image"],
            "cost": { "input": 0, "output": 0, "cacheRead": 0, "cacheWrite": 0 },
            "contextWindow": 200000,
            "maxTokens": 8192
          }
        ]
      }
    }
  },
  "agents": {
    "defaults": {
      "model": {
        "primary": "freeseek/deepseek-chat"
      }
    }
  },
  "gateway": {
    "mode": "local",
    "port": 18789
  }
}
CONF

echo "配置文件已写入 ~/.openclaw/openclaw.json"
```

### 3.3 配置说明

| 字段 | 值 | 说明 |
|------|---|------|
| `baseUrl` | `http://localhost:3000/v1` | FreeSeek 的 API 地址，必须带 `/v1` |
| `api` | `openai-completions` | FreeSeek 是 OpenAI 兼容接口，必须用这个值 |
| `apiKey` | `any-value-here` | FreeSeek 默认不鉴权，但 OpenClaw 要求此字段非空，随便填 |
| `models` | 数组 | 必须显式声明要用的模型，不能为空 |
| `agents.defaults.model.primary` | `freeseek/deepseek-chat` | 默认使用的模型，格式为 `provider名/模型ID` |
| `gateway.port` | `18789` | Gateway 端口，不设的话 OpenClaw 会自动分配随机端口 |

**可用模型 ID 对照表**（取决于 FreeSeek 侧配置的凭证）：

| 模型 ID | 说明 | 需要的凭证 |
|---------|------|-----------|
| `deepseek-chat` | DeepSeek V3 对话 | DeepSeek |
| `deepseek-reasoner` | DeepSeek R1 深度思考 | DeepSeek |
| `deepseek-chat-search` | V3 + 联网搜索 | DeepSeek |
| `deepseek-reasoner-search` | R1 + 联网搜索 | DeepSeek |
| `claude-sonnet-4-6` | Claude Sonnet 4 | Claude |
| `claude-opus-4-6` | Claude Opus 4 | Claude |
| `claude-haiku-4-6` | Claude Haiku 4 | Claude |

### 3.4 切换默认模型

编辑 `~/.openclaw/openclaw.json`，修改 `primary` 字段：

```json
"agents": {
  "defaults": {
    "model": {
      "primary": "freeseek/deepseek-reasoner"
    }
  }
}
```

---

## 第四部分：启动与使用

### 4.1 启动顺序

**必须先启动 FreeSeek，再启动 OpenClaw**。

```bash
# 第 1 步：确认 FreeSeek 在运行
curl -s http://localhost:3000/v1/models | head -c 200
# 如果没运行，先启动：
# cd ~/freeseek && npm run web:start

# 第 2 步：启动 OpenClaw Gateway（后台运行）
cd ~/openclaw-zero-token
nohup node dist/index.mjs gateway > /tmp/openclaw-gateway.log 2>&1 &
echo "Gateway PID: $!"

# 等待 2 秒启动完成
sleep 2

# 第 3 步：验证 Gateway 在运行
ss -tlnp | grep 18789
```

### 4.2 使用方式

**命令行对话**：

```bash
# 单条消息
openclaw agent --agent main --message "你好，介绍一下你自己"

# 交互式 TUI
openclaw tui
```

**通过 Gateway API 调用**：

```bash
curl http://localhost:18789/v1/chat/completions \
  -H "Content-Type: application/json" \
  -d '{
    "model": "freeseek/deepseek-chat",
    "messages": [{"role": "user", "content": "你好"}],
    "stream": false
  }'
```

**Web UI**：

浏览器打开 `http://localhost:18789`

### 4.3 停止服务

```bash
# 停止 OpenClaw Gateway
pkill -f "openclaw-gateway" || pkill -f "dist/index.mjs gateway"

# 停止 FreeSeek（如果需要）
pkill -f "server-standalone"
```

---

## 第五部分：常见问题排查

### Q: "Connection error" 怎么解决？

**原因**：agent 命令找不到 Gateway 或 Gateway 连不到 FreeSeek。

排查步骤：

```bash
# 1. FreeSeek 是否在运行？
curl http://localhost:3000/v1/models

# 2. Gateway 是否在运行？在什么端口？
ss -tlnp | grep openclaw

# 3. Gateway 能否连到 FreeSeek？通过 Gateway 端口直接调用
curl http://localhost:18789/v1/chat/completions \
  -H "Content-Type: application/json" \
  -d '{"model":"freeseek/deepseek-chat","messages":[{"role":"user","content":"test"}],"stream":false}'

# 4. 查看 Gateway 日志
cat /tmp/openclaw-gateway.log
```

### Q: 配置文件到底放哪里？

OpenClaw 按以下优先级查找配置：

```
环境变量 OPENCLAW_CONFIG_PATH（最高优先级）
  ↓ 没设置则
环境变量 OPENCLAW_STATE_DIR/openclaw.json
  ↓ 没设置则
~/.openclaw/openclaw.json（默认位置）
```

**关键**：你的 Gateway 进程和 agent 命令必须读同一个配置文件。
如果用 `server.sh` 启动了 Gateway（它设置了 `OPENCLAW_CONFIG_PATH` 指向项目目录），
但你直接运行 `openclaw agent`（它读 `~/.openclaw/openclaw.json`），就会对不上。

**最简单的解决方法**：统一用 `~/.openclaw/openclaw.json`，不用 `server.sh`。

### Q: 为什么模型列表里看不到 FreeSeek 的模型？

检查配置：

1. `apiKey` 不能为空（即使 FreeSeek 不需要鉴权，OpenClaw 内部要求非空）
2. `api` 必须是 `"openai-completions"`
3. `models` 数组不能为空，要显式列出模型
4. `baseUrl` 必须带 `/v1` 后缀

### Q: deepseek-reasoner 的思考链内容怎么处理？

FreeSeek 会在流式响应中返回 `reasoning_content` 字段。如果 OpenClaw 显示异常，可以在 FreeSeek 请求中加 `strip_reasoning: true` 过滤掉思考链（需在 FreeSeek 侧配置，或通过请求头 `x-strip-reasoning: true`）。

### Q: FreeSeek 端口被占用？

```bash
# 查看占用端口的进程
lsof -i :3000
# 或
ss -tlnp | grep 3000

# 杀掉占用进程
kill -9 <PID>
```

### Q: FreeSeek 和 OpenClaw Gateway 端口冲突？

FreeSeek Web 模式的管理面板默认端口也是 3001，如果 OpenClaw Gateway 也用 3001 会冲突。解决方法：

- 方式一：FreeSeek 换端口 → `node dist/main/server-standalone.js --admin-port 3002`
- 方式二：OpenClaw 换端口 → 配置 `"gateway": { "port": 18789 }`（推荐，已在上面的配置中使用）

### Q: 凭证过期了怎么办？

DeepSeek 和 Claude 的网页版会话有有效期。过期后重新获取凭证：

- **桌面模式**：点击 FreeSeek 的「启动自动捕获」重新登录
- **Web 模式 / 服务器**：在 FreeSeek 管理面板（`http://服务器:3001`）手动粘贴新凭证

OpenClaw 侧不需要任何修改，因为 FreeSeek 会自动使用最新凭证。

---

## 附录：一键启动脚本

创建一个脚本方便日常使用：

```bash
cat > ~/start-openclaw.sh << 'SCRIPT'
#!/bin/bash
# 一键启动 FreeSeek + OpenClaw

echo "=== 检查 FreeSeek ==="
if curl -s http://localhost:3000/v1/models > /dev/null 2>&1; then
  echo "FreeSeek 已在运行"
else
  echo "FreeSeek 未运行，正在启动..."
  cd ~/freeseek
  nohup npm run web:start > /tmp/freeseek.log 2>&1 &
  sleep 3
  if curl -s http://localhost:3000/v1/models > /dev/null 2>&1; then
    echo "FreeSeek 启动成功"
  else
    echo "FreeSeek 启动失败，请检查 /tmp/freeseek.log"
    exit 1
  fi
fi

echo ""
echo "=== 检查 OpenClaw Gateway ==="
if ss -tlnp 2>/dev/null | grep -q 18789; then
  echo "OpenClaw Gateway 已在运行"
else
  echo "Gateway 未运行，正在启动..."
  cd ~/openclaw-zero-token
  nohup node dist/index.mjs gateway > /tmp/openclaw-gateway.log 2>&1 &
  sleep 2
  if ss -tlnp 2>/dev/null | grep -q 18789; then
    echo "OpenClaw Gateway 启动成功"
  else
    echo "Gateway 启动失败，请检查 /tmp/openclaw-gateway.log"
    exit 1
  fi
fi

echo ""
echo "=== 全部就绪 ==="
echo "FreeSeek API:    http://localhost:3000/v1"
echo "OpenClaw Gateway: http://localhost:18789"
echo ""
echo "使用方式："
echo "  openclaw agent --agent main --message '你好'"
echo "  openclaw tui"
SCRIPT

chmod +x ~/start-openclaw.sh
```

每次开机后运行 `~/start-openclaw.sh` 即可。
