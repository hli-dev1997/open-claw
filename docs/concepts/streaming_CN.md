---
summary: "Streaming + chunking behavior (block replies, channel preview streaming, mode mapping)"
read_when:
  - Explaining how streaming or chunking works on channels
  - Changing block streaming or channel chunking behavior
  - Debugging duplicate/early block replies or channel preview streaming
title: "Streaming and chunking"
---

OpenClaw 有两个独立的流层：

- **块流（通道）：**在助手写入时发出已完成的**块**。这些是正常的通道消息（不是 token 增量）。
- **预览流（Telegram/Discord/Slack）：**在生成时更新临时**预览消息**。

目前**没有真正的 token-delta 流**会发送到通道消息。预览流是基于消息的（发送 + 编辑/追加）。

## 块流（通道消息）

块流式传输会在助手输出可用时，以较粗粒度的块发送这些输出。

```
Model output
  └─ text_delta/events
       ├─ (blockStreamingBreak=text_end)
       │    └─ chunker emits blocks as buffer grows
       └─ (blockStreamingBreak=message_end)
            └─ chunker flushes at message_end
                   └─ channel send (block replies)
```

图例：

- `text_delta/events`：模型流事件（对于非流模型可能稀疏）。
- `chunker`：`EmbeddedBlockChunker` 应用最小/最大边界+中断首选项。
- `channel send`：实际出站消息（块回复）。

**控制：**

- `agents.defaults.blockStreamingDefault`：`"on"`/`"off"`（默认关闭）。
- 通道覆盖：`*.blockStreaming`（和每个帐户变体）以强制每个通道 `"on"`/`"off"`。
- `agents.defaults.blockStreamingBreak`：`"text_end"` 或 `"message_end"`。
- `agents.defaults.blockStreamingChunk`：`{ minChars, maxChars, breakPreference? }`。
- `agents.defaults.blockStreamingCoalesce`：`{ minChars?, maxChars?, idleMs? }`（发送前合并流块）。
- 通道硬上限：`*.textChunkLimit` (e.g.、`channels.whatsapp.textChunkLimit`)。
- 通道块模式：`*.chunkMode`（`length` 默认值，`newline` 在长度分块之前在空白行（段落边界）上分割）。
- Discord 软上限：`channels.discord.maxLinesPerMessage` （默认 17）拆分高回复以避免 UI 剪裁。

**边界语义：**

- `text_end`：一旦 chunker 发出，流就会阻塞；冲洗每个 `text_end`。
- `message_end`：等待助理消息完成，然后刷新缓冲的输出。

如果缓冲文本超过 `message_end` ，则 `message_end` 仍使用分块器，因此它可以在末尾发出多个块。

### 使用块流媒体传输

`MEDIA:` 指令是正常传递元数据。当块流发送
媒体块，OpenClaw 会记住该轮次的交付。如果最终
助手载荷重复相同的媒体 URL，最终交付会剥离
重复媒体，而不是再次发送附件。

完全重复的最终载荷会被抑制。如果最终载荷添加了
已经流式传输的媒体周围有不同的文本，OpenClaw 仍然发送
新文本，同时保持媒体只交付一次。这可以防止重复的语音
当智能体在 `MEDIA:` 期间发出 `MEDIA:` 时，通道上的注释或文件，例如 Telegram
流式传输，提供商也将其包含在完成的回复中。

## 分块算法（低/高界）

块分块由 `EmbeddedBlockChunker` 实现：

- **下限：** 在缓冲区 >= `minChars` 之前不会发出（除非强制）。
- **上限：**更喜欢在 `maxChars` 之前进行分割；如果强制，请在 `maxChars` 处拆分。
- **中断偏好：** `paragraph` → `newline` → `sentence` → `whitespace` → 硬中断。
- **代码围栏：**切勿在围栏内分裂；当强制执行 `maxChars` 时，关闭并重新打开栅栏以保持 Markdown 有效。

`maxChars` 被固定到通道 `textChunkLimit`，因此不能超过每个通道的上限。

## 合并（合并流块）

启用块流时，OpenClaw 可以在发送前**合并连续的块**。
这会减少“单行刷屏”，同时仍然提供
渐进式输出。

- 合并在刷新之前等待 **空闲间隙** (`idleMs`)。
- 缓冲区的上限为 `maxChars` ，如果超过它，将会刷新。
- `minChars` 防止发送微小片段，直到积累足够的文本
  （最终刷新始终发送剩余文本）。
- Joiner 源自 `blockStreamingChunk.breakPreference`
  （`paragraph` → `\n\n`、`newline` → `\n`、`sentence` → 空格）。
- 通道覆盖可通过 `*.blockStreamingCoalesce` 获得（包括每个帐户的配置）。
- Signal/Slack/Discord 的默认合并 `minChars` 会提升到 1500，除非被覆盖。

## 块之间的类人步调

启用块流时，你可以在之间添加 **随机暂停**
块回复（在第一个块之后）。这使得多气泡响应感觉
更自然。

- 配置：`agents.defaults.humanDelay`（通过 `agents.list[].humanDelay` 覆盖每个智能体）。
- 模式：`off`（默认）、`natural`（800–2500ms）、`custom`（`minMs`/`maxMs`）。
- 仅适用于**阻止回复**，不适用于最终回复或工具摘要。

##“流式传输块或所有内容”

这映射到：

- **流块：** `blockStreamingDefault: "on"` + `blockStreamingBreak: "text_end"` （边走边发出）。非Telegram通道也需要`*.blockStreaming: true`。
- **最后流式传输所有内容：** `blockStreamingBreak: "message_end"` （刷新一次，如果很长，可能会刷新多个块）。
- **无块流：** `blockStreamingDefault: "off"`（仅最终答复）。

**频道注意：** 块流式传输 **关闭，除非**
`*.blockStreaming` 显式设置为 `true`。频道可以实时预览
(`channels.<channel>.streaming`) 没有块回复。

配置位置提醒：`blockStreaming*`默认位于下
`agents.defaults`，不是根配置。

## 预览流模式

规范密钥：`channels.<channel>.streaming`

模式：

- `off`：禁用预览流。
- `partial`：单个预览被最新文本替换。
- `block`：以分块/附加步骤预览更新。
- `progress`：生成期间的进度/状态预览，完成时的最终答案。

### 频道映射

|频道| `off` | `partial` | `block` | `progress` |
| ---------- | -----| --------- | -------- | ----------------- |
| Telegram | ✅ | ✅ | ✅ |映射到 `partial` |
| Discord | ✅ | ✅ | ✅ |映射到 `partial` |
| Slack | ✅ | ✅ | ✅ | ✅ |
|最重要| ✅ | ✅ | ✅ | ✅ |

仅Slack：

- `channels.slack.streaming.nativeTransport` 在 `channels.slack.streaming.mode="partial"` 时切换 Slack 本机流 API 调用（默认值：`true`）。
- Slack 本机流和 Slack 辅助线程状态需要回复线程目标；顶级 DM 不显示线程式预览。

旧密钥迁移：

- Telegram：传统 `streamMode` 和标量/布尔 `streaming` 值由医生/配置兼容性路径检测并迁移到 `streaming.mode`。
- Discord: `streamMode` + 布尔值 `streaming` 自动迁移到 `streaming` 枚举。
- Slack：`streamMode` 自动迁移到 `streaming.mode`； boolean `streaming` 自动迁移到 `streaming.mode` 加上 `streaming.nativeTransport`；旧版 `nativeStreaming` 自动迁移到 `streaming.nativeTransport`。

### 运行时行为

Telegram：

- 使用 `sendMessage` + `editMessageText` 跨 DM 和组/主题预览更新。
- 当预览可见约一分钟时，发送新的最终消息而不是就地编辑，然后清理预览，以便 Telegram 的时间戳反映回复完成情况。
- 当显式启用 Telegram 块流时，将跳过预览流（以避免双流）。
- `/reasoning stream` 可以编写推理来预览。

Discord：

- 使用发送+编辑预览消息。
- `block` 模式使用草稿分块 (`draftChunk`)。
- 当显式启用 Discord 块流时，将跳过预览流。
- 最终媒体、错误和显式回复有效负载取消挂起的预览而不刷新新草稿，然后使用正常传送。

Slack：

- `partial` 可以使用 Slack 本机流式传输 (`chat.startStream`/`append`/`stop`)（如果可用）。
- `block` 使用附加样式草稿预览。
- `progress` 使用状态预览文本，然后使用最终答案。
- 本机和草稿预览流抑制该回合的块回复，因此 Slack 回复仅通过一个传递路径进行流式传输。
- 最终媒体/错误有效负载和进度最终不会创建一次性草稿消息；仅可以编辑预览刷新待定草稿文本的文本/块决赛。

最重要的是：

- 将思考、工具活动和部分回复文本流式传输到单个草稿预览帖子中，当最终答案可以安全发送时，该帖子将最终确定。
- 如果预览帖子已被删除或在最终确定时不可用，则返回发送新的最终帖子。
- 最终媒体/错误有效负载在正常交付之前取消挂起的预览更新，而不是刷新临时预览帖子。

Matrix：

- 当最终文本可以重用预览事件时，草稿预览就完成了。
- 仅媒体、错误和回复目标不匹配决赛在正常交付之前取消待定的预览更新；已经可见的陈旧预览已被编辑。

### 工具进度预览更新

预览流还可以包括**工具进度**更新 - 简短的状态行，例如“搜索网络”、“读取文件”或“调用工具” - 在工具运行时、在最终回复之前出现在同一预览消息中。这使得多步骤工具在第一次思考预览和最终答案之间保持视觉上的活跃而不是沉默。

支持的表面：

- 当预览流处于活动状态时，**Discord**、**Slack**、**Telegram** 和 **Matrix** 默认情况下将工具进度流式传输到实时预览编辑中。
- Telegram 自 `v2026.4.22` 起已启用工具进度预览更新；保持它们启用可以保留已发布的行为。
- **Mattermost** 已经将工具活动折叠到其单个草稿预览帖子中（见上文）。
- 工具进度编辑遵循活动预览流模式；当预览流为 `off` 或块流接管消息时，它们将被跳过。在 Telegram 上，`streaming.mode: "off"` 仅是最终的：通用进度喋喋不休也被抑制，而不是作为独立的“正在工作...”消息传递，而批准提示、媒体负载和错误仍然正常路由。
- 要保持预览流但隐藏工具进度线，请将该通道的 `streaming.preview.toolProgress` 设置为 `false`。要完全禁用预览编辑，请将 `streaming.mode` 设置为 `off`。

例子：

```json
{
  "channels": {
    "telegram": {
      "streaming": {
        "mode": "partial",
        "preview": {
          "toolProgress": false
        }
      }
    }
  }
}
```

## 相关

- [消息](/concepts/messages) — 消息生命周期和传递
- [Retry](/concepts/retry) — 交付失败时的重试行为
- [Channels](/channels) — 每通道流媒体支持
