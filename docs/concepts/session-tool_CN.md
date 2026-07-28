---
summary: "Agent tools for cross-session status, recall, messaging, and sub-agent orchestration"
read_when:
  - You want to understand what session tools the agent has
  - You want to configure cross-session access or sub-agent spawning
  - You want to inspect status or control spawned sub-agents
title: "Session tools"
---

OpenClaw 为智能体提供跨会话工作、检查状态和
协调子智能体。

## 可用工具

| 工具               | 它有什么作用                                                                |
| ------------------ | --------------------------------------------------------------------------- |
| `sessions_list`    | `sessions_list`列出具有可选过滤器的会话（种类、标签、智能体、新近度、预览） |
| `sessions_history` | 阅读特定会议的记录                                                          |
| `sessions_send`    | 向另一个会话发送消息并可选择等待                                            |
| `sessions_spawn`   | 为后台工作生成一个独立的子智能体会话                                        |
| `sessions_yield`   | 结束当前回合，等待后续子智能体结果                                          |
| `subagents`        | 列出、引导或终止为此会话生成的子智能体                                      |
| `session_status`   | 显示 `/status` 样式卡并可选择设置每个会话模型覆盖                           |

这些工具仍然受活动工具配置文件和允许/拒绝的约束
政策。 `tools.profile: "coding"` 包括完整的会话编排
设置，包括 `sessions_spawn`、`sessions_yield` 和 `subagents`。
`tools.profile: "messaging"` 包括跨会话消息传递工具
（`sessions_list`、`sessions_history`、`sessions_send`、`session_status`）但是
不包括子智能体的生成。保留消息传递配置文件并且仍然
允许本机委托，添加：

```json5
{
  tools: {
    profile: "messaging",
    alsoAllow: ["sessions_spawn", "sessions_yield", "subagents"],
  },
}
```

组、提供商、沙箱和每个智能体策略仍然可以删除这些工具
在配置文件阶段之后。使用受影响会话中的 `/tools` 来检查
有效的工具清单。

## 列表和阅读课程

`sessions_list` 返回会话及其密钥、agentId、种类、通道、模型、
token计数和时间戳。按种类过滤（`main`、`group`、`cron`、`hook`、
`node`)、精确 `label`、精确 `agentId`、搜索文本或新近度
(`activeMinutes`)。当你需要邮箱式分类时，它还可以要求
可见性范围的派生标题、最后一条消息预览片段或有界的
每行最近的消息。衍生标题和预览仅用于
调用者已经可以在配置的会话工具下看到会话
可见性策略，因此不相关的会话保持隐藏。

`sessions_history` 获取特定会话的对话记录。
默认情况下，工具结果被排除——通过 `includeTools: true` 来查看它们。
返回的视图是有意限制和安全过滤的：

- 助手文本在调用前已标准化：
  - 思维标签被剥离
  - `<relevant-memories>` / `<relevant_memories>` 脚手架块被剥离
  - 纯文本工具调用 XML 有效负载块，例如 `<tool_call>...</tool_call>`，
    `<function_call>...</function_call>`、`<tool_calls>...</tool_calls>` 和
    `<function_calls>...</function_calls>` 被剥离，包括截断
    无法完全关闭的有效载荷
  - 降级的工具调用/结果脚手架，例如 `[Tool Call: ...]`，
    `[Tool Result ...]`，并且 `[Historical context ...]` 被剥离
  - 泄露的模型控制token，例如 `<|assistant|>`、其他 ASCII
    `<|...|>` 标记和全角 `<｜...｜>` 变体被剥离
  - 格式错误的 MiniMax 工具调用 XML 例如 `<invoke ...>` /
    `</minimax:tool_call>` 被剥离
- 凭证/token之类的文本在返回之前经过编辑
- 长文本块被截断
- 非常大的历史记录可以删除较旧的行或用
  `[sessions_history omitted: message too large]`
- 该工具报告摘要标志，例如 `truncated`、`droppedMessages`、
  `contentTruncated`、`contentRedacted` 和 `bytes`

这两个工具都接受 **会话密钥**（如 `"main"`）或 **会话 ID**
来自之前的列表调用。

如果你需要准确的逐字节转录本，请检查转录本文件
磁盘而不是将 `sessions_history` 视为原始转储。

## 发送跨会话消息

`sessions_send` 将消息传递到另一个会话并可选择等待
回应：

- **即发即忘：** 设置 `timeoutSeconds: 0` 入队并返回
  立即。
- **等待回复：** 设置超时并获取内联响应。

消息和 A2A 后续回复在
收到提示 (`[Inter-session message ... isUser=false]`) 和记录
出处。接收智能体应将它们视为工具路由数据，而不是
最终用户直接编写的指令。

目标响应后，OpenClaw 可以运行 **回复循环**，其中
智能体交替发送消息（最多 5 轮）。目标智能体可以回复
`REPLY_SKIP` 提前停止。

## 状态和编排助手

`session_status` 是当前的轻量级 `/status` 等效工具
或另一个可见的会话。它报告使用情况、时间、模型/运行时状态，以及
链接的后台任务上下文（如果存在）。像`/status`一样，它可以回填
来自最新记录使用条目的稀疏token/缓存计数器，以及
`model=default` 清除每个会话覆盖。使用 `sessionKey="current"` 进行
呼叫者的当前会话；可见的客户端标签，例如 `openclaw-tui` 是
不是会话密钥。

`sessions_yield` 有意结束当前回合，以便下一条消息可以
你正在等待的后续事件。在产生子智能体后使用它
你希望完成结果作为下一条消息到达，而不是构建
轮询循环。

`subagents` 是已生成的 OpenClaw 的控制平面助手
子智能体。它支持：

- `action: "list"` 检查活动/最近的运行
- `action: "steer"` 向跑步的孩子发送后续指导
- `action: "kill"` 阻止一个孩子或 `all`

## 生成子智能体

`sessions_spawn` 默认为后台任务创建一个隔离会话。
它始终是非阻塞的——它立即返回 `runId` 并且
`childSessionKey`。

关键选项：

- `runtime: "subagent"`（默认）或 `"acp"` 用于外部线束智能体。
- 子会话的 `model` 和 `thinking` 覆盖。
- `thread: true` 将生成绑定到聊天线程（Discord、Slack 等）。
- `sandbox: "require"` 对子项强制执行沙箱。
- `context: "fork"` 用于本机子智能体，当子智能体需要当前的
  请求者成绩单；省略它或使用 `context: "isolated"` 作为干净的孩子。

默认叶子智能体不获取会话工具。当
`maxSpawnDepth >= 2`，深度 1 协调器子智能体另外接收
`sessions_spawn`、`subagents`、`sessions_list` 和 `sessions_history` 所以它们
可以管理自己的孩子。叶子运行仍然没有递归
编排工具。

完成后，公告步骤将结果发布到请求者的频道。
完成传递会在可用时保留绑定的线程/主题路由，并且如果
完成原点仅标识通道 OpenClaw 仍然可以重用
请求者会话的存储路由 (`lastChannel` / `lastTo`) 用于直接
交货。

有关 ACP 特定行为，请参阅 [ACP 智能体](/tools/acp-agents)。

## 可见性

会话工具的范围是限制智能体可以看到的内容：

| 水平    | 范围                           |
| ------- | ------------------------------ |
| `self`  | 仅当前会话                     |
| `tree`  | 当前会话 + 生成的子智能体      |
| `agent` | 该智能体的所有会话             |
| `all`   | 所有会话（跨智能体，如果配置） |

默认值为 `tree`。沙盒会话被限制为 `tree`，无论
配置。

## 进一步阅读

- [会话管理](/concepts/session) -- 路由、生命周期、维护
- [ACP 特工](/tools/acp-agents) -- 外部线束生成
- [多智能体](/concepts/multi-agent) -- 多智能体架构
- [Gateway Configuration](/gateway/configuration) -- 会话工具配置旋钮

## 相关

- [会话管理](/concepts/session)
- [会话修剪](/concepts/session-pruning)
