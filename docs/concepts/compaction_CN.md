---
summary: "How OpenClaw summarizes long conversations to stay within model limits"
read_when:
  - You want to understand auto-compaction and /compact
  - You are debugging long sessions hitting context limits
title: "Compaction"
---

每个模型都有一个上下文窗口：它可以处理的最大token数。当对话接近该限制时，OpenClaw **将**旧消息压缩为摘要，以便聊天可以继续。

## 它是如何工作的

1. 较旧的对话被总结为一个紧凑的条目。
2. 摘要保存在会话记录中。
3.最近的消息保持完整。

当 OpenClaw 将历史记录分割为压缩块时，它使辅助工具调用与其匹配的 `toolResult` 条目配对。如果分割点落在工具块内，则 OpenClaw 会移动边界，使该对保持在一起，并保留当前未汇总的尾部。

完整的对话历史记录保留在磁盘上。压缩只会改变模型在下一回合看到的内容。

## 自动压缩

默认情况下自动压缩处于启用状态。当会话接近上下文限制或模型返回上下文溢出错误时（在这种情况下 OpenClaw 压缩并重试），它会运行。

你会看到：

- `🧹 Auto-compaction complete` 处于详细模式。
- `/status` 显示 `🧹 Compactions: <count>`。

<Info>
在压缩之前，OpenClaw会自动提醒智能体将重要注释保存到[内存](/concepts/memory)文件中。这可以防止上下文丢失。
</Info>

<AccordionGroup>
  <Accordion title="Recognized overflow signatures">
    OpenClaw 从这些提供商错误模式中检测上下文溢出：

    - `request_too_large`
    - `context length exceeded`
    - `input exceeds the maximum number of tokens`
    - `input token count exceeds the maximum number of input tokens`
    - `input is too long for the model`
    - `ollama error: context length exceeded`

  </Accordion>
</AccordionGroup>

## 手动压实

在任何聊天中键入 `/compact` 以强制压缩。添加说明来指导摘要：

```
/compact Focus on the API design decisions
```

当设置 `agents.defaults.compaction.keepRecentTokens` 时，手动压缩会遵循 Pi 切点，并将最近的尾部保留在重建的上下文中。如果没有明确的保留预算，手动压缩将充当硬检查点并仅从新摘要继续。

## 配置

在 `openclaw.json` 中的 `agents.defaults.compaction` 下配置压缩。下面列出了最常见的旋钮；有关完整参考，请参阅[会话管理深入探讨](/reference/session-management-compaction)。

### 使用不同的模型

默认情况下，压缩使用智能体的主要模型。设置 `agents.defaults.compaction.model` 将汇总委托给功能更强大或更专业的模型。覆盖接受任何 `provider/model-id` 字符串：

```json
{
  "agents": {
    "defaults": {
      "compaction": {
        "model": "openrouter/anthropic/claude-sonnet-4-6"
      }
    }
  }
}
```

这也适用于本地模型，例如专用于摘要的第二个 Ollama 模型：

```json
{
  "agents": {
    "defaults": {
      "compaction": {
        "model": "ollama/llama3.1:8b"
      }
    }
  }
}
```

未设置时，压缩使用智能体的主要模型。

### 标识符保存

压缩摘要默认保留不透明标识符 (`identifierPolicy: "strict"`)。使用 `identifierPolicy: "off"` 进行覆盖以禁用，或使用 `identifierPolicy: "custom"` 加上 `identifierInstructions` 进行自定义指导。

### 活动转录字节保护

设置 `agents.defaults.compaction.maxActiveTranscriptBytes` 时，如果活动 JSONL 达到该大小，OpenClaw 将在运行前触发正常的本地压缩。这对于长时间运行的会话很有用，其中提供商端上下文管理可以保持模型上下文健康，同时本地成绩单不断增长。它不会分割原始 JSONL 字节；它要求正常的压缩管道创建语义摘要。

<Warning>
字节保护需要 `truncateAfterCompaction: true`。如果没有转录本旋转，活动文件将不会缩小并且防护保持不活动状态。
</Warning>

### 后续成绩单

启用 `agents.defaults.compaction.truncateAfterCompaction` 时，OpenClaw 不会就地重写现有转录本。它根据压缩摘要、保留状态和未摘要尾部创建新的活动后继转录本，然后保留先前的 JSONL 作为存档检查点源。
后继成绩单也会丢弃到达的精确重复的长用户轮次
在一个短的重试窗口内，因此通道重试风暴不会被带入
压缩后的下一个活动转录本。

仅当预压缩检查点低于 OpenClaw 时才会保留
检查点尺寸上限；超大的活性转录本仍然紧凑，但是 OpenClaw
跳过大型调试快照，而不是使磁盘使用量加倍。

### 压实通知

默认情况下，压缩会静默运行。设置 `notifyUser` 以在压缩开始和完成时显示简短的状态消息：

```json5
{
  agents: {
    defaults: {
      compaction: {
        notifyUser: true,
      },
    },
  },
}
```

### 内存刷新

在压缩之前，OpenClaw 可以运行 **静默内存刷新** 轮以将持久注释存储到磁盘。当此内务处理轮次应使用本地模型而不是活动对话模型时，设置 `agents.defaults.compaction.memoryFlush.model` ：

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

内存刷新模型覆盖是精确的，并且不会继承活动会话后备链。有关详细信息和配置，请参阅[内存](/concepts/memory)。

## 可插入压缩提供商

Plugins 可以通过插件 API 上的 `registerCompactionProvider()` 注册自定义压缩提供商。注册和配置提供商后，OpenClaw 将汇总委托给它，而不是内置的 LLM 管道。

要使用已注册的提供商，请在你的配置中设置其 id：

```json
{
  "agents": {
    "defaults": {
      "compaction": {
        "provider": "my-provider"
      }
    }
  }
}
```

设置 `provider` 会自动强制 `mode: "safeguard"`。提供商接收与内置路径相同的压缩指令和标识符保留策略，并且 OpenClaw 在提供商输出后仍然保留最近轮次和分轮次后缀上下文。

<Note>
如果提供商失败或返回空结果，OpenClaw 将回退到内置 LLM 摘要。
</Note>

## 压缩与修剪

|                  |压实|修剪|
| ---------------- | -------------------------------------- | -------------------------------- |
| **它的作用** |总结以前的谈话 |修剪旧工具结果 |
| **已保存？** |是（在会议记录中）|否（仅限内存中，每个请求）|
| **范围** |整个对话 |仅工具结果 |

[会话修剪](/concepts/session-pruning) 是一个轻量级的补充，可以在不进行汇总的情况下修剪工具输出。

## 故障排除

**压缩过于频繁？** 模型的上下文窗口可能很小，或者工具输出可能很大。尝试启用[会话修剪](/concepts/session-pruning)。

**压缩后上下文感觉陈旧？** 使用 `/compact Focus on <topic>` 来指导摘要，或启用 [内存刷新](/concepts/memory)，以便注释保留下来。

**需要一个干净的石板？** `/new` 开始一个新的会话而不压缩。

有关高级配置（保留token、标识符保存、自定义上下文引擎、OpenAI 服务器端压缩），请参阅[会话管理深入探讨](/reference/session-management-compaction)。

## 相关

- [会话](/concepts/session)：会话管理和生命周期。
- [会话修剪](/concepts/session-pruning)：修剪工具结果。
- [上下文](/concepts/context)：如何为智能体轮流构建上下文。
- [钩子](/automation/hooks)：压缩生命周期钩子(`before_compaction`、`after_compaction`)。
