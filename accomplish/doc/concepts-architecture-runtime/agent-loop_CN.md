---
summary: "Agent loop lifecycle, streams, and wait semantics"
read_when:
  - You need an exact walkthrough of the agent loop or lifecycle events
  - You are changing session queueing, transcript writes, or session write lock behavior
title: "Agent loop"
---

智能体循环是智能体的完整“真实”运行：摄入→上下文组装→模型推理→
工具执行→流式回复→持久化。这是传递消息的权威路径
转化为操作和最终答复，同时保持会话状态一致。

在 OpenClaw 中，循环是每个会话的单个序列化运行，它发出生命周期和流事件
正如模型所思考的那样，调用工具并流输出。该文档解释了真实的循环是如何进行的
端到端有线连接。

## 入口点

- Gateway RPC：`agent` 和 `agent.wait`。
- CLI：`agent` 命令。

## 它是如何工作的（高级）

1. `agent` RPC 验证参数，解析会话（sessionKey/sessionId），保留会话元数据，立即返回 `{ runId, acceptedAt }`。
2. `agentCommand` 运行智能体：
   - 解决模型+思考/详细/跟踪默认值
   - 加载技能快照
   - 调用 `runEmbeddedPiAgent` （pi-agent-core 运行时）
   - 如果嵌入循环未发出生命周期结束/错误，则发出**生命周期结束/错误**
3.`runEmbeddedPiAgent`：
   - 通过每个会话+全局队列序列化运行
   - 解析模型+认证配置文件并构建 pi 会话
   - 订阅 pi 事件和流助手/工具增量
   - 强制超时 -> 如果超过则中止运行
   - 对于 Codex 应用服务器转动，中止已接受的转动，该转动在终端事件之前停止产生应用服务器进度
   - 返回有效负载+使用元数据
4. `subscribeEmbeddedPiSession` 将 pi-agent-core 事件桥接到 OpenClaw `agent` 流：
   - 工具事件 => `stream: "tool"`
   - 助理德尔塔 => `stream: "assistant"`
   - 生命周期事件 => `stream: "lifecycle"` (`phase: "start" | "end" | "error"`)
5. `agent.wait` 使用 `waitForAgentRun`：
   - 等待 `runId` 的**生命周期结束/错误**
   - 返回 `{ status: ok|error|timeout, startedAt, endedAt, error? }`

## 队列+并发

- 运行按会话密钥（会话通道）进行序列化，并且可以选择通过全局通道进行序列化。
- 这可以防止工具/会话竞争并保持会话历史记录一致。
- 消息传递通道可以选择为该通道系统提供数据的队列模式（收集/引导/跟进）。
  请参阅[命令队列](/concepts/queue)。
- 脚本写入也受到会话文件上的会话写锁的保护。锁是
  进程感知和基于文件，因此它捕获绕过进程内队列或来自
  另一个过程。
- 默认情况下，会话写锁是不可重入的。如果助手故意嵌套获取
  同一锁同时保留一个逻辑写入器，它必须显式选择加入
  `allowReentrant: true`。

## 会话 + 工作区准备

- 工作区被解析并创建；沙盒运行可能会重定向到沙盒工作区根目录。
- Skills 被加载（或从快照中重用）并注入到 env 和提示符中。
- 引导程序/上下文文件被解析并注入到系统提示词报告中。
- 获取会话写锁； `SessionManager` 在流式传输之前打开并准备好。任意
  稍后的转录重写、压缩或截断路径在打开或打开之前必须采用相同的锁定
  改变转录文件。

## 提示汇编+系统提示词

- 系统提示词符是根据 OpenClaw 的基本提示符、技能提示符、引导上下文和每次运行覆盖构建的。
- 强制实施特定于模型的限制和压缩储备token。
- 请参阅[系统提示词](/concepts/system-prompt) 了解模型所看到的内容。

## 钩子点（可以拦截的地方）

OpenClaw 有两个钩子系统：

- **内部挂钩**（Gateway 挂钩）：用于命令和生命周期事件的事件驱动脚本。
- **Plugin 挂钩**：智能体/工具生命周期和网关管道内的扩展点。

### 内部挂钩（Gateway 挂钩）

- **`agent:bootstrap`**：在系统提示词完成之前构建引导文件时运行。
  使用它来添加/删除引导上下文文件。
- **命令挂钩**：`/new`、`/reset`、`/stop` 和其他命令事件（请参阅 Hooks 文档）。

请参阅 [Hooks](/automation/hooks) 了解设置和示例。

### Plugin 挂钩（智能体+网关生命周期）

它们在智能体循环或网关管道内运行：

- **`before_model_resolve`**：运行会话前（无 `messages`）以在模型解析之前确定性地覆盖提供商/模型。
- **`before_prompt_build`**：在会话加载后运行（使用 `messages`），在提示提交之前注入 `prependContext`、`systemPrompt`、`prependSystemContext` 或 `appendSystemContext`。使用 `prependContext` 作为每回合动态文本和系统上下文字段，以获得应位于系统提示词空间中的稳定指导。
- **`before_agent_start`**：可以在任一阶段运行的遗留兼容性挂钩；更喜欢上面的显式钩子。
- **`before_agent_reply`**：在内联操作之后和 LLM 调用之前运行，让插件声明回合并返回合成回复或完全静音回合。
- **`agent_end`**：检查最终消息列表并在完成后运行元数据。
- **`before_compaction` / `after_compaction`**：观察或注释压缩循环。
- **`before_tool_call` / `after_tool_call`**：拦截工具参数/结果。
- **`before_install`**：检查内置扫描结果并可选择阻止技能或插件安装。
- **`tool_result_persist`**：在将工具结果写入 OpenClaw 拥有的会话记录之前同步转换工具结果。
- **`message_received` / `message_sending` / `message_sent`**：入站 + 出站消息挂钩。
- **`session_start` / `session_end`**：会话生命周期边界。
- **`gateway_start` / `gateway_stop`**：网关生命周期事件。

出站/工具防护装置的挂钩决策规则：

- `before_tool_call`：`{ block: true }` 是终端并停止较低优先级的处理程序。
- `before_tool_call`：`{ block: false }` 是无操作，不会清除先前的块。
- `before_install`：`{ block: true }` 是终端并停止较低优先级的处理程序。
- `before_install`：`{ block: false }` 是无操作，不会清除先前的块。
- `message_sending`：`{ cancel: true }` 是终端并停止较低优先级的处理程序。
- `message_sending`：`{ cancel: false }` 是无操作，不会清除先前的取消。

有关钩子 API 和注册详细信息，请参阅 [Plugin 钩子](/plugins/hooks)。

Harness 可以用不同方式适配这些钩子。Codex app-server harness 会保持
OpenClaw 插件挂钩作为记录镜像的兼容性契约
表面，而 Codex 本机钩子仍然是一个单独的较低级别 Codex 机制。

## 直播 + 部分回复

- 助理增量从 pi-agent-core 流式传输并作为 `assistant` 事件发出。
- 块流可以在 `text_end` 或 `message_end` 上发出部分回复。
- 推理流可以作为单独的流或块回复发出。
- 请参阅 [Streaming](/concepts/streaming) 了解分块和块回复行为。

## 工具执行+消息传递工具

- 工具启动/更新/结束事件在 `tool` 流上发出。
- 在记录/发送之前，工具结果会根据大小和图像有效负载进行清理。
- 跟踪消息传递工具发送以抑制重复的助理确认。

## 回复整形+压制

- 最终有效负载由以下组件组装而成：
  - 辅助文本（和可选推理）
  - 内联工具摘要（当详细+允许时）
  - 模型错误时助手错误文本
- 确切的静默标记 `NO_REPLY` / `no_reply` 从传出中过滤
  有效负载。
- 消息传递工具重复项已从最终有效负载列表中删除。
- 如果没有剩余可渲染的有效负载并且工具出错，则会发出后备工具错误回复
  （除非消息传递工具已经发送了用户可见的回复）。

## 压缩+重试

- 自动压缩会发出 `compaction` 流事件并可以触发重试。
- 重试时，内存缓冲区和工具摘要将被重置，以避免重复输出。
- 请参阅 [Compaction](/concepts/compaction) 了解压缩管道。

## 事件流（今天）

- `lifecycle`：由 `subscribeEmbeddedPiSession` 发出（并作为 `agentCommand` 的后备）
- `assistant`：来自 pi-agent-core 的流式增量
- `tool`：来自 pi-agent-core 的流式工具事件

## 聊天频道处理

- 助理增量被缓冲到聊天 `delta` 消息中。
- 在 **生命周期结束/错误** 时发出聊天 `final`。

## 超时

- `agent.wait` 默认值：30 秒（只需等待）。 `timeoutMs` 参数覆盖。
- 智能体运行时间：`agents.defaults.timeoutSeconds`默认172800秒（48小时）；在 `runEmbeddedPiAgent` 中止计时器中强制执行。
- Cron 运行时：隔离智能体轮 `timeoutSeconds` 归 cron 所有。调度程序在执行开始时启动该计时器，在配置的截止日期内中止底层运行，然后在记录超时之前运行有界清理，以便陈旧的子会话无法保持通道卡住。
- 卡住会话恢复：启用诊断后，`diagnostics.stuckSessionWarnMs` 检测长 `processing` 会话。默认情况下，活动的嵌入式运行、活动的回复操作和活动的会话通道任务仅保持警告状态；如果诊断显示会话没有活动工作，则看门狗会释放受影响的会话通道，以便耗尽排队的启动工作。
- 模型空闲超时：当空闲窗口之前没有响应块到达时，OpenClaw 将中止模型请求。 `models.providers.<id>.timeoutSeconds` 为缓慢的本地/自托管提供商扩展了这个空闲看门狗；否则 OpenClaw 在配置时使用 `agents.defaults.timeoutSeconds`，默认上限为 120 秒。没有显式模型或智能体超时的 Cron 触发运行会禁用空闲看门狗并依赖 cron 外部超时。
- 提供商 HTTP 请求超时：`models.providers.<id>.timeoutSeconds` 适用于该提供商的模型 HTTP 获取，包括连接、标头、正文、SDK 请求超时、总保护获取中止处理和模型流空闲看门狗。在提高整个智能体运行时超时之前，请将此用于缓慢的本地/自托管提供商，例如 Ollama。

## 事情可以提前结束的地方

- 智能体超时（中止）
- AbortSignal（取消）
- Gateway 断开连接或 RPC 超时
- `agent.wait` 超时（仅等待，不停止智能体）

## 相关

- [工具](/tools) — 可用的智能体工具
- [Hooks](/automation/hooks) — 由智能体生命周期事件触发的事件驱动脚本
- [Compaction](/concepts/compaction) — 总结多长时间的对话
- [Exec Approvals](/tools/exec-approvals) — shell 命令的批准门
- [Thinking](/tools/thinking) — 思维/推理级别配置
