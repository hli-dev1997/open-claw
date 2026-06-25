---
summary: "What the OpenClaw system prompt contains and how it is assembled"
read_when:
  - Editing system prompt text, tools list, or time/heartbeat sections
  - Changing workspace bootstrap or skills injection behavior
title: "System prompt"
---

OpenClaw 为每次智能体运行构建自定义系统提示词。提示符为 **OpenClaw-owned** 并且不使用 pi-coding-agent 默认提示符。

该提示由 OpenClaw 组装并注入到每个智能体运行中。

提供商插件可以提供缓存感知的提示指导，而无需替换
完整的 OpenClaw 拥有的提示符。提供商运行时可以：

- 替换一小组命名的核心部分（`interaction_style`，
  `tool_call_style`、`execution_bias`)
- 在提示缓存边界上方注入**稳定前缀**
- 在提示缓存边界下方注入一个**动态后缀**

使用提供商拥有的贡献进行特定于模型系列的调整。保留遗产
`before_prompt_build` 提示突变以实现兼容性或真正的全局提示
变化，而不是正常的提供商行为。

OpenAI GPT-5 系列覆盖保持核心执行规则较小并添加
针对角色锁定、简洁输出、工具规则的特定于模型的指导，
并行查找、可交付成果覆盖率、验证、缺失上下文以及
终端工具卫生。

## 结构

提示符故意紧凑并使用固定部分：

- **工具**：结构化工具真相来源提醒以及运行时工具使用指导。
- **执行偏差**：紧凑的后续指导：依次行动
  可操作的请求，继续直到完成或被阻止，从弱工具中恢复
  结果，实时检查可变状态，并在最终确定之前进行验证。
- **安全**：短护栏提醒，避免权力追求行为或绕过监管。
- **Skills**（如果可用）：告诉模型如何按需加载技能指令。
- **OpenClaw 自我更新**：如何安全地检查配置
  `config.schema.lookup`，用 `config.patch` 修补配置，替换完整的
  使用 `config.apply` 配置，并仅在显式用户上运行 `update.run`
  请求。仅限所有者的 `gateway` 工具也拒绝重写
  `tools.exec.ask` / `tools.exec.security`，包括旧版 `tools.bash.*`
  标准化为那些受保护的执行路径的别名。
- **工作区**：工作目录 (`agents.defaults.workspace`)。
- **文档**：OpenClaw 文档（repo 或 npm 包）的本地路径以及何时阅读它们。
- **工作区文件（注入）**：表示引导文件包含在下面。
- **沙箱**（启用后）：指示沙箱运行时、沙箱路径以及提升的 exec 是否可用。
- **当前日期和时间**：用户本地时间、时区和时间格式。
- **回复标签**：支持的提供商的可选回复标签语法。
- **心跳**：当为默认智能体启用心跳时，心跳提示和确认行为。
- **运行时**：主机、操作系统、节点、模型、存储库根（检测到时）、思维级别（一行）。
- **推理**：当前可见性级别+ /reasoning 切换提示。

OpenClaw 保留大量稳定的内容，包括**项目上下文**，位于
内部提示缓存边界。易失性通道/会话部分，例如
Control UI 嵌入指南、**消息传递**、**语音**、**群聊上下文**、
**反应**、**心跳**和**运行时** 附加在该边界下方
因此具有前缀缓存的本地后端可以重用稳定的工作区前缀
跨渠道转弯。工具描述同样应避免嵌入当前的
当接受的模式已经携带该运行时详细信息时的通道名称。

工具部分还包括针对长时间运行工作的运行时指南：

- 使用 cron 进行未来的后续工作（`check back later`、提醒、重复工作）
  而不是 `exec` 睡眠循环，`yieldMs` 延迟技巧，或重复 `process`
  投票
- 仅对立即启动并继续运行的命令使用 `exec` / `process`
  在后台
- 当启用自动完成唤醒时，启动命令一次并依赖
  当发出输出或失败时基于推送的唤醒路径
- 在需要时使用 `process` 进行日志、状态、输入或干预
  检查正在运行的命令
- 如果任务较大，首选`sessions_spawn`；子智能体完成是
  基于推送并自动通告给请求者
- 不要在循环中轮询 `subagents list` / `sessions_list` 只是为了等待
  完成

当启用实验性 `update_plan` 工具时，Tooling 还会告诉
模型仅将其用于重要的多步骤工作，仅保留一个
`in_progress` 步骤，并避免每次更新后重复整个计划。

系统提示词中的安全护栏是建议性的。他们指导模型行为，但不执行政策。使用工具策略、执行批准、沙箱和渠道许可名单进行硬执行；操作员可以通过设计禁用这些功能。

在具有本机批准卡/按钮的渠道上，运行时提示现在会告诉
智能体首先依赖本机批准 UI。它应该只包含一个手册
当工具结果显示聊天批准不可用或时执行 `/approve` 命令
手动审批是唯一途径。

## 提示模式

OpenClaw 可以为子智能体呈现更小的系统提示词。运行时设置
每次运行的 `promptMode` （不是面向用户的配置）：

- `full`（默认）：包括上述所有部分。
- `minimal`：用于子智能体；省略 **Skills**、**内存调用**、**OpenClaw
  自我更新**、**模型别名**、**用户身份**、**回复标签**、
  **消息传送**、**无声回复**和**心跳**。工具，**安全**，
  工作区、沙箱、当前日期和时间（已知时）、运行时和注入
  上下文保持可用。
- `none`：仅返回基本标识行。

当 `promptMode=minimal` 时，额外注入的提示被标记为 **Subagent
上下文**而不是**群聊上下文**。

对于通道自动回复运行，OpenClaw 可以省略通用 **静默回复**
当直接/群聊上下文已包含已解决的部分时
特定于对话的 `NO_REPLY` 行为。这避免了重复的token机制
在全局系统提示词和通道上下文中。

## 工作区引导注入

Bootstrap 文件被修剪并附加到 **Project Context** 下，因此模型无需显式读取即可查看身份和配置文件上下文：

- `AGENTS.md`
- `SOUL.md`
- `TOOLS.md`
- `IDENTITY.md`
- `USER.md`
- `HEARTBEAT.md`
- `BOOTSTRAP.md`（仅适用于全新的工作区）
- `MEMORY.md` 当存在时

所有这些文件每次都会**注入上下文窗口**，除非
应用特定于文件的门。 `HEARTBEAT.md` 在正常运行时被省略
默认智能体禁用心跳或
`agents.defaults.heartbeat.includeSystemPromptSection` 是错误的。保持注射
文件简洁——尤其是 `MEMORY.md`，它会随着时间的推移而增长并导致
出乎意料的高上下文使用率和更频繁的压缩。

<Note>
`memory/*.md` 日常文件**不是**正常引导项目上下文的一部分。在普通情况下，它们是通过 `memory_search` 和 `memory_get` 工具按需访问的，因此除非模型显式读取它们，否则它们不会计入上下文窗口。裸 `/new` 和 `/reset` 轮是例外：运行时可以将最近的日常内存作为第一轮的一次性启动上下文块。
</Note>

大文件会用标记截断。每个文件的最大大小由以下参数控制
`agents.defaults.bootstrapMaxChars`（默认值：12000）。总注入引导程序
跨文件的内容由 `agents.defaults.bootstrapTotalMaxChars` 限制
（默认值：60000）。丢失文件注入一个短的丢失文件标记。截断时
发生时，OpenClaw 可以在项目上下文中注入警告块；控制这个
`agents.defaults.bootstrapPromptTruncationWarning` (`off`, `once`, `always`;
默认值：`once`)。

子智能体会话仅注入 `AGENTS.md` 和 `TOOLS.md` （其他引导文件
被过滤掉以保持子智能体上下文较小）。

内部钩子可以通过 `agent:bootstrap` 拦截此步骤以进行变异或替换
注入的引导文件（例如将 `SOUL.md` 替换为备用角色）。

如果你想让智能体听起来不那么通用，请从
[SOUL.md 性格指南](/concepts/soul)。

要检查每个注入文件的贡献量（原始文件与注入文件、截断以及工具架构开销），请使用 `/context list` 或 `/context detail`。请参阅[上下文](/concepts/context)。

## 时间处理

系统提示词包括一个专用的 **当前日期和时间** 部分，当
用户时区已知。为了保持提示缓存稳定，它现在只包括
**时区**（无动态时钟或时间格式）。

当智能体需要当前时间时，使用`session_status`；状态卡
包括时间戳行。同一工具可以选择设置每个会话模型
覆盖（`model=default` 清除它）。

配置为：

- `agents.defaults.userTimezone`
- `agents.defaults.timeFormat` (`auto` | `12` | `24`)

请参阅[日期和时间](/date-time) 了解完整的行为详细信息。

## Skills

当存在符合条件的技能时，OpenClaw 会注入一个紧凑的**可用技能列表**
(`formatSkillsForPrompt`)，其中包括每个技能的**文件路径**。的
提示指示模型使用 `read` 在列出的位置加载 SKILL.md
位置（工作区、托管或捆绑）。如果没有符合条件的技能，
Skills 部分被省略。

资格包括技能元数据门、运行时环境/配置检查、
以及 `agents.defaults.skills` 或时的有效智能体技能许可名单
`agents.list[].skills` 已配置。

Plugin-捆绑技能仅在启用其所属插件时才符合资格。
这使得工具插件可以暴露更深入的操作指南，而无需嵌入所有
该指导直接出现在每个工具描述中。

```
<available_skills>
  <skill>
    <name>...</name>
    <description>...</description>
    <location>...</location>
  </skill>
</available_skills>
```

这使得基本提示保持较小，同时仍然允许有针对性的技能使用。

技能列表预算归技能子系统所有：

- 全局默认值：`skills.limits.maxSkillsPromptChars`
- 每个智能体覆盖：`agents.list[].skillsLimits.maxSkillsPromptChars`

通用有界运行时摘录使用不同的表面：

- `agents.defaults.contextLimits.*`
- `agents.list[].contextLimits.*`

这种划分使技能大小与运行时读取/注入大小分开，例如
如 `memory_get`、实时工具结果和压缩后 AGENTS.md 刷新。

## 文档

系统提示词符包括 **文档** 部分。当本地文档可用时，它
指向本地 OpenClaw 文档目录（Git 签出中的 `docs/` 或捆绑的 npm
包文档）。如果本地文档不可用，则会回退到
[https://docs.openclaw.ai](https://docs.openclaw.ai)。

同一部分还包括 OpenClaw 源位置。 Git 结帐暴露本地
源根目录，以便智能体可以直接检查代码。软件包安装包括 GitHub
来源 URL 并告诉智能体在文档不完整或不完整时查看那里的来源
陈旧的。提示还注明了公共文档镜像、社区 Discord 和 ClawHub
([https://clawhub.ai](https://clawhub.ai)) 用于技能发现。它告诉模型
首先查阅文档了解 OpenClaw 行为、命令、配置或体系结构，然后
尽可能运行 `openclaw status` 本身（仅在缺乏访问权限时询问用户）。
具体来说，对于配置，它将智能体指向 `gateway` 工具操作
`config.schema.lookup` 获取精确的字段级文档和约束，然后
`docs/gateway/configuration.md` 和 `docs/gateway/configuration-reference.md`
以获得更广泛的指导。

## 相关

- [智能体运行时](/concepts/agent)
- [智能体工作区](/concepts/agent-workspace)
- [上下文引擎](/concepts/context-engine)
