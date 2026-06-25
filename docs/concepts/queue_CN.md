---
summary: "Auto-reply queue modes, defaults, and per-session overrides"
read_when:
  - Changing auto-reply execution or concurrency
  - Explaining /queue modes or message steering behavior
title: "Command queue"
---

我们通过一个微小的进程内队列序列化入站自动回复运行（所有通道），以防止多个智能体运行发生冲突，同时仍然允许跨会话安全并行。

## 为什么

- 自动回复运行的成本可能很高（LLM 调用），并且当多个入站消息同时到达时可能会发生冲突。
- 序列化避免竞争共享资源（会话文件、日志、CLI stdin）并减少上游速率限制的机会。

## 它是如何工作的

- 通道感知的 FIFO 队列通过可配置的并发上限耗尽每个通道（未配置的通道默认为 1；主通道默认为 4，子智能体默认为 8）。
- `runEmbeddedPiAgent` 按 **会话密钥** 排队（通道 `session:<key>`），以保证每个会话仅运行一次活动。
- 然后，每个会话运行都会排队到**全局通道**（默认情况下为 `main`），因此整体并行性受到 `agents.defaults.maxConcurrent` 的限制。
- 启用详细日志记录后，如果排队运行在开始前等待超过 2 秒，则会发出简短通知。
- 键入指示器仍然会在入队时立即触发（当通道支持时），因此在我们等待轮到我们时，用户体验不会改变。

## 默认值

未设置时，所有入站通道表面使用：

- `mode: "steer"`
- `debounceMs: 500`
- `cap: 20`
- `drop: "summarize"`

`steer` 是默认值，因为它使活动模型保持响应而无需
开始第二次会话运行。它会耗尽所有到达的转向消息
在下一个模型边界之前。如果当前运行无法接受转向，
OpenClaw 回退到后续队列条目。

## 队列模式

入站消息可以引导当前运行、等待后续轮次，或同时执行这两种操作：

- `steer`：将引导消息排队到活动运行时。 Pi 在**当前助手轮完成执行其工具调用之后**、在下一个 LLM 调用之前传递所有待处理的转向消息； Codex 应用服务器接收一批 `turn/steer`。如果运行未主动流式传输或转向不可用，则 OpenClaw 会回退到后续队列条目。
- `queue`（旧版）：旧的一次一次转向。 Pi 在每个模型边界传递一个排队的转向消息； Codex 应用服务器接收单独的 `turn/steer` 请求。首选 `steer` 除非你需要以前的序列化行为。
- `followup`：将每条消息排入队列，以供当前运行结束后稍后的智能体轮流使用。
- `collect`：在安静窗口之后将排队的消息合并为**单个**后续轮次。如果消息针对不同的通道/线程，它们会单独排出以保留路由。
- `steer-backlog`（又名 `steer+backlog`）：立即转向**并**为后续转弯保留相同的消息。
- `interrupt`（旧版）：中止该会话的活动运行，然后运行最新消息。

转向积压意味着你可以在转向运行后获得后续响应，因此
流表面可能看起来像重复的。如果需要，请首选 `collect`/`steer`
每条入站消息一个响应。

有关运行时特定的计时和依赖行为，请参阅
[转向队列](/concepts/queue-steering)。

通过 `messages.queue` 全局或每个通道配置：

```json5
{
  messages: {
    queue: {
      mode: "steer",
      debounceMs: 500,
      cap: 20,
      drop: "summarize",
      byChannel: { discord: "collect" },
    },
  },
}
```

## 队列选项

选项适用于 `followup`、`collect` 和 `steer-backlog`（以及当转向回落至后续状态时适用于 `steer` 或旧版 `queue`）：

- `debounceMs`：在排出排队的后续任务之前的安静窗口。简单的数字是毫秒； `ms`、`s`、`m`、`h` 和 `d` 单位由 `/queue` 选项接受。
- `cap`：每个会话的最大排队消息数。低于 `1` 的值将被忽略。
- `drop: "summarize"`：默认。根据需要删除最旧的排队条目，保留紧凑的摘要，并将它们作为合成的后续提示注入。
- `drop: "old"`：根据需要删除最旧的排队条目，而不保留摘要。
- `drop: "new"`：当队列已满时拒绝最新消息。

默认值：`debounceMs: 500`、`cap: 20`、`drop: summarize`。

## 优先级

对于模式选择，OpenClaw 解析：

1. 内联或存储的每个会话 `/queue` 覆盖。
2.`messages.queue.byChannel.<channel>`。
3.`messages.queue.mode`。
4. 默认`steer`。

对于选项，内联或存储的 `/queue` 选项胜过配置。然后
通道特定的去抖动 (`messages.queue.debounceMsByChannel`)，插件
去抖默认值、全局 `messages.queue` 选项和内置默认值是
应用。 `cap` 和 `drop` 是全局/会话选项，而不是每通道配置
键。

## 每会话覆盖

- 将 `/queue <mode>` 作为独立命令发送以存储当前会话的模式。
- 选项可以组合：`/queue collect debounce:0.5s cap:25 drop:summarize`
- `/queue default` 或 `/queue reset` 清除会话覆盖。

## 范围和保证

- 适用于在使用网关回复管道的所有入站通道上运行的自动回复智能体（WhatsApp web、Telegram、Slack、Discord、Signal、 iMessage、网络聊天等）。
- 默认通道 (`main`) 是进程范围内的入站+主心跳；设置 `agents.defaults.maxConcurrent` 以允许并行多个会话。
- 可能存在其他通道（e.g。`cron`、`cron-nested`、`nested`、`subagent`），因此后台作业可以并行运行，而不会阻止入站回复。独立的 cron 智能体轮流持有 `cron` 槽，而其内部智能体执行则使用 `cron-nested`；两者都使用 `cron.maxConcurrentRuns`。共享非 cron `nested` 流保持其自己的通道行为。这些分离的运行被跟踪为[后台任务](/automation/tasks)。
- 每会话通道保证一次只有一个智能体运行接触给定会话。
- 无外部依赖或后台工作线程；纯粹的 TypeScript + 承诺。

## 故障排除

- 如果命令似乎卡住，请启用详细日志并查找“queued for …ms”行以确认队列正在耗尽。
- 如果你需要队列深度，请启用详细日志并观察队列计时线。
- 接受轮流然后停止发出进度的 Codex 应用服务器运行被 Codex 适配器中断，因此活动会话通道可以释放，而不是等待外部运行超时。
- 启用诊断后，在 `diagnostics.stuckSessionWarnMs` 之后保留在 `processing` 中的会话会记录卡住会话警告。默认情况下，活动的嵌入式运行、活动的回复操作和活动的通道任务仅保持警告状态；没有活动会话工作的陈旧启动簿记可以释放受影响的会话通道，从而耗尽排队的工作。

## 相关

- [会话管理](/concepts/session)
- [转向队列](/concepts/queue-steering)
- [重试策略](/concepts/retry)
