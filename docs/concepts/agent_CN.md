---
summary: "Agent runtime, workspace contract, and session bootstrap"
read_when:
  - Changing agent runtime, workspace bootstrap, or session behavior
title: "Agent runtime"
---

OpenClaw 运行**单个嵌入式智能体运行时**：每个 Gateway 一个智能体进程，
拥有自己的工作区、引导文件和会话存储。本页
涵盖了运行时契约：工作区必须包含什么、获取哪些文件
注入，以及会话如何针对它进行引导。

## 工作区（必填）

OpenClaw 使用单个智能体工作区目录 (`agents.defaults.workspace`) 作为智能体的工具和上下文的**唯一**工作目录 (`cwd`)。

建议：使用 `openclaw setup` 创建 `~/.openclaw/openclaw.json`（如果丢失）并初始化工作区文件。

完整工作区布局+备份指南：[智能体工作区](/concepts/agent-workspace)

如果启用 `agents.defaults.sandbox`，非主会话可以使用以下命令覆盖它：
`agents.defaults.sandbox.workspaceRoot` 下的每会话工作区（请参阅
[Gateway 配置](/gateway/configuration))。

## 引导文件（注入）

在 `agents.defaults.workspace` 内部，OpenClaw 需要这些用户可编辑的文件：

- `AGENTS.md` — 操作指令 + “记忆”
- `SOUL.md` — 角色、界限、语气
- `TOOLS.md` — 用户维护的工具注释（e.g.`imsg`、`sag`、约定）
- `BOOTSTRAP.md` — 一次性首次运行仪式（完成后删除）
- `IDENTITY.md` — 智能体名称/氛围/表情符号
- `USER.md` — 用户资料 + 首选称呼

在新会话第一次启动时，OpenClaw 将这些文件的内容直接注入到智能体上下文中。

空白文件会被跳过。大文件会被裁剪，并用标记截断，让提示词保持精简（要查看完整内容，请阅读文件本身）。

如果文件丢失， OpenClaw 会注入单个“丢失文件”标记行（并且 `openclaw setup` 将创建一个安全的默认模板）。

`BOOTSTRAP.md` 仅为 **全新工作区** 创建（不存在其他引导文件）。如果你在完成仪式后将其删除，则在以后重新启动时不应重新创建它。

要完全禁用引导文件创建（对于预先播种的工作区），请设置：

```json5
{ agents: { defaults: { skipBootstrap: true } } }
```

## 内置工具

核心工具（读/执行/编辑/写和相关系统工具）始终可用，
但受工具策略约束。`apply_patch` 是可选的，并由
`tools.exec.applyPatch` 控制。`TOOLS.md` **不**控制哪些工具存在；它只是
关于你希望如何使用它们的指导。

## Skills

OpenClaw 从这些位置加载 Skills（优先级从高到低）：

- 工作区：`<workspace>/skills`
- 项目智能体 Skills：`<workspace>/.agents/skills`
- 个人智能体 Skills：`~/.agents/skills`
- 托管/本地：`~/.openclaw/skills`
- 捆绑（随安装一起提供）
- 额外 Skills 文件夹：`skills.load.extraDirs`

Skills 可以通过 config/env 进行门控（请参阅 [Gateway 配置](/gateway/configuration) 中的 `skills`）。

## 运行时边界

嵌入式智能体运行时构建在 Pi 智能体核心（模型、工具和
提示管道）。会话管理、发现、工具连接和通道
交付是该核心之上的 OpenClaw 拥有的层。

## 会话

会话记录作为 JSONL 存储在：

- `~/.openclaw/agents/<agentId>/sessions/<SessionId>.jsonl`

会话 ID 是稳定的，由 OpenClaw 选择。
不会读取其他工具中的旧会话文件夹。

## 流式传输期间 Steering

当队列模式为 `steer` 时，入站消息将注入到当前运行中。
排队的 steering 会在**当前助手轮次完成其工具调用之后**、
下一次 LLM 调用之前送达。Pi 会为 `steer` 一次性排空所有待处理的
steering 消息；旧版 `queue` 会在每个模型边界排空一条消息。
Steering 不再跳过当前助手消息中剩余的工具调用。

当队列模式为 `followup` 或 `collect` 时，入站消息将被保留，直到
当前回合结束，然后新的智能体回合以排队的有效负载开始。参见
模式的[队列](/concepts/queue)和[转向队列](/concepts/queue-steering)
和边界行为。

块流式传输会在助手块完成后立即发送；它
**默认关闭** (`agents.defaults.blockStreamingDefault: "off"`)。
通过 `agents.defaults.blockStreamingBreak` 调整边界（`text_end` 与 `message_end`；默认为 text_end）。
使用 `agents.defaults.blockStreamingChunk` 控制软块分块（默认为
800–1200 个字符；更喜欢分段符，然后换行符；最后的句子）。
使用 `agents.defaults.blockStreamingCoalesce` 合并流式块以减少
单行刷屏（发送前基于空闲时间合并）。非 Telegram 通道需要
显式 `*.blockStreaming: true` 以启用块回复。
详细工具摘要会在工具启动时发出（无 debounce）；Control UI
如果可用，通过智能体事件流式传输工具输出。
更多详细信息：[流+分块](/concepts/streaming)。

## 模型参考

配置中的模型引用（例如 `agents.defaults.model` 和 `agents.defaults.models`）通过在**第一个** `/` 上进行拆分来解析。

- 配置模型时使用 `provider/model`。
- 如果模型 ID 本身包含 `/`（OpenRouter 风格），请包含提供商前缀（例如：`openrouter/moonshotai/kimi-k2`）。
- 如果省略提供商，OpenClaw 首先尝试别名，然后尝试唯一的
  已配置提供商与该精确模型 ID 的匹配，然后才回退
  到已配置的默认提供商。如果该提供商不再公开
  配置的默认模型， OpenClaw 回退到第一个配置的
  提供商/模型，而不是显示陈旧的已删除提供商默认值。

## 配置（最小）

至少设置：

- `agents.defaults.workspace`
- `channels.whatsapp.allowFrom`（强烈推荐）

---

_下一篇：[群聊](/channels/group-messages)_ 🦞

## 相关

- [智能体工作区](/concepts/agent-workspace)
- [多智能体路由](/concepts/multi-agent)
- [会话管理](/concepts/session)
