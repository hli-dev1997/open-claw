---
summary: "Context: what the model sees, how it is built, and how to inspect it"
read_when:
  - You want to understand what “context” means in OpenClaw
  - You are debugging why the model “knows” something (or forgot it)
  - You want to reduce context overhead (/context, /status, /compact)
title: "Context"
---

“上下文”是**OpenClaw 发送到模型进行运行的所有内容**。它受到模型的**上下文窗口**（token限制）的限制。

初学者心理模型：

- **系统提示词**（OpenClaw-构建）：规则、工具、技能列表、时间/运行时和注入的工作区文件。
- **对话历史记录**：你的消息 + 助理在本次会话中的消息。
- **工具调用/结果+附件**：命令输出、文件读取、图像/音频等。

上下文与“内存”不同：内存可以存储在磁盘上并稍后重新加载；上下文是模型当前窗口内的内容。

## 快速启动（检查上下文）

- `/status` → 快速“我的窗口有多满？”视图+会话设置。
- `/context list` → 注入内容 + 粗略大小（每个文件 + 总数）。
- `/context detail` → 更深入的细分：每个文件、每个工具架构大小、每个技能条目大小和系统提示词大小。
- `/usage tokens` → 将每个回复使用页脚附加到正常回复中。
- `/compact` → 将较旧的历史记录总结为一个紧凑的条目以释放窗口空间。

另请参阅：[斜杠命令](/tools/slash-commands)、[token使用和成本](/reference/token-use)、[压缩](/concepts/compaction)。

## 输出示例

值因模型、提供商、工具策略以及工作区中的内容而异。

### `/context list`

```
🧠 Context breakdown
Workspace: <workspaceDir>
Bootstrap max/file: 12,000 chars
Sandbox: mode=non-main sandboxed=false
System prompt (run): 38,412 chars (~9,603 tok) (Project Context 23,901 chars (~5,976 tok))

Injected workspace files:
- AGENTS.md: OK | raw 1,742 chars (~436 tok) | injected 1,742 chars (~436 tok)
- SOUL.md: OK | raw 912 chars (~228 tok) | injected 912 chars (~228 tok)
- TOOLS.md: TRUNCATED | raw 54,210 chars (~13,553 tok) | injected 20,962 chars (~5,241 tok)
- IDENTITY.md: OK | raw 211 chars (~53 tok) | injected 211 chars (~53 tok)
- USER.md: OK | raw 388 chars (~97 tok) | injected 388 chars (~97 tok)
- HEARTBEAT.md: MISSING | raw 0 | injected 0
- BOOTSTRAP.md: OK | raw 0 chars (~0 tok) | injected 0 chars (~0 tok)

Skills list (system prompt text): 2,184 chars (~546 tok) (12 skills)
Tools: read, edit, write, exec, process, browser, message, sessions_send, …
Tool list (system prompt text): 1,032 chars (~258 tok)
Tool schemas (JSON): 31,988 chars (~7,997 tok) (counts toward context; not shown as text)
Tools: (same as above)

Session tokens (cached): 14,250 total / ctx=32,000
```

### `/context detail`

```
🧠 Context breakdown (detailed)
…
Top skills (prompt entry size):
- frontend-design: 412 chars (~103 tok)
- oracle: 401 chars (~101 tok)
… (+10 more skills)

Top tools (schema size):
- browser: 9,812 chars (~2,453 tok)
- exec: 6,240 chars (~1,560 tok)
… (+N more tools)
```

## 什么对上下文窗口有影响

模型收到的所有内容都很重要，包括：

- 系统提示词（所有部分）。
- 对话历史记录。
- 工具调用+工具结果。
- 附件/脚本（图像/音频/文件）。
- 压缩摘要和修剪工件。
- 提供商“包装器”或隐藏标头（不可见，仍然计数）。

## OpenClaw 如何构建系统提示词符

系统提示词符为 **OpenClaw-owned** 并在每次运行时重新构建。它包括：

- 工具列表+简短描述。
- Skills 列表（仅限元数据；见下文）。
- 工作区位置。
- 时间（UTC + 转换后的用户时间（如果配置））。
- 运行时元数据（主机/操作系统/模型/思维）。
- 在**项目上下文**下注入工作区引导文件。

完整故障：[系统提示词](/concepts/system-prompt)。

## 注入的工作区文件（项目上下文）

默认情况下， OpenClaw 注入一组固定的工作区文件（如果存在）：

- `AGENTS.md`
- `SOUL.md`
- `TOOLS.md`
- `IDENTITY.md`
- `USER.md`
- `HEARTBEAT.md`
- `BOOTSTRAP.md`（仅限首次运行）

使用 `agents.defaults.bootstrapMaxChars` （默认 `12000` 字符）按文件截断大文件。 OpenClaw 还对具有 `agents.defaults.bootstrapTotalMaxChars` （默认 `60000` 字符）的文件强制执行总引导注入上限。 `/context` 显示**原始与注入**大小以及是否发生截断。

当发生截断时，运行时可以在项目上下文下注入一个提示警告块。使用 `agents.defaults.bootstrapPromptTruncationWarning` （`off`、`once`、`always`；默认值 `once`）进行配置。

## Skills：注入与按需加载

系统提示词包括一个紧凑的**技能列表**（名称+描述+位置）。这个列表有真正的开销。

默认情况下，不包含 Skill 指令。该模型预计 `read` 技能的 `SKILL.md` **仅在需要时**。

## 工具：有两种成本

工具以两种方式影响上下文：

1. **系统提示词中的工具列表文本**（你所看到的“工具”）。
2. **工具架构** (JSON)。这些被发送到模型，以便它可以调用工具。即使你不将它们视为纯文本，它们也会计入上下文。

`/context detail` 分解了最大的工具模式，以便你可以看到什么占主导地位。

## 命令、指令和“内联快捷方式”

斜杠命令由 Gateway 处理。有几种不同的行为：

- **独立命令**：仅 `/...` 的消息作为命令运行。
- **指令**：`/think`、`/verbose`、`/trace`、`/reasoning`、`/elevated`、`/model`、 `/queue` 在模型看到消息之前被剥离。
  - 仅指令消息保留会话设置。
  - 普通消息中的内联指令充当每条消息的提示。
- **内联快捷方式**（仅限列入白名单的发件人）：普通消息中的某些 `/...` 标记可以立即运行（例如：“嘿 /status”），并在模型看到剩余文本之前被删除。

详细信息：[斜杠命令](/tools/slash-commands)。

## 会话、压缩和修剪（持续存在的内容）

消息之间持续存在的内容取决于机制：

- **正常历史记录**保留在会话记录中，直到被策略压缩/修剪。
- **压缩** 将摘要保留到记录中，并保持最近的消息完整。
- **修剪**从内存中提示中删除旧的工具结果以释放上下文窗口空间，但不会重写会话记录 - 完整的历史记录仍然可以在磁盘上检查。

文档：[会话](/concepts/session)、[压缩](/concepts/compaction)、[会话修剪](/concepts/session-pruning)。

默认情况下，OpenClaw 使用内置的 `legacy` 上下文引擎进行汇编和
压实。如果你安装提供 `kind: "context-engine"` 的插件并且
使用 `plugins.slots.contextEngine`、OpenClaw 委托上下文选择它
程序集、`/compact` 以及相关的子智能体上下文生命周期挂钩
发动机代替。 `ownsCompaction: false` 不会自动回退到旧版
发动机；活动引擎仍必须正确实现 `compact()` 。参见
[上下文引擎](/concepts/context-engine) 完整
可插入接口、生命周期挂钩和配置。

## `/context` 实际报告的内容

`/context` 更喜欢最新的 **运行构建** 系统提示词报告（如果可用）：

- `System prompt (run)` = 从上次嵌入式（支持工具）运行捕获并保留在会话存储中。
- `System prompt (estimate)` = 当不存在运行报告时（或通过不生成报告的 CLI 后端运行时）动态计算。

无论哪种方式，它都会报告规模和主要贡献者；它**不**转储完整的系统提示词或工具架构。

## 相关

- [Context Engine](/concepts/context-engine) — 通过插件自定义上下文注入
- [Compaction](/concepts/compaction) — 总结长对话
- [系统提示词符](/concepts/system-prompt) — 系统提示词符是如何构建的
- [智能体循环](/concepts/agent-loop) — 完整的智能体执行周期
