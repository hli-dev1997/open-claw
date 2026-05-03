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

| 字段 | 值 |
|------|-----|
| Name | `openclaw-attach` |
| Host | `localhost` |
| Port | `9230` |

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
