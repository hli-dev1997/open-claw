# OpenClaw TypeScript 断点调试环境搭建指南

> 作者：OpenClaw 架构团队  
> 日期：2026-05-03  
> 适用版本：OpenClaw 2026.4.30+

---

## 一、背景与现象

在 IDEA 中以 Debug 模式启动 `run-node.mjs` 后，在 TypeScript 源文件（如 `agent-runner-execution.ts`）上打断点，但断点从不触发——即使同一位置的 `console.log` 能正常打印。

**具体表现：**

- `console.log("🔴 断点测试：...")` 出现在控制台 ✅
- IDEA 断点红点显示正常，但代码执行时直接跳过，不暂停 ❌
- 变量面板无任何信息展示 ❌

---

## 二、根本原因分析

### 原因一：调试器挂载在错误的进程上

OpenClaw 的启动结构是**两层进程**：

```
IDEA Debug
  └─→ 启动 run-node.mjs (父进程, --inspect=9229)
            └─→ spawn openclaw.mjs (子进程, 真正运行业务代码)
```

IDEA 的 `--inspect=9229` 注入到了父进程 `run-node.mjs`，调试器连接的也是父进程。但 TypeScript 源代码（`agent-runner-execution.ts` 等）实际运行在**子进程** `openclaw.mjs` 中。断点打在子进程的代码上，却连的是父进程的调试器，自然永远不会命中。

### 原因二：子进程未启用 source map

即使调试器连上了子进程，默认情况下 Node.js **不会加载** `.js.map` 文件。TypeScript 编译产物（`dist/*.js`）的行号与源码（`src/*.ts`）不一致，IDEA 无法对应断点位置。

必须在 Node.js 启动参数中加入 `--enable-source-maps`，才能让运行时读取 source map，实现 `.ts` ↔ `.js` 行号映射。

---

## 三、Web UI 消息的真实调用链

> 这是本次调试中另一个重要发现：`agentCommandInternal` 根本不在 Web UI 的调用链上。

```
Web UI (http://127.0.0.1:18789)
  │
  │  WebSocket RPC
  ▼
chat.send 处理器
  [src/gateway/server-methods/chat.ts]
  │
  ▼
dispatchInboundMessage()
  [src/auto-reply/dispatch.ts]
  │
  ▼
getReplyFromConfig()
  [src/auto-reply/reply/get-reply.ts]
  │
  ▼
runPreparedReply()
  [src/auto-reply/reply/get-reply-run.ts]
  │
  ▼
runReplyAgent()
  [src/auto-reply/reply/agent-runner.ts]
  │
  ▼
runAgentTurnWithFallback()        ← ✅ 正确的断点位置入口
  [src/auto-reply/reply/agent-runner-execution.ts:871]
  │
  ▼
runEmbeddedPiAgent()              ← 实际调用模型的地方
  [src/agents/pi-embedded.js]
```

**注意**：`agentCommandInternal`（位于 `src/agents/agent-command.ts`）只在以下场景被调用：

- CLI 命令行调用
- TUI 终端界面
- OpenAI 兼容 HTTP 接口（`/v1/chat/completions`）
- OpenResponses HTTP 接口

Web UI 的 `chat.send` 走的是完全独立的 auto-reply 管道，**绕过了** `agentCommandInternal`。

---

## 四、解决方案

### 4.1 修改 `scripts/run-node.mjs`

让子进程在父进程为 debug 模式时，自动在 **9230 端口**暴露调试接口，并始终开启 source map：

```javascript
// 修改前
const runOpenClaw = async (deps) => {
  const nodeProcess = deps.spawn(deps.execPath, ["openclaw.mjs", ...deps.args], {
    ...
  });
```

```javascript
// 修改后
const runOpenClaw = async (deps) => {
  // 调试模式：如果父进程带了 --inspect，子进程用 9230 端口继续暴露调试接口
  const parentArgs = process.execArgv ?? [];
  const isDebugMode = parentArgs.some(a => a.startsWith("--inspect") || a.startsWith("--debug"));
  const debugArgs = isDebugMode
    ? ["--inspect=9230", "--enable-source-maps"]
    : ["--enable-source-maps"];
  const nodeProcess = deps.spawn(deps.execPath, [...debugArgs, "openclaw.mjs", ...deps.args], {
    ...
  });
```

**关键点：**

- `process.execArgv` 包含父进程自身的 Node.js 参数（如 `--inspect=9229`）
- 子进程用 **不同端口**（9230）避免冲突
- `--enable-source-maps` 无条件添加，让错误堆栈始终显示 `.ts` 真实行号

### 4.2 在 IDEA 中新增 Attach 配置

`Run → Edit Configurations → + → Attach to Node.js/Chrome`

| 字段 | 值                |
| ---- | ----------------- |
| Name | `openclaw-attach` |
| Host | `localhost`       |
| Port | `9230`            |

---

## Gateway（网关）详解

### Gateway 是什么？

Gateway 是 OpenClaw 的**核心服务进程**，所有外部通信都经由它。启动 OpenClaw 服务端本质上就是启动 Gateway：

```bash
node scripts/run-node.mjs gateway --allow-unconfigured
```

IDEA 调试配置中的 Application parameters 也是 `gateway --allow-unconfigured`，其中：

- `gateway` — 启动网关模式
- `--allow-unconfigured` — 允许在未完整配置的情况下启动（开发调试用）

---

### Gateway 启动序列

```
scripts/run-node.mjs
  │  检测 dist 是否过期 → 自动重新构建 TypeScript
  │  运行 runtime-postbuild（插件元数据、SDK alias、官方 channel catalog 等）
  ▼
dist/openclaw.mjs  （子进程，真正的业务进程）
  │
  ▼
startGatewayServer()
  [src/gateway/server.impl.ts]
  │
  ├─ runtime.config      解析端口、bind 地址、auth 模式、TLS 配置
  ├─ plugins.bootstrap   加载所有插件（acpx、deepseek、openai 等）
  ├─ control-ui.root     定位 Control UI 静态资源（dist/control-ui/）
  ├─ runtime.state       创建运行时状态（WebSocket 连接池、chat 状态机等）
  ├─ canvas              启动 Canvas Host（内嵌浏览器画布）
  ├─ http.listen         绑定 HTTP 端口（默认 18789）
  └─ channels            启动插件 channel 服务（心跳、自动回复等）
```

---

### Gateway 对外暴露的接口

| 接口类型           | 路径                                          | 说明                                      |
| ------------------ | --------------------------------------------- | ----------------------------------------- |
| Control UI         | `http://127.0.0.1:18789/`                     | 浏览器对话界面（Lit 组件，Vite 构建）     |
| WebSocket RPC      | `ws://127.0.0.1:18789/__openclaw/ws`          | 前端所有 RPC 方法（`chat.send` 等）走这里 |
| OpenAI 兼容 HTTP   | `POST /v1/chat/completions`                   | 兼容 OpenAI SDK 调用（需配置开启）        |
| OpenResponses HTTP | `POST /v1/responses`                          | OpenResponses 协议（需配置开启）          |
| Embeddings HTTP    | `POST /v1/embeddings`                         | Embeddings 接口                           |
| Plugin HTTP        | `/__openclaw/plugins/*`                       | 各插件自定义 HTTP 路由                    |
| Canvas Host        | `http://127.0.0.1:18789/__openclaw__/canvas/` | 内嵌 Canvas 宿主                          |
| Hooks              | `/__openclaw/hooks/*`                         | 生命周期钩子回调端点                      |
| Health             | `/__openclaw/health`                          | 健康检查                                  |

---

### Web UI 消息与 HTTP API 的调用链区别

这是本次排查中最关键的发现，两条路径**完全独立**：

```
┌──────────────────────────────────────────────────────────────────────┐
│ 路径 A：Web UI（Control UI 浏览器对话）                              │
│                                                                      │
│  浏览器 → WebSocket  chat.send  RPC                                  │
│        → dispatchInboundMessage()   [auto-reply/dispatch.ts]         │
│        → getReplyFromConfig()       [auto-reply/reply/get-reply.ts]  │
│        → runReplyAgent()            [auto-reply/reply/agent-runner.ts]│
│        → runAgentTurnWithFallback() ← 调试断点打这里                 │
│        → runEmbeddedPiAgent()       ← 实际发起 LLM API 请求         │
└──────────────────────────────────────────────────────────────────────┘

┌──────────────────────────────────────────────────────────────────────┐
│ 路径 B：HTTP API（OpenAI SDK / curl 直接调用）                       │
│                                                                      │
│  POST /v1/chat/completions                                           │
│        → openai-http.ts handler                                      │
│        → agentCommandFromIngress()                                   │
│        → agentCommandInternal()     ← 调试断点打这里                 │
│        → (ACP 路径) acpManager.runTurn()                             │
│           或 (embedded 路径) runAgentAttempt()                       │
└──────────────────────────────────────────────────────────────────────┘
```

> **结论**：在 `agentCommandInternal` 里加断点，对 Web UI 发的消息**永远不会触发**。Web UI 走的是 auto-reply 管道，与 HTTP API 路径完全分离。

---

### `--allow-unconfigured` 的作用

正常情况下 Gateway 启动时会校验配置完整性（API Key、频道配置等）。`--allow-unconfigured` 绕过这个检查，适用于：

- 本地开发调试
- 仅配置了部分 Provider 时也能启动
- CI/CD 环境测试

---

#### 1.先运行启动

![image-20260503192138484](https://notes-1307435281.cos.ap-shanghai.myqcloud.com/note/master/202605031921647.png)

#### 2.再运行调试

![image-20260503192152186](https://notes-1307435281.cos.ap-shanghai.myqcloud.com/note/master/202605031921242.png)

## 五、调试启动流程

```
步骤 1: 点击 run-node.mjs 的 Debug 按钮（绿色虫子）
  │
  ▼
步骤 2: 等待控制台输出：
  "Debugger listening on ws://127.0.0.1:9230/..."
  │
  ▼
步骤 3: 点击 openclaw-attach 的 Debug 按钮（Attach）
  │
  ▼
步骤 4: 控制台出现第二行 "Debugger attached."
  │
  ▼
步骤 5: 在任意 .ts 源文件打断点
  │
  ▼
步骤 6: 从 Web UI 发送消息 → 断点命中 ✅
```

---

## 六、验证结果

断点成功在 `agent-runner-execution.ts:1407` 命中，IDEA 变量面板展示：

```
embeddedContext = {
  sessionId: "ff867bc6-bd4b-4e56-9bff-014b5fc7a99d",
  sessionKey: "agent:main:main",
  sandboxSessionKey: "agent:main:main",
  agentId: "main",
  messageProvider: "heartbeat" | "user",
  ...
}
```

---

## 七、附：工具传递链路分析

在排查过程中还发现：`runEmbeddedPiAgent` 调用时 `embeddedContext.tools` 为 `[]`（空数组），但最终发给模型的 tools 有 28 个（含 `web_search`）。说明 tools 是在 `runEmbeddedPiAgent` **内部**动态组装的，不是从外层传入的。

```
runEmbeddedPiAgent 调用时:
  embeddedContext.tools = []   ← 入参为空，正常

模型 API 调用时:
  tools(28) = [agents_list, browser, canvas, ..., web_search, write]
              ↑ 在 pi-embedded-runner 内部组装完成
```

---

## 八、常见问题

**Q: 为什么 console.log 能打印但断点不触发？**  
A: console.log 输出到 stdout，不需要调试器。断点依赖 V8 Inspector Protocol 连接，连错进程就不触发。

**Q: 每次重启都要重新 Attach 吗？**  
A: 是的。每次重启服务，子进程会分配新的 WebSocket UUID，需要重新点击 `openclaw-attach` 的 Debug 按钮。可勾选 "Reconnect automatically" 减少手动操作。

**Q: `--enable-source-maps` 会影响性能吗？**  
A: 有轻微影响（source map 加载有内存开销），但对开发环境可忽略不计。生产部署时去掉即可。

**Q: 如果断点打在 `agentCommandInternal` 里但不触发怎么办？**  
A: 检查请求入口——Web UI 走 `chat.send` RPC 管道，不经过 `agentCommandInternal`。只有 CLI/TUI/HTTP API 才走那条路径。
