---
summary: "Message flow, sessions, queueing, and reasoning visibility"
read_when:
  - Explaining how inbound messages become replies
  - Clarifying sessions, queueing modes, or streaming behavior
  - Documenting reasoning visibility and usage implications
title: "Messages"
---

OpenClaw 通过会话解析、排队、流式传输、工具执行和推理可见性管道处理入站消息。此页面映射从入站消息到回复的路径。

## 消息流（高级）

```
Inbound message
  -> routing/bindings -> session key
  -> queue (if a run is active)
  -> agent run (streaming + tools)
  -> outbound replies (channel limits + chunking)
```

关键旋钮位于配置中：

- `messages.*` 用于前缀、排队和组行为。
- `agents.defaults.*` 用于块流和分块默认值。
- 用于上限和流切换的通道覆盖（`channels.whatsapp.*`、`channels.telegram.*` 等）。

有关完整架构，请参阅[配置](/gateway/configuration)。

## 入站重复数据删除

通道可以在重新连接后重新传递相同的消息。 OpenClaw 保留
短期缓存由通道/帐户/对等/会话/消息 ID 键入，因此重复
交付不会触发另一个智能体运行。

## 入站去抖

来自**同一发件人**的快速连续消息可以批量化为单个消息
智能体通过 `messages.inbound` 转向。去抖的范围是每个频道 + 对话
并使用最新消息进行回复线程/ID。

配置（全局默认值+每个通道覆盖）：

```json5
{
  messages: {
    inbound: {
      debounceMs: 2000,
      byChannel: {
        whatsapp: 5000,
        slack: 1500,
        discord: 1500,
      },
    },
  },
}
```

注意事项：

- 去抖适用于**纯文本**消息；介质/附件立即冲洗。
- 控制命令绕过去抖，因此它们保持独立 - **除非**当通道明确选择同一发送者 DM 合并 (e.g.[BlueBubbles `coalesceSameSenderDms`](/channels/bluebubbles#coalescing-split-send-dms-command--url-in-one-composition)) 时，其中 DM 命令在去抖窗口内等待，以便拆分发送有效负载可以加入同一智能体回合。

## 会话和设备

会话由网关拥有，而不是由客户端拥有。

- 直接聊天折叠到智能体主会话密钥中。
- 组/频道获得自己的会话密钥。
- 会话存储和记录位于网关主机上。

多个设备/通道可以映射到同一会话，但历史记录不完整
同步回每个客户端。建议：长期使用一台主要设备
对话以避免不同的上下文。 Control UI 和 TUI 始终显示
网关支持的会话记录，因此它们是事实的来源。

详细信息：[会话管理](/concepts/session)。

## 工具结果元数据

工具结果 `content` 是模型可见结果。工具结果 `details` 是
用于 UI 渲染、诊断、媒体传输和插件的运行时元数据。

OpenClaw 保持该边界明确：

- `toolResult.details` 在提供商重播和压缩输入之前被剥离。
- 持久会话记录仅保留有界的 `details`；过大的元数据
  替换为标记为 `persistedDetailsTruncated: true` 的紧凑摘要。
- Plugins 并且工具应该将模型必须读取的文本放入 `content` 中，而不仅仅是
  在 `details` 中。

## 入站主体和历史背景

OpenClaw 将 **提示体** 与 **命令体** 分开：

- `BodyForAgent`：当前消息的主要面向模型的文本。频道
  插件应将其重点放在发件人当前的提示文本上。
- `Body`：旧版提示回退。这可能包括通道包络和
  可选的历史记录包装器，但当前通道不应依赖它作为
  当 `BodyForAgent` 可用时的主要模型输入。
- `CommandBody`：用于指令/命令解​​析的原始用户文本。
- `RawBody`：`CommandBody` 的旧别名（为了兼容性而保留）。

当通道提供历史记录时，它使用共享包装器：

- `[Chat messages since your last reply - for context]`
- `[Current message - respond to this]`

对于**非直接聊天**（群组/频道/房间），**当前消息正文**带有前缀
发件人标签（与历史记录条目使用的样式相同）。这可以保持实时和排队/历史记录
消息与智能体提示一致。

历史缓冲区是 **仅待处理**：它们包括*未*执行的组消息
触发运行（例如，提及门控消息）和 **排除** 消息
已经在会议记录中。

指令剥离仅适用于**当前消息**部分，因此历史记录
保持完好无损。包含历史记录的通道应设置 `CommandBody` （或
`RawBody`) 到原始消息文本，并保留 `Body` 作为组合提示。
结构化历史记录、回复、转发和频道元数据呈现为
在提示组装期间，用户角色不受信任的上下文会被阻止。
历史缓冲区可通过 `messages.groupChat.historyLimit` （全局
默认值）和每通道覆盖，如 `channels.slack.historyLimit` 或
`channels.telegram.accounts.<id>.historyLimit`（将 `0` 设置为禁用）。

## 排队和跟进

如果运行已经处于活动状态，则入站消息可以排队，并引导至
当前运行，或为后续回合收集。

- 通过 `messages.queue` （和 `messages.queue.byChannel`）进行配置。
- 默认模式为 `steer`，当转向下降时有 500ms 的后续去抖
  返回排队的后续交付。
- 模式：`steer`、`followup`、`collect`、`steer-backlog`、`interrupt` 以及
  传统的一次一个 `queue` 模式。

详细信息：[命令队列](/concepts/queue) 和[转向队列](/concepts/queue-steering)。

## 频道运营所有权

通道插件可以保留排序、反跳输入和应用传输
消息进入会话队列之前的反压。他们不应该强加
智能体轮流自身的单独超时。一旦消息被路由到
会话，长时间运行的工作由会话、工具和运行时控制
生命周期，以便所有通道一致地报告并从慢转中恢复。

## 流式传输、分块和批处理

当模型生成文本块时，块流发送部分回复。
分块尊重通道文本限制并避免分割受保护的代码。

按键设置：

- `agents.defaults.blockStreamingDefault`（`on|off`，默认关闭）
- `agents.defaults.blockStreamingBreak` (`text_end|message_end`)
- `agents.defaults.blockStreamingChunk` (`minChars|maxChars|breakPreference`)
- `agents.defaults.blockStreamingCoalesce`（基于空闲的批处理）
- `agents.defaults.humanDelay` （块回复之间类似人类的暂停）
- 通道覆盖：`*.blockStreaming` 和 `*.blockStreamingCoalesce`（非 Telegram 通道需要显式 `*.blockStreaming: true`）

详细信息：[流+分块](/concepts/streaming)。

## 推理可见性和标记

OpenClaw 可以公开或隐藏模型推理：

- `/reasoning on|off|stream` 控制可见性。
- 当模型生成时，推理内容仍然计入token使用量。
- Telegram 支持推理流进入草稿气泡。

详细信息：[思考+推理指令](/tools/thinking)和[token使用](/reference/token-use)。

## 前缀、线程和回复

出站消息格式集中在 `messages` 中：

- `messages.responsePrefix`、`channels.<channel>.responsePrefix` 和 `channels.<channel>.accounts.<id>.responsePrefix`（出站前缀级联），加上 `channels.whatsapp.messagePrefix`（WhatsApp 入站前缀）
- 通过 `replyToMode` 和每通道默认值回复线程

详细信息：[配置](/gateway/config-agents#messages) 和通道文档。

## 无声回复

确切的静默标记 `NO_REPLY` / `no_reply` 表示“不提供用户可见的回复”。
当回合还有待处理的工具媒体时，例如生成的 TTS 音频、OpenClaw
删除无声文本，但仍传递媒体附件。
OpenClaw 通过对话类型解决该行为：

- 直接对话默认不允许静音，并重写了裸露的静音
  回复简短可见的后备。
- 默认情况下，组/频道允许静音。
- 内部编排默认允许静默。

OpenClaw 还对发生的内部运行器故障使用静默回复
在任何助理在非直接聊天中回复之前，因此群组/频道看不到
网关错误样板。直接聊天默认显示紧凑的故障副本；
仅当 `/verbose` 为 `on` 或 `full` 时，才会显示原始运行程序详细信息。

默认值位于 `agents.defaults.silentReply` 下并且
`agents.defaults.silentReplyRewrite`； `surfaces.<id>.silentReply` 和
`surfaces.<id>.silentReplyRewrite` 可以按每个表面覆盖它们。

当父会话有一个或多个待生成的子智能体运行时，裸露
无声回复会被丢弃在所有表面上而不是被重写，因此
父级保持安静，直到子级完成事件提供真正的答复。

## 相关

- [Streaming](/concepts/streaming) — 实时消息传递
- [Retry](/concepts/retry) — 消息传递重试行为
- [Queue](/concepts/queue) — 消息处理队列
- [Channels](/channels) — 消息传递平台集成
