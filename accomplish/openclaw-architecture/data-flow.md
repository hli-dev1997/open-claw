# OpenClaw 数据流转架构文档

> 以"问天气"为例，跟踪一条消息从输入到输出的完整路径

---

## 目录

1. [总体架构分层](#1-总体架构分层)
2. [启动流程](#2-启动流程)
3. [消息输入→路由](#3-消息输入路由)
4. [会话管理与恢复](#4-会话管理与恢复)
5. [Agent 执行循环](#5-agent-执行循环)
6. [系统提示词构建](#6-系统提示词构建)
7. [工具定义与执行](#7-工具定义与执行)
8. [LLM API 调用](#8-llm-api-调用)
9. [流式输出处理](#9-流式输出处理)
10. [回复投递](#10-回复投递)
11. [完整链路图](#11-完整链路图)
12. [核心文件索引](#12-核心文件索引)

---

## 1. 总体架构分层

```
┌─────────────────────────────────────────────────────────┐
│                     Channel Layer                       │
│   (webchat / WhatsApp / Telegram / Discord / ...)       │
├─────────────────────────────────────────────────────────┤
│                    Routing Layer                         │
│      (账号解析 → 会话绑定 → 会话键路由)                    │
├─────────────────────────────────────────────────────────┤
│                    Session Layer                         │
│     (会话状态 → 消息历史 → 持久化 / 压缩)                  │
├─────────────────────────────────────────────────────────┤
│                    Agent Layer (PI Engine)               │
│  (系统提示词 → LLM API → 工具调度 → 流式处理 → 回复)      │
├─────────────────────────────────────────────────────────┤
│                  Plugin / Tool Layer                     │
│  (内置工具 / MCP / 技能 / 扩展 / exec / web / ...)       │
├─────────────────────────────────────────────────────────┤
│                    Provider Layer                        │
│    (OpenAI / Anthropic / DeepSeek / Vertex / ...)        │
└─────────────────────────────────────────────────────────┘
```

---

## 2. 启动流程

用户执行 `openclaw start` 时的启动链：

### 2.1 CLI 入口
- **文件**: `packages/cli/src/openclaw.ts`
- CLI 解析命令参数，调用 `startGatewayServer()`

### 2.2 Gateway 启动
- **文件**: `src/gateway/server.ts` → 导出 `startGatewayServer`
- **文件**: `src/gateway/server.impl.ts` → `startGatewayServer()`
  - `prepareGatewayStartupConfig()` — 加载配置
  - `startGatewayEarlyRuntime()` — 初始化日志、事件循环
  - `startGatewayPluginDiscovery()` — 发现并加载插件
  - `loadGatewayStartupPluginRuntime()` — 初始化插件运行时
  - `startChannelPlugins()` — 启动各通道插件（webchat 等）
  - `loadGatewayModelCatalog()` — 加载模型目录
  - `startGatewayRuntimeServices()` — 启动 cron / heartbeat 等后台服务
  - `attachGatewayWsHandlers()` — 挂载 WebSocket 路由

### 2.3 Boot 检查
- **文件**: `src/gateway/boot.ts`
- 检查是否存在 `BOOT.md`，按需执行首次启动引导

---

## 3. 消息输入→路由

以你通过 WebChat 发送 `"今天上海浦东天气怎么样？"` 为例：

### 3.1 WebSocket 接入
- **文件**: `src/gateway/server-ws-runtime.ts`
- WebChat 通过浏览器 WebSocket 连接到 Gateway
- 消息数据包经 ws handler 反序列化，构建 `InboundMessage`

### 3.2 Channel Turn 处理
- **文件**: `src/channels/turn/kernel.ts` → `dispatchAssembledChannelTurn()`
  - `buildChannelTurnContext()` — 构建通道上下文（channel、accountId、sender 等元数据）
  - 执行准入检查（`ChannelTurnAdmission`：dispatch / observeOnly / drop）
  - 调用 `dispatchReplyWithBufferedBlockDispatcher()` — 进入回复调度

### 3.3 路由解析
- **文件**: `src/routing/resolve-route.ts`
- **文件**: `src/routing/session-key.ts` → `resolveSessionKeyForRequest()`
  - 根据 channel + sender 解析出 `sessionKey`（例如 `webchat:default`）
  - 如果是新对话则创建新 sessionKey
  - 绑定线程/会话 ID

### 3.4 加载会话状态
- **文件**: `src/gateway/server-chat.load-gateway-session-row.runtime.ts` → `loadGatewaySessionRow()`
- **文件**: `src/gateway/server-chat.ts` → `createChatRunState()` / `createChatRunRegistry()`
  - 从磁盘恢复历史消息
  - 若会话历史过长，触发 compaction（压缩/摘要）
  - 初始化 `ChatRunState`

---

## 4. 会话管理与恢复

### 4.1 会话存储
- **文件**: `src/config/sessions/store.ts`
- 会话存储在 `~/.openclaw/sessions/` 目录下，JSON 格式
- 每次 Agent 运行完成后，将最新消息写入存储

### 4.2 消息历史管理
- **文件**: `src/agents/pi-embedded-runner/run/incomplete-turn.ts`
- 维护消息序列：system + user + assistant(tool_call) + tool_result + assistant(text)
- 超长会话通过 `compaction`（`src/agents/pi-embedded-runner/compaction-hooks.ts`）摘要历史

### 4.3 读写锁
- **文件**: `src/session-write-lock.ts` → `acquireSessionWriteLock()`
- 防止同一会话被并发写入

---

## 5. Agent 执行循环

当消息准备好后，进入核心 Agent 执行流程：

### 5.1 Runner 入口
- **文件**: `src/agents/pi-embedded-runner/run.ts` → `runEmbeddedPiAgent()`
  1. `resolveAgentExecutionContract()` — 解析 Agent 配置
  2. `resolveModelAsync()` — 选择模型（考虑 fallback）
  3. `resolveAuthProfileEligibility()` — 认证配置
  4. `ensureRuntimePluginsLoaded()` — 确保运行时插件加载
  5. `resolveSessionLane()` — 分配执行通道

### 5.2 Attempt 构建
- **文件**: `src/agents/pi-embedded-runner/run/attempt.ts` → 核心执行方法

这个方法极其庞大，负责：
1. **构建系统提示词** — 组装完整 system prompt
2. **注入上下文文件** — AGENTS.md / SOUL.md / USER.md / MEMORY.md / skill 文件
3. **注册工具定义** — 收集所有可用工具的 schemas
4. **构建消息列表** — user message + 历史消息 → 格式化
5. **调用 Harness** → LLM API
6. **处理流式输出** → 提取文本 + tool calls
7. **执行工具** → 循环直到最终回复

### 5.3 Harness 选择
- **文件**: `src/agents/harness/selection.ts` → `selectAgentHarness()`
- 默认使用 PI （`createPiAgentHarness()` → `runEmbeddedAttempt()`）
- 也可选择插件提供的 harness（如 Codex ACP）

### 5.4 执行循环（Tool Loop）

```
while (需要继续执行):
    1. 构建标准消息格式 (system + messages)
    2. 调用 LLM API → 获取 stream
    3. 解析流式输出:
       - 提取 assistant 文本
       - 提取 tool_use block
    4. 若有 tool_use:
       a. 分发工具调用到对应 plugin
       b. 等待 tool_result
       c. 将 tool_result 追加到消息列表
       d. 回到步骤 1
    5. 若无 tool_use:
       → 最终文本输出，结束循环
```

---

## 6. 系统提示词构建

### 6.1 主入口
- **文件**: `src/agents/system-prompt.ts` → `buildSystemPrompt()`/`buildSystemPromptReport()`

### 6.2 提示词组成

以"问天气"为例，最终发给 LLM 的 system prompt 包含（按实际生成顺序）：

```
## 身份
[Agent 名称 / SOUL.md / IDENTITY.md 内容]

## 日期时间
当前日期时间: 2026-05-02 04:30 Asia/Shanghai

## 工作区文件
[AGENTS.md → SOUL.md → IDENTITY.md → USER.md → TOOLS.md → MEMORY.md]
按 CONTEXT_FILE_ORDER 排序注入

## 技能定义
[skills/weather/SKILL.md 中定义的 weather 技能]
→ resolveSkillsPromptForRun() 在 src/agents/skills.ts

## 工具定义
[所有可用工具的 JSON Schema 列表]
→ 来自 src/plugins/tools.ts → getPluginToolMeta()

## 消息通道能力
[webchat 通道支持哪些操作]
→ src/agents/channel-tools.ts → resolveChannelMessageToolHints()

## 会话历史摘要
[之前的对话消息 / heartbeat 记录]
→ src/agents/heartbeat-system-prompt.ts
```

### 6.3 上下文文件处理
- **文件**: `src/agents/bootstrap-files.ts` → `resolveBootstrapContextForRun()`
- 文件按优先级排序：`agents.md(10) > soul.md(20) > identity.md(30) > user.md(40) > tools.md(50) > bootstrap.md(60) > memory.md(70)`
- 超过 token 预算的文件会被截断

---

## 7. 工具定义与执行

### 7.1 工具注册
- **文件**: `src/plugins/tools.ts` → `getPluginToolMeta()`
- 每个插件（browser / exec / web / message / ...）注册自己的 tool definitions
- 工具 definition 包含：name, description, input_schema (JSON Schema)
- **文件**: `src/agents/pi-tools.ts` → `createOpenClawCodingTools()` — 创建 Agent 可用的工具列表

### 7.2 工具过滤与策略
- **文件**: `src/agents/pi-tools.policy.ts` → `resolveEffectiveToolPolicy()`
- 根据 Agent 配置和通道限制，允许/禁止某些工具

### 7.3 工具调度
当 LLM 返回 `tool_use` block 时：
1. **文件**: `src/agents/pi-embedded-subscribe.ts` → `subscribeEmbeddedPiSession()` 中的事件处理
2. 工具调用经 `plugin-system` 分发到具体实现
3. 对应工具执行后返回 `tool_result`
4. tool_result 被加入下一轮 LLM 调用的消息列表

### 7.4 以 weather 工具为例
```
LLM 返回: tool_use(name="exec", input={command: "curl wttr.in/Shanghai?...", ...})
  │
  ▼
工具分发 (src/agents/pi-tools.ts)
  │
  ▼
exec 工具 (src/agents/bash-tools.ts)
  │  → bash-tools.exec.ts → runCommandExecute()
  │  → spawn child process → curl.exe ...
  │  → 捕获 stdout / stderr
  │
  ▼
tool_result: 天气数据 JSON
  │
  ▼
下一轮 LLM 调用 (包含 tool_result)
  │
  ▼
LLM 理解数据 → 生成自然语言回复
```

---

## 8. LLM API 调用

### 8.1 Provider 层
- **文件**: `src/agents/provider-stream.ts` → `registerProviderStreamForModel()`
- 根据 model id 选择 provider（DeepSeek / OpenAI / Anthropic / ...）

### 8.2 认证配置
- **文件**: `src/agents/model-auth.ts` → `resolveAuthProfileOrder()`
- 支持多个 API key、fallback、rate limit 控制

### 8.3 流式传输
- **文件**: `src/agents/anthropic-transport-stream.ts` — Anthropic/兼容 API 的流式传输
- 使用 Server-Sent Events (SSE) 接收 LLM 的流式输出
- 实时解析：text delta / thinking / tool_use begin/end / content_block

### 8.4 模型选择
- **文件**: `src/agents/pi-embedded-runner/run/setup.ts` → `resolveEffectiveRuntimeModel()`
- 配置的 model + fallback 链 + failover 策略

### 8.5 以"问天气"为例的模型调用
```
系统提示词 (~8K tokens)
  ├── 身份/描述 ~200B
  ├── 工作区文件 ~5KB
  ├── weather 技能文档 ~2KB
  ├── 工具定义 (exec / web_search / ...) ~3KB
  ├── 消息通道能力 ~500B
  └── 会话历史 ~1KB
  │
  + 用户消息 "今天上海浦东天气怎么样？" (~20B)
  │
  ▼
DeepSeek V4 Flash API (SSE stream)
  │
  ▼
流式响应:
  ├── thinking block → 推理过程
  ├── tool_use("exec") → curl wttr.in/Shanghai
  ├── tool_result → 天气 JSON
  └── assistant text → 最终回复中文天气描述
```

---

## 9. 流式输出处理

### 9.1 订阅器
- **文件**: `src/agents/pi-embedded-subscribe.ts` → `subscribeEmbeddedPiSession()`
- 这是关键的实时输出处理器

### 9.2 流式事件
订阅器处理以下事件：
| 事件 | 描述 |
|------|------|
| `assistant_text` | 增量文本片段 |
| `reasoning` | 推理/thinking 内容 |
| `tool_use` | 工具调用开始 |
| `tool_result` | 工具返回结果 |
| `content_block_stop` | 内容块结束 |
| `message_stop` | 消息结束 |

### 9.3 实时推送
- 在流式过程中，通过 WebSocket 实时推送 `assistant_text` 和 `reasoning` 到客户端
- **文件**: `src/auto-reply/reply/reply-directives.ts` — 控制回复格式（MARKDOWN / NO_REPLY / MEDIA 等）
- 最终文本通过 `projectLiveAssistantBufferedText()` 合并推送

---

## 10. 回复投递

### 10.1 组装回复
- **文件**: `src/auto-reply/reply-payload.ts` → `setReplyPayloadMetadata()`
- Agent 最终文本 → 格式化为 `ReplyPayload`

### 10.2 通道投递
- **文件**: `src/channels/turn/kernel.ts` → `deliver()` 
- **文件**: `src/auto-reply/reply/dispatcher-registry.ts` → 管理待投递回复队列
- WebChat 通道：通过 WebSocket 将回复文本推送回浏览器

### 10.3 消息工具（message tool）
当 Agent 使用 `message` 工具主动发送消息时：
- **文件**: `src/channels/plugins/message-tool-api.ts` → `MessageToolApi`
- **文件**: `src/agents/channel-tools.ts` → 将 message tool 注册为可用工具
- 这允许 Agent 跨通道主动发消息（例如在 WhatsApp 回复用户）

### 10.4 回复格式
- text / markdown
- MEDIA 指令 → 图片/文件附件
- NO_REPLY 指令 → 静默回复
- 推理内容 → 可选的 reasoning 显示

---

## 11. 完整链路图

```
你（WebChat 浏览器）
  │ "今天上海浦东天气怎么样？"
  ▼
① WebSocket 接收
  src/gateway/server-ws-runtime.ts
  ▼
② Channel Turn 调度
  src/channels/turn/kernel.ts → dispatchAssembledChannelTurn()
  ▼
③ 路由 → 会话键
  src/routing/resolve-route.ts
  src/routing/session-key.ts → resolveSessionKeyForRequest()
  ▼
④ 加载会话 (历史消息)
  src/gateway/server-chat.load-gateway-session-row.runtime.ts
  ▼
⑤ Agent Runner 启动
  src/agents/pi-embedded-runner/run.ts → runEmbeddedPiAgent()
  ▼
⑥ 构建 Attempt
  src/agents/pi-embedded-runner/run/attempt.ts
    ├── 构建系统提示词 (system-prompt.ts)
    ├── 注入上下文文件 (AGENTS / SOUL / USER / MEMORY)
    ├── 注册工具定义 (pi-tools.ts / plugins/tools.ts)
    └── 构建标准消息格式
  ▼
⑦ 选择 Harness
  src/agents/harness/selection.ts
    └── PI Harness (builtin-pi.ts → runEmbeddedAttempt)
  ▼
⑧ LLM API 调用
  src/agents/provider-stream.ts → registerProviderStreamForModel()
    └── DeepSeek API (SSE stream)
  ▼
⑨ 流式解析
  src/agents/pi-embedded-subscribe.ts
    ├── thinking → 推理过程
    ├── tool_use → exec("curl wttr.in/Shanghai")
    │   ▼
    │   src/agents/bash-tools.ts → runCommandExecute()
    │   │   → curl.exe → 天气 JSON
    │   ▼
    │   tool_result 返回 LLM
    │   ▼
    │   继续流式
    └── assistant_text → "上海浦东今天16°C..."
  ▼
⑩ 回复投递
  src/auto-reply/reply-payload.ts → ReplyPayload
    ▼
  WebSocket 推送到浏览器 ← 你看到回复
```

---

## 12. 核心文件索引

### Gateway 启动
| 文件 | 职责 |
|------|------|
| `packages/cli/src/openclaw.ts` | CLI 入口 |
| `src/gateway/server.ts` | Gateway server 入口 |
| `src/gateway/server.impl.ts` | `startGatewayServer()` 完整启动流程 |
| `src/gateway/boot.ts` | Boot 检查 |
| `src/config/io.ts` | 配置加载 |

### 消息通道
| 文件 | 职责 |
|------|------|
| `src/channels/turn/kernel.ts` | Channel Turn 核心调度 |
| `src/channels/turn/context.ts` | Turn 上下文构建 |
| `src/channels/turn/types.ts` | 类型定义 |
| `src/gateway/server-channels.ts` | Channel 管理器 |
| `src/gateway/server-ws-runtime.ts` | WebSocket 消息处理 |
| `src/channels/plugins/message-tool-api.ts` | 消息工具 API |
| `src/gateway/control-ui.ts` | WebChat Control UI |

### 路由与会话
| 文件 | 职责 |
|------|------|
| `src/routing/session-key.ts` | 会话键生成与解析 |
| `src/routing/resolve-route.ts` | 路由解析 |
| `src/config/sessions/store.ts` | 会话持久化存储 |
| `src/session-write-lock.ts` | 会话写入锁 |
| `src/gateway/server-chat.ts` | 聊天运行状态管理 |

### Agent 核心
| 文件 | 职责 |
|------|------|
| `src/agents/pi-embedded-runner/run.ts` | `runEmbeddedPiAgent()` 入口 |
| `src/agents/pi-embedded-runner/run/attempt.ts` | 完整 attempt 执行 |
| `src/agents/pi-embedded-runner/run/backend.ts` | 后端调用桥接 |
| `src/agents/pi-embedded-runner/run/incomplete-turn.ts` | 不完整轮次处理 |
| `src/agents/pi-embedded-runner/run/setup.ts` | 模型选择与设置 |
| `src/agents/pi-embedded-runner/run/auth-controller.ts` | 认证控制 |
| `src/agents/pi-embedded-runner/run/helpers.ts` | 运行辅助函数 |
| `src/agents/pi-embedded-subscribe.ts` | 流式输出订阅处理 |
| `src/agents/pi-embedded-helpers.ts` | 辅助函数 |
| `src/agents/system-prompt.ts` | 系统提示词构建 |
| `src/agents/system-prompt-report.ts` | 提示词报告 |
| `src/agents/harness/selection.ts` | Harness 选择 |
| `src/agents/harness/builtin-pi.ts` | PI Harness 实现 |

### 工具系统
| 文件 | 职责 |
|------|------|
| `src/plugins/tools.ts` | 工具注册与元数据 |
| `src/agents/pi-tools.ts` | Agent 工具创建 |
| `src/agents/pi-tools.policy.ts` | 工具策略控制 |
| `src/agents/bash-tools.ts` | exec/bash 工具 |
| `src/agents/bash-tools.exec.ts` | exec 命令执行 |
| `src/agents/channel-tools.ts` | 通道消息工具 |

### 模型与 Provider
| 文件 | 职责 |
|------|------|
| `src/agents/provider-stream.ts` | Provider 流式传输 |
| `src/agents/model-auth.ts` | 模型认证 |
| `src/agents/anthropic-transport-stream.ts` | Anthropic/兼容 API 传输 |
| `src/agents/pi-embedded-runner/model.ts` | 模型异步解析 |
| `src/agents/fallover-error.ts` | Failover 错误处理 |
| `src/agents/model-selection.ts` | 模型选择 |

### 技能系统
| 文件 | 职责 |
|------|------|
| `src/agents/skills.ts` | 技能加载与注入 |
| `src/agents/bootstrap-files.ts` | 启动文件注入 |
| `src/agents/bootstrap-prompt.ts` | 启动提示词 |

### 环境与运行时
| 文件 | 职责 |
|------|------|
| `src/config/types.openclaw.ts` | 全局配置类型 |
| `src/agents/agent-scope.ts` | Agent 作用域解析 |
| `src/agents/agent-runtime-config.ts` | Agent 运行时配置 |
| `src/plugins/runtime.ts` | 插件运行时 |
| `src/plugins/provider-runtime.ts` | Provider 运行时 |

### 浏览器插件
| 文件 | 职责 |
|------|------|
| `extensions/browser/src/browser-tool.ts` | Browser 工具定义 |
| `extensions/browser/src/browser/chrome.ts` | Chrome 浏览器控制 |
| `extensions/browser/src/browser/cdp.ts` | CDP 协议底层 |
| `extensions/browser/src/browser/pw-session.ts` | Playwright 会话 |
| `extensions/browser/src/browser/pw-tools-core.interactions.ts` | 浏览器交互操作 |
| `extensions/browser/src/browser/profiles.ts` | 浏览器配置文件 |
| `extensions/browser/src/browser/profiles-service.ts` | 配置管理服务 |
| `extensions/browser/src/browser/chrome-mcp.ts` | Chrome MCP 连接 |

---

## 附录：关键技术点

### A. 什么是 PI（Personal Intelligence）
PI 是 OpenClaw 的内置 Agent 引擎，负责管理 LLM 对话循环。不同于简单的 prompt → response，PI 实现了完整的 tool-use loop（思考→行动→观察→思考），支持多次工具调用直到任务完成。

### B. 什么是 Session
Session 是用户与 Agent 之间的对话上下文。每个 sessionKey 对应一个独立的对话，在磁盘上持久化。当用户再次发消息时，OpenClaw 恢复 session 的历史消息，并在此基础上继续对话。

### C. 工具循环
Agent 可以在单次回答中调用多个工具，且每次工具结果都会重新送入 LLM 进行分析，形成"思考→调用→观察→再思考"的循环，直到 Agent 认为任务完成或达到轮次上限。

### D. Skill 系统
Skill 本质上是 markdown 格式的指令文档，放在 `skills/` 目录下。Agent 启动时读取 SKILL.md 注入到 system prompt 中，指导 Agent 如何使用特定的工具或遵循特定的流程。

### E. Fallback & Failover
当模型调用失败（限流、超时、token 耗尽），OpenClaw 会自动尝试：
1. 同一 provider 的不同 API key / profile
2. 配置的 fallback 模型
3. 降级 thinking 级别
最终失败时返回用户友好的错误提示。

---

> 文档基于 OpenClaw 源码 `E:\project\AI\openclaw` 分析生成
> 最后更新: 2026-05-02
