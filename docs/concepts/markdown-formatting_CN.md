---
summary: "Markdown formatting pipeline for outbound channels"
read_when:
  - You are changing markdown formatting or chunking for outbound channels
  - You are adding a new channel formatter or style mapping
  - You are debugging formatting regressions across channels
title: "Markdown formatting"
---

OpenClaw 通过将出站 Markdown 转换为共享中间体来格式化它
渲染特定通道输出之前的表示 (IR)。 IR 保持
源文本完好无损，同时携带样式/链接跨度，因此分块和渲染可以
跨渠道保持一致。

## 目标

- **一致性：** 一个解析步骤，多个渲染器。
- **安全分块：** 在渲染之前分割文本，因此内联格式永远不会
  打破块。
- **通道适配：** 将相同的 IR 映射到 Slack mrkdwn、Telegram HTML 和 Signal
  样式范围，无需重新解析 Markdown。

## 管道

1. **解析 Markdown -> IR**
   - IR 是纯文本加上样式跨度（粗体/斜体/删除线/代码/剧透）和链接跨度。
   - 偏移量为 UTF-16 个代码单元，因此 Signal 样式范围与其 API 对齐。
   - 仅当通道选择表转换时才会解析表。
2. **块 IR（格式优先）**
   - 在渲染之前对 IR 文本进行分块。
   - 内联格式化不会跨块分割； Span 按块进行切片。
3. **每通道渲染**
   - **Slack：** mrkdwn token（粗体/斜体/罢工/代码），链接为 `<url|label>`。
   - **Telegram:** HTML 标签 (`<b>`, `<i>`, `<s>`, `<code>`, `<pre><code>`, `<a href>`)。
   - **Signal:** 纯文本 + `text-style` 范围；当标签不同时，链接变为 `label (url)` 。

## 红外示例

输入Markdown：

```markdown
Hello **world** — see [docs](https://docs.openclaw.ai).
```

红外（原理图）：

```json
{
  "text": "Hello world — see docs.",
  "styles": [{ "start": 6, "end": 11, "style": "bold" }],
  "links": [{ "start": 19, "end": 23, "href": "https://docs.openclaw.ai" }]
}
```

## 使用地点

- Slack、Telegram 和 Signal 出站适配器从 IR 渲染。
- 其他通道（WhatsApp、iMessage、Microsoft Teams、Discord）仍然使用纯文本或
  他们自己的格式化规则，之前应用了 Markdown 表转换
  启用时分块。

## 表处理

Markdown 表在聊天客户端中并未得到一致支持。使用
`markdown.tables` 控制每个通道（和每个帐户）的转换。

- `code`：将表渲染为代码块（大多数通道的默认值）。
- `bullets`：将每一行转换为项目符号点（默认为 Signal + WhatsApp）。
- `off`：禁用表解析和转换；原始表格文本通过。

配置键：

```yaml
channels:
  discord:
    markdown:
      tables: code
    accounts:
      work:
        markdown:
          tables: off
```

## 分块规则

- 块限制来自通道适配器/配置并应用于 IR 文本。
- 代码栅栏被保留为带有尾随换行符的单个块，以便通道
  正确渲染它们。
- 列表前缀和块引用前缀是 IR 文本的一部分，因此分块
  不分割中间前缀。
- 内联样式（粗体/斜体/删除线/内联代码/剧透）永远不会被分割
  大块；渲染器重新打开每个块内的样式。

如果你需要更多有关跨渠道分块行为的信息，请参阅
[流+分块](/concepts/streaming)。

## 链接政策

- **Slack:** `[label](url)` -> `<url|label>`;裸 URL 保持裸露状态。自动链接
  在解析期间禁用以避免双重链接。
- **Telegram:** `[label](url)` -> `<a href="url">label</a>` （HTML 解析模式）。
- **Signal:** `[label](url)` -> `label (url)` 除非标签与 URL 匹配。

## 剧透

剧透标记 (`||spoiler||`) 仅针对 Signal 进行解析，它们映射到
SPOILER 样式范围。其他渠道将它们视为纯文本。

## 如何添加或更新通道格式化程序

1. **解析一次：** 使用适合通道的共享 `markdownToIR(...)` 帮助程序
   选项（自动链接、标题样式、块引用前缀）。
2. **渲染：** 使用 `renderMarkdownWithMarkers(...)` 和一个
   样式标记图（或 Signal 样式范围）。
3. **Chunk：**渲染前调用`chunkMarkdownIR(...)`；渲染每个块。
4. **Wire 适配器：** 更新通道出站适配器以使用新的分块器
   和渲染器。
5. **测试：** 添加或更新格式测试和外向交货测试（如果
   通道使用分块。

## 常见问题

- Slack 尖括号标记（`<@U123>`、`<#C123>`、`<https://...>`）必须
  保留；安全地转义原始 HTML。
- Telegram HTML 需要将文本转义到标签之外以避免标记损坏。
- Signal 样式范围取决于 UTF-16 偏移量；不要使用代码点偏移。
- 保留受隔离代码块的尾随换行符，以便关闭标记落地
  他们自己的线路。

## 相关

- [流和分块](/concepts/streaming)
- [系统提示词](/concepts/system-prompt)
