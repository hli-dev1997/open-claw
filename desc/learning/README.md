# OpenClaw 源码学习路线

## 项目简介

OpenClaw 是一个 AI 驱动的 CLI 工具，架构上类似 Claude Code。它通过 **Gateway（网关）** 连接用户界面与 AI 后端，支持多 Agent 并发、插件系统、ACP 协议等能力。

整体分层：

```
用户 (CLI/TUI/Web)
    ↓
CLI 命令层 (src/cli/)
    ↓
Gateway 网关 (src/gateway/)
    ↓
Agent 执行层 (src/agents/)
    ↓
ACP 协议层 (src/acp/)
    ↓
Anthropic API / 外部服务
```

---

## 推荐学习顺序

### 第一阶段：入口与启动流程

**目标**：理解程序如何启动，CLI 如何解析命令。

| 文件 | 说明 |
|------|------|
| `src/entry.ts` | 主入口，处理 respawn、容器、profile 等启动逻辑 |
| `src/entry.respawn.ts` | respawn 策略（进程重启机制） |
| `src/cli/run-main.ts` | 实际启动 CLI 的核心逻辑 |
| `src/cli/program/` | 构建 Commander 程序树（`buildProgram`） |
| `src/cli/argv.ts` | 解析命令行参数 |
| `src/cli/profile.ts` | CLI profile 环境变量处理 |
| `src/runtime.ts` | 运行时环境（`defaultRuntime`） |

**关键路径**：`entry.ts` → `run-main.ts` → `buildProgram` → 注册子命令 → 执行

---

### 第二阶段：Gateway 网关层

**目标**：理解请求如何从 CLI 路由到 Agent。

| 文件 | 说明 |
|------|------|
| `src/gateway/client.ts` | GatewayClient，客户端连接网关 |
| `src/gateway/client-bootstrap.ts` | 网关客户端初始化（URL、Token 解析） |
| `src/gateway/agent-list.ts` | 列举可用 Agent |
| `src/gateway/agent-prompt.ts` | 构建发送给 Agent 的消息 |
| `src/gateway/protocol/` | 网关协议定义（client-info 等） |
| `src/routing/session-key.ts` | session key / agent id 规范化 |

**关键概念**：Gateway 是长连接服务，Agent 通过 session 管理会话状态。

---

### 第三阶段：Agent 执行层

**目标**：理解 Agent 如何执行命令、调用 API、处理流式响应。

| 文件 | 说明 |
|------|------|
| `src/agents/agent-command.ts` | `AgentCommand`，Agent 执行入口 |
| `src/agents/agent-scope.ts` | Agent 作用域（scope）管理 |
| `src/agents/agent-runtime-config.ts` | Agent 运行时配置解析 |
| `src/agents/anthropic-transport-stream.ts` | 与 Anthropic API 的流式通信 |
| `src/agents/anthropic-vertex-stream.ts` | Vertex AI 后端流式支持 |
| `src/agents/acp-spawn.ts` | 通过 ACP 协议 spawn 子 Agent |
| `src/agents/apply-patch.ts` | 文件 patch 应用逻辑 |
| `src/agents/auth-profiles.ts` | 认证 profile 管理 |
| `src/agents/auth-health.ts` | 认证健康检查 |

**关键概念**：Agent 支持嵌套（parent/child），子 Agent 通过 `acp-spawn` 创建。

---

### 第四阶段：ACP 协议层

**目标**：理解 Agent Control Protocol，即 Agent 间通信协议。

| 文件 | 说明 |
|------|------|
| `src/acp/server.ts` | ACP 服务端，处理 Agent 连接 |
| `src/acp/client.ts` | ACP 客户端 |
| `src/acp/translator.ts` | ACP ↔ 内部事件转换（`AcpGatewayAgent`） |
| `src/acp/session.ts` | ACP 会话管理 |
| `src/acp/types.ts` | ACP 类型定义 |
| `src/acp/policy.ts` | ACP 请求策略 |
| `src/acp/control-plane/` | 控制平面：manager、runtime-cache、spawn |
| `src/acp/persistent-bindings.ts` | 持久化绑定（跨会话保持连接） |
| `src/acp/event-mapper.ts` | 事件映射 |

**关键概念**：ACP 基于 `@agentclientprotocol/sdk`，使用 ndJSON 流传输。

---

### 第五阶段：配置系统

**目标**：理解配置如何加载、合并、验证。

| 文件 | 说明 |
|------|------|
| `src/config/config.ts` | `loadConfig()` 主入口 |
| `src/config/types.openclaw.ts` | 配置类型定义（`OpenClawConfig`） |
| `src/config/sessions.ts` | Session 配置（模型、参数等） |
| `src/config/sessions/types.ts` | `SessionEntry` 类型 |
| `src/config/paths.ts` | 路径解析（state dir、config dir） |
| `src/infra/env.ts` | 环境变量工具（`isTruthyEnvValue`） |

---

### 第六阶段：插件系统

**目标**：理解插件如何注册、安装、执行。

| 文件 | 说明 |
|------|------|
| `src/cli/plugins-cli.ts` | 插件 CLI 命令（install/list/update/uninstall） |
| `src/cli/plugin-registry.ts` | 插件注册表 |
| `src/cli/plugin-install-plan.ts` | 安装计划生成 |
| `src/plugins/` | 插件运行时支持 |
| `src/plugin-sdk/` | 插件开发 SDK |

---

### 第七阶段：TUI / 交互界面

**目标**：理解终端 UI 如何渲染、交互。

| 文件 | 说明 |
|------|------|
| `src/tui/` | 终端 UI 主目录 |
| `src/cli/tui-cli.ts` | TUI CLI 命令入口 |
| `src/interactive/` | 交互式输入处理 |
| `src/terminal/ansi.ts` | ANSI 转义处理（`sanitizeForLog`） |

---

### 第八阶段：工具与外部集成

| 模块 | 路径 | 说明 |
|------|------|------|
| MCP | `src/mcp/` | Model Context Protocol 集成 |
| Web Fetch | `src/web-fetch/` | 网页抓取 |
| Web Search | `src/web-search/` | 搜索集成 |
| Hooks | `src/hooks/` | 钩子系统 |
| Cron | `src/cron/` | 定时任务 |
| Tasks | `src/tasks/` | 任务追踪 |
| Memory | `src/memory-host-sdk/` | 记忆系统 SDK |
| Secrets | `src/secrets/` | 密钥管理 |
| Security | `src/security/` | 安全策略 |

---

## 核心数据流

```
用户输入命令
    ↓
entry.ts → run-main.ts
    ↓
buildProgram() 注册所有 CLI 命令
    ↓
用户触发某命令（如 chat/send）
    ↓
GatewayClient 建立连接
    ↓
AgentCommand 解析参数，构建 SessionEntry
    ↓
anthropic-transport-stream 发送到 Anthropic API
    ↓
流式响应返回 → gateway 转发 → TUI 渲染
```

---

## 关键概念速查

| 概念 | 位置 | 说明 |
|------|------|------|
| `SessionEntry` | `src/config/sessions/types.ts` | 单个 Agent 会话的完整配置 |
| `GatewayClient` | `src/gateway/client.ts` | 客户端到 Gateway 的连接 |
| `AcpGatewayAgent` | `src/acp/translator.ts` | ACP 协议的 Gateway 侧适配器 |
| `AgentCommand` | `src/agents/agent-command.ts` | Agent 命令执行的核心类 |
| `defaultRuntime` | `src/runtime.ts` | 全局运行时环境单例 |
| `loadConfig()` | `src/config/config.ts` | 加载合并配置 |
| `resolveStateDir()` | `src/config/paths.ts` | 获取状态目录路径 |

---

## 建议阅读的测试文件

测试文件往往比源文件更清晰地展示使用方式：

- `src/acp/translator.*.test.ts` — ACP 协议转换的各种边界情况
- `src/agents/acp-spawn.test.ts` — 子 Agent spawn 流程
- `src/cli/program.smoke.test.ts` — CLI 程序冒烟测试
- `src/agents/anthropic-transport-stream.test.ts` — API 流处理测试
- `src/acp/control-plane/manager.test.ts` — 控制平面管理器测试

---

## 三步上手法

### 第一步：OpenClaw 源码（理解底层架构）

按本文 8 个阶段学，**重点放在前 4 个阶段**：

| 阶段 | 重点 | 投入比例 |
|------|------|---------|
| 入口启动 | `entry.ts → run-main.ts → buildProgram` | ★★★★★ |
| Gateway 网关 | `gateway/call.ts → client.ts` | ★★★★★ |
| Agent 执行 | `agent-command.ts → attempt-execution.ts` | ★★★★★ |
| ACP 协议 | `acp/server.ts → translator.ts` | ★★★★★ |
| 配置系统 | `config/config.ts` | ★★★ |
| 插件系统 | 快速扫一遍，知道入口在哪即可 | ★★ |
| TUI / 交互界面 | 知道目录结构即可 | ★★ |
| 外部集成 | 按需查阅 | ★ |

**建议用 `/local` 模式调试**：`openclaw agent --local --message "hello"` 可以在本地直接跑 embedded 路径，不依赖 Gateway 服务，方便打断点观察。

---

### 第二步：WindClaw 套壳层（理解业务落地）

学完 OpenClaw 底层后，重点对比 WindClaw 在以下方向做了哪些定制：

**要找的关键差异点：**

1. **系统提示词（System Prompt）定制**
   - 找 `resolveProviderSystemPromptContribution` / `applySystemPromptOverrideToSession` 的调用处
   - 看有没有额外注入业务身份、角色、权限信息

2. **工具集扩展**
   - 找 `createOpenClawCodingTools` / `customTools` 的传入处
   - 看有没有内部业务工具（如 CRM 查询、工单系统调用等）

3. **Auth Profile（认证配置）**
   - 找 `auth-profiles.ts` 的初始化逻辑
   - 看是否对接了内部 SSO / OAuth / 私有模型服务

4. **模型路由**
   - 找 `model-selection.ts` / `resolveConfiguredModelRef`
   - 看是否有内部模型白名单、计费路由、企业 endpoint

5. **消息通道（Channels）**
   - 找 `channels/` 目录，看有没有对接企业 IM（钉钉、飞书、企业微信）
   - 对比 `GATEWAY_CLIENT_NAMES` 的扩展

6. **配置来源**
   - 找 `config/config.ts` 的合并逻辑
   - 看有没有从内部服务拉取配置（远程配置中心）

**建议操作**：在 git 中对比 WindClaw 相对于 OpenClaw 的 diff，重点看 `src/agents/`、`src/config/`、`src/gateway/` 三个目录的变更。

---

### 第三步：提炼面试故事

学完后，能回答以下问题说明掌握到位：

**Q1："WindClaw 整体架构是什么？你负责了哪些模块？"**

参考框架：
> WindClaw 整体是一个多层架构：CLI 层负责命令解析（Commander），Gateway 层作为长连接服务做消息路由，Agent 执行层负责调用 AI API 并管理会话上下文，ACP 协议层处理多 Agent 间通信。我主要负责 [XXX 层]，具体做了 [YYY 功能]，解决了 [ZZZ 问题]。

**Q2："Agent 是怎么编排的？多 Agent 之间怎么通信？"**

参考框架：
> Agent 编排的核心是 `agent-command.ts` 的执行循环，每次 turn 调用 `runAgentAttempt()` 决定走 CLI 路径还是 embedded Pi 路径。多 Agent 通信走 ACP 协议，通过 `acp/control-plane/manager.ts` 管理生命周期，`acp-spawn.ts` 负责 spawn 子 Agent，子 Agent 的事件通过 `event-mapper.ts` 映射回父 Agent 的事件流。

**Q3："流式响应链路怎么实现的？断线怎么重连？"**

参考框架：
> 流式响应的核心是 `anthropic-transport-stream.ts`，它封装了对 Anthropic `messages.stream()` 的调用，通过 `@mariozechner/pi-ai` 解析 SSE 事件流。每个 token 增量通过 `emitAcpAssistantDelta()` 推送给上游。断线重连走 `model-fallback.ts` 的 fallback 机制 + `auth-profiles.ts` 的 profile rotation，最多重试 5 次（`MAX_LIVE_SWITCH_RETRIES`），同时 `LiveSessionModelSwitchError` 处理运行时模型切换。

**Q4："如果让你从零搭一套类似的平台，你怎么设计？"**

参考框架：
> 核心是三层解耦：① 接入层（多协议适配：CLI/Web/IM），② 编排层（session 管理 + 工具路由 + 多 Agent 调度），③ 执行层（模型适配 + 流式传输 + 重试降级）。存储上 session 用文件 + 内存双层缓存，向量搜索做长期记忆。关键决策是 Gateway 的单点 vs 分布式权衡——初期单点降低复杂度，业务量上来后再横向扩展 Agent worker 池。

---

## 完整执行链路分析

> 场景：用户在 CLI 输入 `openclaw agent --local --message "帮我写一个hello world"`

### 执行路径概览（本地 embedded 模式）

```
entry.ts
  → runMainOrRootHelp()
    → cli/run-main.ts: runCli()
      → tryRouteCli()  [快速路由，agent命令未命中，走完整路径]
      → buildProgram()
        → registerAgentCommands()  [注册 agent 命令]
      → program.parseAsync()  [Commander 解析 argv]
        → agent命令 .action() 触发
          → agentCliCommand()  [commands/agent-via-gateway.ts]
            → agentCommand()  [--local 模式，跳过 Gateway]
              → AgentCommand.run()  [agents/agent-command.ts]
                → runAgentAttempt()  [command/attempt-execution.ts]
                  → runEmbeddedPiAgent()  [pi-embedded-runner/run.ts]
                    → runEmbeddedAttemptWithBackend()
                      → runAgentHarnessAttemptWithFallback()
                        → runEmbeddedAttempt()  [pi-embedded-runner/run/attempt.ts]
                          → createAgentSession()  [@mariozechner/pi-coding-agent]
                          → session.agent.streamFn  [anthropic-transport-stream.ts]
                            → messages.stream()  [Anthropic API]
                              ← SSE 流式响应
                          ← 流式 token 推送给调用方
```

---

### 逐步调试清单（按执行顺序编号）

**① 入口判断**
- 文件：`src/entry.ts`
- 函数：顶层 `if (isMainModule(...))` 块
- 关键行：约第 105 行 `if (!ensureCliRespawnReady())`
- 做了什么：判断是否需要 respawn 子进程（不同 Node 版本或容器场景），正常情况直接跳过
- 断点位置：第 132 行 `runMainOrRootHelp(process.argv)`，可看 `process.argv` 完整参数列表

**② 路由决策**
- 文件：`src/cli/run-main.ts`
- 函数：`runCli()`
- 关键行：约第 229 行 `if (await tryRouteCli(normalizedArgv))`
- 做了什么：尝试快速路由（`agent` 命令不在快速路由表里，返回 false，走完整 Commander 路径）
- 断点位置：第 229 行，观察 `tryRouteCli` 的返回值是 false，确认走下面的完整路径

**③ 构建命令树**
- 文件：`src/cli/program/build-program.ts`
- 函数：`buildProgram()`
- 关键行：约第 13 行 `registerProgramCommands(program, ctx, argv)`
- 做了什么：注册所有 CLI 子命令（agent、agents、message、status 等）
- 断点位置：第 13 行，完成后可在 `program.commands` 看到所有已注册命令

**④ agent 命令注册**
- 文件：`src/cli/program/register.agent.ts`
- 函数：`registerAgentCommands()`
- 关键行：第 27 行 `.requiredOption("-m, --message <text>", ...)`
- 做了什么：注册 `openclaw agent` 命令及其所有选项，`.action()` 里调用 `agentCliCommand`
- 断点位置：第 86 行 `await agentCliCommand(opts, defaultRuntime, deps)`，可看到解析后的 `opts`

⑤ **用户输入在此被捕获**
- 文件：`src/cli/program/register.agent.ts`
- 位置：第 86 行 `.action()` 回调，`opts.message` 就是用户输入的文本
- 断点位置：第 86 行，打印 `opts.message` 确认捕获到用户输入

**⑥ 路由：Gateway vs 本地**
- 文件：`src/commands/agent-via-gateway.ts`
- 函数：`agentCliCommand()`
- 关键行：约第 187 行 `if (opts.local === true)`
- 做了什么：`--local` 为 true 则直接调用本地 `agentCommand()`，否则走 `callGateway()` 发到远端
- 断点位置：第 187 行，确认 `opts.local` 的值决定执行路径

**⑦ 解析 session 和模型配置**
- 文件：`src/agents/agent-command.ts`
- 函数：`AgentCommand.run()` 或 `agentCommand()`
- 关键行：约第 820-848 行（解析 sessionFile、sessionEntry）
- 做了什么：加载 session 文件（历史对话记录）、解析 model 配置、计算 timeout
- 断点位置：第 848 行 `const attemptExecutionRuntime = await loadAttemptExecutionRuntime()`，此时 `sessionFile` 已确定

**⑧ 选择执行路径**
- 文件：`src/agents/command/attempt-execution.ts`
- 函数：`runAgentAttempt()`
- 关键行：第 260 行 `if (isCliProvider(params.providerOverride, params.cfg))`
- 做了什么：CLI provider（如 claude-code）走 `runCliAgent()`；其余走 `runEmbeddedPiAgent()`
- 断点位置：第 260 行，观察 `params.providerOverride` 决定走哪条路

**⑨ 启动 embedded Pi Agent 执行循环**
- 文件：`src/agents/pi-embedded-runner/run.ts` → `run/attempt.ts`
- 函数：`runEmbeddedPiAgent()` → `runEmbeddedAttempt()`
- 关键行：`attempt.ts` 约第 1112 行 `createAgentSession()`
- 做了什么：创建 `@mariozechner/pi-coding-agent` 的 Session 对象，加载历史消息
- 断点位置：第 1112 行，完成后 `session.messages` 包含完整对话历史

⑩ **消息在此被组装成 API 请求格式**
- 文件：`src/agents/pi-embedded-runner/run/attempt.ts`
- 关键行：约第 1205-1247 行（设置 `streamFn`）
- 做了什么：把 session 的消息列表、系统提示词、工具列表组装成 Anthropic API 格式
- `streamFn` 由 `anthropic-transport-stream.ts` 提供，在每次 AI turn 时调用
- 断点位置：第 1237 行 `activeSession.agent.streamFn = resolveEmbeddedAgentStreamFn(...)`

⑪ **请求在此发送给 Anthropic API**
- 文件：`src/agents/anthropic-transport-stream.ts`
- 关键位置：`messages.stream(params, { signal })` 调用处（搜索 `.stream(` 关键词）
- 做了什么：调用 `@mariozechner/pi-ai` 封装的 Anthropic client，发送 HTTP 请求到 `api.anthropic.com`
- 断点位置：`messages.stream()` 调用行，可看到完整的 `params`（含 model、messages、tools 等）

⑫ **流式响应在此开始接收**
- 文件：`src/agents/anthropic-transport-stream.ts`
- 关键位置：`for await (const chunk of stream)` 循环（搜索 `parseStreamingJson` 或 `for await`）
- 做了什么：逐个解析 SSE 事件，每个 `content_block_delta` 事件包含一个 token
- 断点位置：循环体内，观察 `chunk` 的结构

⑬ **响应 token 在此推送给上层**
- 文件：`src/agents/agent-command.ts`
- 关键行：约第 496 行 `attemptExecutionRuntime.emitAcpAssistantDelta({...})`
- 做了什么：每个流式 delta 事件通过 `emitAgentEvent()` 广播给订阅方（TUI/Gateway/调用者）
- 断点位置：第 496 行，观察 `delta` 内容

⑭ **响应在此渲染给用户**
- 文件：`src/tui/` 或 `src/cli/` 的事件监听器
- 做了什么：订阅 `agent-events`，将 delta text 写入 stdout（TTY 下带颜色高亮，非 TTY 下纯文本）
- 断点位置：搜索 `onAgentEvent` 或 `emitAcpAssistantDelta` 的调用者

---

### Gateway 模式路径（不带 `--local`）

当用户不带 `--local` 时（即远端 Gateway 模式）：

```
agentCliCommand()
  → agentViaGatewayCommand()  [commands/agent-via-gateway.ts:87]
    → callGateway({ method: "agent", params: {...} })  [gateway/call.ts]
      → GatewayClient.call()  [gateway/client.ts]
        → HTTP/WebSocket 请求到 Gateway 服务
          → Gateway 服务内部运行 AgentCommand
            ← 返回最终结果（非流式，等待完成）
```

**关键区别**：Gateway 模式下 CLI 端**不接收流式响应**，而是等待 Gateway 返回完整结果。流式渲染发生在 Gateway 服务进程内部，CLI 端只看到最终文本。

---

### 断点调试快速入口

```bash
# 方式1：本地 embedded 模式（最直接，无需 Gateway）
openclaw agent --local --message "帮我写一个hello world"

# 方式2：打开 Node 调试端口
node --inspect-brk dist/entry.js agent --local --message "hello"
# 然后 Chrome 打开 chrome://inspect
```

**五个最关键的断点**（按重要性排序）：

| 优先级 | 文件 | 位置 | 能看到什么 |
|--------|------|------|-----------|
| 1 | `cli/program/register.agent.ts` | `.action()` 回调第86行 | 用户输入 `opts.message` |
| 2 | `commands/agent-via-gateway.ts` | 第187行 local 判断 | 执行路径决策 |
| 3 | `agents/command/attempt-execution.ts` | `runAgentAttempt()` 第260行 | provider 选择 |
| 4 | `agents/anthropic-transport-stream.ts` | `messages.stream()` 调用 | 完整 API 请求参数 |
| 5 | `agents/agent-command.ts` | 第496行 `emitAcpAssistantDelta` | 每个流式 token |
