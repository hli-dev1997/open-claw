---
summary: "How active-run steering queues messages at runtime boundaries"
read_when:
  - Explaining how steer behaves while an agent is using tools
  - Changing active-run queue behavior or runtime steering integration
  - Comparing steer, queue, collect, and followup modes
title: "Steering queue"
---

当会话运行已经在流式传输时消息到达时，OpenClaw 可以
将该消息发送到活动运行时，而不是启动另一次运行
同一个会话。公共模式与运行时无关；Pi 和原生 Codex
app-server harness 会以不同方式实现交付细节。

## 运行时边界

转向不会中断已在运行的工具调用。 Pi 检查
在模型边界排队的转向消息：

1. 助手请求工具调用。
2. Pi 执行当前辅助消息的工具调用批处理。
3. Pi 发出回合结束事件。
4. Pi 排出排队的转向消息。
5. Pi 在下一次 LLM 调用之前将这些消息作为用户消息附加。

这使得工具结果与请求它们的助手消息配对，
然后让下一个模型调用查看最新的用户输入。

原生 Codex app-server harness 暴露 `turn/steer`，而不是 Pi 的
内部 steering 队列。OpenClaw 在那里适配相同的模式：

- `steer` 为配置的安静窗口批量排队消息，然后发送
  单个 `turn/steer` 请求，其中包含按到达顺序收集的所有用户输入。
- `queue` 通过发送单独的 `turn/steer` 来保持旧的序列化形状
  请求。
- `followup`、`collect`、`steer-backlog` 和 `interrupt` 仍由 OpenClaw 拥有
  活动 Codex 轮周围的队列行为。

Codex 审查和手动压缩轮次会拒绝同轮 steering。当某个
运行时无法接受转向，OpenClaw 回退到后续队列，其中
该模式允许。

## 模式

|模式|主动运行行为 |后期跟进行为 |
| ---------------- | ---------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------- |
| `steer` | `steer`在下一个运行时边界将所有排队的转向消息注入在一起。这是默认设置。                             |仅当转向不可用时才返回跟随。                           |
| `queue` |传统的一次一次转向。 Pi 每个模型边界注入一条排队消息； Codex 发送单独的 `turn/steer` 请求。 |仅当转向不可用时才返回跟随。                           |
| `steer-backlog` |与 `steer` 相同的主动运行转向行为。                                                                                |还保留相同的消息以供以后的后续回合使用。                              |
| `followup` |不引导当前运行。                                                                                              |稍后运行排队的消息。                                                         |
| `collect` |不引导当前运行。                                                                                              |在 debounce 窗口后，将兼容的排队消息合并到一个稍后的轮次中。 |
| `interrupt` |中止活动运行，然后开始最新消息。                                                                       |没有任何。                                                                               |

## 突发示例

如果智能体执行工具调用时有四个用户发送消息：

- `steer`：活动运行时按照到达顺序接收所有四个消息
  其下一个模型决策。 Pi 在下一个模型边界处耗尽它们； Codex
  将它们作为一批 `turn/steer` 接收。
- `queue`：传统序列化转向。 Pi 一次注入一条排队消息；
  Codex 接收单独的 `turn/steer` 请求。
- `collect`：OpenClaw 等待活动运行结束，然后在 debounce 窗口之后，
  使用兼容的排队消息创建一个后续轮次。

## 范围

转向始终以当前活动会话运行为目标。它不会创建新的
会话、更改活动运行的工具策略或按发件人拆分消息。在
多用户通道，入站提示已包含发件人和路由上下文，因此
下一个模型调用可以看到谁发送了每条消息。

当你希望 OpenClaw 构建稍后的后续回合时，请使用 `collect`
合并兼容消息并保留后续队列丢弃策略。使用
`queue` 仅当你需要较旧的一次一次转向行为时。

## 去抖

`messages.queue.debounceMs` 适用于后续交付，包括 `collect`，
当主动运行转向未启用时，`followup`、`steer-backlog` 和 `steer` 回退
可用。对于 Pi，活动的 `steer` 本身不使用去抖动定时器，因为
Pi 会自然地批处理消息，直到下一个模型边界。对于原生
Codex harness，OpenClaw 使用相同的 debounce 值作为 quiet window，然后
发送批量的 `turn/steer`。

## 相关

- [命令队列](/concepts/queue)
- [消息](/concepts/messages)
- [智能体循环](/concepts/agent-loop)
