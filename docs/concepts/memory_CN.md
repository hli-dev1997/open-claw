---
summary: "How OpenClaw remembers things across sessions"
title: "Memory overview"
read_when:
  - You want to understand how memory works
  - You want to know what memory files to write
---

OpenClaw 通过在智能体的文件中写入**普通 Markdown 文件**来记住事情
工作区。该模型仅“记住”保存到磁盘的内容 - 没有
隐藏状态。

## 它是如何工作的

你的智能体有三个与内存相关的文件：

- **`MEMORY.md`** — 长期记忆。持久的事实、偏好和
  决定。在每个 DM 会话开始时加载。
- **`memory/YYYY-MM-DD.md`** — 每日笔记。运行上下文和观察结果。
  今天和昨天的笔记会自动加载。
- **`DREAMS.md`** (可选) — 梦想日记和梦想扫描
  供人工审核的摘要，包括接地的历史回填条目。

这些文件位于智能体工作区中（默认为 `~/.openclaw/workspace`）。

<Tip>
如果你想让你的智能体记住一些事情，只要问它：“记住我
更喜欢 TypeScript。”它将把它写入适当的文件。
</Tip>

## 推断承诺

一些未来的后续行动并不是持久的事实。如果你提到面试
明天，有用的记忆可能是“面试后签到”，而不是“存储”
这永远在 `MEMORY.md` 中。”

[承诺](/concepts/commitments) 是选择加入的、短暂的后续记忆
对于这种情况。 OpenClaw 在隐藏的后台通道中推断它们，将它们范围限定为
相同的座席和渠道，并通过心跳交付到期签到。
显式提醒仍然使用[计划任务](/automation/cron-jobs)。

## 记忆工具

该智能体有两个用于处理内存的工具：

- **`memory_search`** — 使用语义搜索查找相关注释，即使在
  措辞与原文不同。
- **`memory_get`** — 读取特定内存文件或行范围。

这两个工具均由活动内存插件提供（默认值：`memory-core`）。

## Memory Wiki 配套插件

如果你希望持久内存的行为更像是维护的知识库而不是
只是原始笔记，使用捆绑的 `memory-wiki` 插件。

`memory-wiki` 将持久知识编译到 wiki 库中：

- 确定性页面结构
- 结构化的主张和证据
- 矛盾和新鲜度追踪
- 生成的仪表板
- 为智能体/运行时消费者编译摘要
- wiki 原生工具，例如 `wiki_search`、`wiki_get`、`wiki_apply` 和 `wiki_lint`

它不会取代活动内存插件。活动内存插件仍然
拥有回忆、晋升和梦想。 `memory-wiki` 添加了来源丰富的
旁边的知识层。

请参阅[内存维基](/plugins/memory-wiki)。

## 内存搜索

配置嵌入提供商时，`memory_search` 使用 **hybrid
search** — 将向量相似度（语义）与关键字匹配相结合
（确切的术语，如 ID 和代码符号）。一旦你拥有了，这就是开箱即用的
任何受支持的提供商的 API 密钥。

<Info>
OpenClaw 从可用的 API 键中自动检测你的嵌入提供商。如果你
配置了 OpenAI、Gemini、Voyage 或 Mistral 键，内存搜索为
自动启用。
</Info>

有关搜索工作原理、调整选项和提供商设置的详细信息，请参阅
[内存搜索](/concepts/memory-search)。

## 内存后端

<CardGroup cols={3}>
<Card title="Builtin (default)" icon="database" href="/concepts/memory-builtin">
基于 SQLite。开箱即用，具有关键字搜索、向量相似度和
混合搜索。没有额外的依赖。
</Card>
<Card title="QMD" icon="search" href="/concepts/memory-qmd">
具有重新排序、查询扩展和索引能力的本地优先 sidecar
工作区之外的目录。
</Card>
<Card title="Honcho" icon="brain" href="/concepts/memory-honcho">
AI 原生跨会话内存，具有用户建模、语义搜索和
多智能体意识。 Plugin 安装。
</Card>
<Card title="LanceDB" icon="layers" href="/plugins/memory-lancedb">
捆绑 LanceDB 支持的内存，具有 OpenAI 兼容的嵌入、自动调用、
自动捕获和本地 Ollama 嵌入支持。
</Card>
</CardGroup>

## 知识wiki层

<CardGroup cols={1}>
<Card title="Memory Wiki" icon="book" href="/plugins/memory-wiki">
将持久内存编译到来源丰富的 wiki 库中，并附有声明，
仪表板、桥接模式和黑曜石友好的工作流程。
</Card>
</CardGroup>

## 自动内存刷新

在 [compaction](/concepts/compaction) 总结你的对话之前，OpenClaw
运行无声转弯，提醒智能体将重要上下文保存到内存中
文件。默认情况下此功能处于启用状态 - 你无需配置任何内容。

为了使内务处理保持在本地模型上，请设置精确的内存刷新模型
覆盖：

```json
{
  "agents": {
    "defaults": {
      "compaction": {
        "memoryFlush": {
          "model": "ollama/qwen3:8b"
        }
      }
    }
  }
}
```

覆盖仅适用于记忆刷新回合，不会继承
活动会话后备链。

<Tip>
内存刷新可防止压缩期间上下文丢失。如果你的智能体有
对话中尚未写入文件的重要事实，它们
将在摘要发生之前自动保存。
</Tip>

## 做梦

做梦是记忆的可选背景巩固过程。它收集
短期信号，对候选人进行评分，并仅将合格的项目提升到
长期记忆（`MEMORY.md`）。

它旨在保持长期记忆高信号：

- **选择加入**：默认禁用。
- **预定**：启用后，`memory-core` 自动管理一个重复的 cron 作业
  进行一次完整的梦想扫荡。
- **阈值**：促销必须通过评分、召回频率和查询
  多样性之门。
- **可审阅**：阶段总结和日记条目写入 `DREAMS.md`
  供人工审查。

有关相位行为、评分信号和梦想日记的详细信息，请参阅
[做梦](/concepts/dreaming)。

## 落地回填和直播推广

梦想系统现在有两条密切相关的审查通道：

- **现场梦想** 来自短期梦想商店的作品
  `memory/.dreams/` 是正常深度阶段在决定什么时使用的
  可以毕业进入`MEMORY.md`。
- **接地回填**将历史 `memory/YYYY-MM-DD.md` 注释读取为
  独立的日文件并将结构化审阅输出写入 `DREAMS.md`。

当你想要重播较旧的音符并检查内容时，接地回填非常有用
系统认为是持久的，无需手动编辑`MEMORY.md`。

当你使用：

```bash
openclaw memory rem-backfill --path ./memory --stage-short-term
```

留守的持久候选人不会直接晋升。他们分阶段进入
与正常深度阶段已经使用的短期梦想存储相同。那
意思是：

- `DREAMS.md` 保留人工审核界面。
- 短期商店保留面向机器的排名表面。
- `MEMORY.md` 仍然仅由深度提升写入。

如果你认为重播没有用，你可以删除分阶段的工件
不触及普通日记条目或正常回忆状态：

```bash
openclaw memory rem-backfill --rollback
openclaw memory rem-backfill --rollback-short-term
```

## CLI

```bash
openclaw memory status          # Check index status and provider
openclaw memory search "query"  # Search from the command line
openclaw memory index --force   # Rebuild the index
```

## 进一步阅读

- [内置内存引擎](/concepts/memory-builtin)：默认SQLite后端。
- [QMD 内存引擎](/concepts/memory-qmd)：高级本地优先 sidecar。
- [Honcho 内存](/concepts/memory-honcho)：AI 原生跨会话内存。
- [内存LanceDB](/plugins/memory-lancedb)：LanceDB支持的插件，具有OpenAI兼容的嵌入。
- [Memory Wiki](/plugins/memory-wiki)：编译的知识库和 wiki 原生工具。
- [内存搜索](/concepts/memory-search)：搜索管道、提供商和调整。
- [做梦](/concepts/dreaming)：从短期回忆到长期记忆的背景提升。
- [内存配置参考](/reference/memory-config)：所有配置旋钮。
- [Compaction](/concepts/compaction)：压缩如何与内存交互。

## 相关

- [活动内存](/concepts/active-memory)
- [内存搜索](/concepts/memory-search)
- [内置内存引擎](/concepts/memory-builtin)
- [Honcho 内存](/concepts/memory-honcho)
- [内存LanceDB](/plugins/memory-lancedb)
- [承诺](/concepts/commitments)
