---
summary: "How OpenClaw separates model providers, models, channels, and agent runtimes"
title: "Agent runtimes"
read_when:
  - You are choosing between PI, Codex, ACP, or another native agent runtime
  - You are confused by provider/model/runtime labels in status or config
  - You are documenting support parity for a native harness
---

**智能体运行时**是拥有一个准备好的模型循环的组件：它
接收提示，驱动模型输出，处理本机工具调用并返回
完成后转向OpenClaw。

运行时很容易与提供商混淆，因为两者都显示在模型附近
配置。它们是不同的层：

|层 |示例 |这意味着什么 |
| ------------- | -------------------------------------------------- | ---------------------------------------------------------------------------------- |
|供应商| `openai`、`anthropic`、`openai-codex` | OpenClaw 如何验证、发现模型并命名模型引用。 |
|模型| `gpt-5.5`、`claude-opus-4-6` |为智能体轮选择的模型。                              |
|智能体运行时 | `pi`、`codex`、`claude-cli` |执行准备好的回合的低级循环或后端。      |
|频道| Telegram、Discord、Slack、WhatsApp |消息进入和离开 OpenClaw 的位置。                            |

你还将在代码中看到“**harness**”一词。线束是实现
提供智能体运行时。例如，捆绑的 Codex 线束
实现 `codex` 运行时。公共配置使用`agentRuntime.id`； '张开爪
doctor --fix` 将旧的运行时策略键重写为该形状。

有两个运行时系列：

- **嵌入式线束**在 OpenClaw 准备好的智能体循环内运行。今天这个
  是内置的 `pi` 运行时加上注册的插件工具，例如
  `codex`。
- **CLI 后端** 运行本地 CLI 进程，同时保留模型引用
  规范的。例如，`anthropic/claude-opus-4-7` 与
  `agentRuntime.id: "claude-cli"` 表示“选择Anthropic模型，执行
  通过 Claude CLI。” `claude-cli` 不是嵌入式线束 ID，不得
  被传递给 AgentHarness 选择。

## 三个名为 Codex 的东西

大多数混乱来自于共享 Codex 名称的三个不同表面：

|表面| OpenClaw 名称/配置 |它有什么作用 |
| ---------------------------------------------------------------- | ------------------------------------------------ | ------------------------------------------------------------------------------------------------------------------ |
| Codex OAuth 提供商路由 | `openai-codex/*` 模型参考 |通过正常的 OpenClaw PI 运行程序使用 ChatGPT/Codex 订阅 OAuth。                        |
|原生 Codex app-server 运行时 | `agentRuntime.id: "codex"` |通过捆绑的 Codex app-server harness 运行嵌入式智能体。                          |
| Codex ACP 适配器 | `runtime: "acp"`、`agentId: "codex"` |通过外部 ACP/acpx 控制平面运行 Codex。仅当明确询问 ACP/acpx 时才使用。 |
|本机 Codex 聊天控制命令集 | `/codex ...` |绑定、恢复、引导、停止和检查聊天中的 Codex 应用服务器线程。                     |
| OpenAI 平台 API GPT/Codex 类模型的路由 | `openai/*` 模型参考 |使用 OpenAI API-key auth 运行轮次，除非有运行时覆盖（例如 `runtime: "codex"`）。      |

这些表面是有意独立的。启用 `codex` 插件使
可用的本机应用服务器功能；它不会重写
`openai-codex/*` 转换为 `openai/*`，不会更改现有会话，并且不会
不将 ACP 设置为 Codex 默认值。选择 `openai-codex/*` 意味着“使用 Codex
OAuth 提供商路由”，除非你单独强制运行时。

常见的 Codex 设置使用 `openai` 提供商和 `codex` 运行时：

```json5
{
  agents: {
    defaults: {
      model: "openai/gpt-5.5",
      agentRuntime: {
        id: "codex",
      },
    },
  },
}
```

这意味着 OpenClaw 选择 OpenAI 模型引用，然后询问 Codex 应用服务器
运行时负责运行嵌入式智能体轮次。不代表渠道、模型
提供商目录或 OpenClaw 会话存储变为 Codex。

当启用捆绑的 `codex` 插件时，自然语言 Codex 控制
应使用本机 `/codex` 命令界面（`/codex bind`、`/codex threads`、
`/codex resume`、`/codex steer`、`/codex stop`) 而不是 ACP。使用 ACP 进行
Codex 仅当用户明确请求 ACP/acpx 或正在测试 ACP 时
适配器路径。 Claude 代码、Gemini CLI、OpenCode、光标和类似的外部
线束仍然使用 ACP。

这是面向智能体的决策树：

1. 如果用户请求**Codexbind/control/thread/resume/steer/stop**，请使用
   当启用捆绑的 `codex` 插件时，本机 `/codex` 命令界面。
2. 如果用户要求 **Codex 作为嵌入式运行时**，请使用
   `openai/<model>` 与 `agentRuntime.id: "codex"`。
3. 如果用户在正常 OpenClaw 上请求 **Codex OAuth/订阅认证
   runner**，使用 `openai-codex/<model>` 并将运行时保留为 PI。
4. 如果用户明确指出 **ACP**、**acpx** 或 **Codex ACP 适配器**，请使用
   ACP 与 `runtime: "acp"` 和 `agentId: "codex"`。
5. 如果请求针对 **Claude Code、Gemini CLI、OpenCode、Cursor、Droid 或
   另一个外部线束**，使用 ACP/acpx，而不是本机子智能体运行时。

|你的意思是... |使用... |
| --------------------------------------- | -------------------------------------------------------- |
| Codex 应用服务器聊天/线程控制 | `/codex ...` 来自捆绑的 `codex` 插件 |
| Codex 应用服务器嵌入式智能体运行时 | `agentRuntime.id: "codex"` |
| OpenAI Codex PI 运行器上的 OAuth | `openai-codex/*` 模型参考 |
| Claude 代码或其他外部线束 | ACP/acpx |

对于 OpenAI 系列前缀拆分，请参阅 [OpenAI](/providers/openai) 和
[模型提供商](/concepts/model-providers)。对于 Codex 运行时支持
合同，请参阅 [Codex harness](/plugins/codex-harness#v1-support-contract)。

## 运行时所有权

不同的运行时拥有不同数量的循环。

|表面| OpenClaw PI 嵌入式 | Codex 应用服务器 |
| ------------------------ | | --------------------------------------- | --------------------------------------------------------------------------- |
|模型循环所有者| OpenClaw 通过 PI 嵌入式运行器 | Codex 应用服务器 |
|规范线程状态 | OpenClaw 成绩单 | Codex 线程，加上 OpenClaw 转录镜像 |
| OpenClaw 动态工具 |本机 OpenClaw 工具循环 |通过 Codex 适配器桥接 |
|本机 shell 和文件工具 | PI/OpenClaw 路径 | Codex-本机工具，通过支持的本机挂钩桥接 |
|上下文引擎 |本机 OpenClaw 上下文汇编 | OpenClaw 项目将上下文组装到 Codex 转 |
|压实| OpenClaw 或选定的上下文引擎 | Codex-本机压缩，具有 OpenClaw 通知和镜像维护 |
|渠道投放| OpenClaw | OpenClaw |

这种所有权分割是主要的设计规则：

- 如果 OpenClaw 拥有该表面，则 OpenClaw 可以提供正常的插件挂钩行为。
- 如果本机运行时拥有该表面，则 OpenClaw 需要运行时事件或本机挂钩。
- 如果本机运行时拥有规范线程状态，则 OpenClaw 应镜像和项目上下文，而不是重写不支持的内部结构。

## 运行时选择

OpenClaw 在提供商和模型解析后选择嵌入式运行时：

1. 会话的记录运行时间获胜。配置更改不会热切换
   现有的转录到不同的本机线程系统。
2. `OPENCLAW_AGENT_RUNTIME=<id>` 强制该运行时用于新会话或重置会话。
3. `agents.defaults.agentRuntime.id` 或 `agents.list[].agentRuntime.id` 可以设置
   `auto`、`pi`、已注册的嵌入式线束 ID，例如 `codex`，或
   支持 CLI 后端别名，例如 `claude-cli`。
4. 在 `auto` 模式下，注册的插件运行时可以声明支持的提供商/模型
   对。
5. 如果没有运行时声明进入 `auto` 模式并且设置了 `fallback: "pi"`
   （默认），OpenClaw 使用 PI 作为兼容性回退。套装
   `fallback: "none"` 使不匹配的 `auto` 模式选择失败。

默认情况下，显式插件运行时无法关闭。例如，
`runtime: "codex"` 表示 Codex 或明确的选择错误，除非你设置
`fallback: "pi"` 在同一覆盖范围内。运行时重写不会继承
更广泛的后备设置，因此智能体级别 `runtime: "codex"` 不会默默地
路由回 PI 只是因为默认使用 `fallback: "pi"`。

CLI 后端别名与嵌入式线束 ID 不同。首选
Claude CLI 形式为：

```json5
{
  agents: {
    defaults: {
      model: "anthropic/claude-opus-4-7",
      agentRuntime: { id: "claude-cli" },
    },
  },
}
```

仍支持 `claude-cli/claude-opus-4-7` 等旧参考
兼容性，但新配置应保持提供商/模型规范并放置
`agentRuntime.id` 中的执行后端。

`auto` 模式是故意保守的。 Plugin 运行时可以声明
他们理解的提供商/模型对，但 Codex 插件没有声明
`openai-codex` 提供商处于 `auto` 模式。这保留了
`openai-codex/*` 作为显式 PI Codex OAuth 路由并静默避免
将订阅认证配置移动到原生 app-server harness。

如果 `openclaw doctor` 警告 `codex` 插件已启用，而
`openai-codex/*` 仍然通过 PI 路由，将其视为诊断，而不是诊断
迁移。当你想要 PI Codex OAuth 时，请保持配置不变。
仅当你需要本机时才切换到 `openai/<model>` 加 `agentRuntime.id: "codex"`
Codex 应用服务器执行。

## 兼容性契约

当运行时不是 PI 时，它应该记录它支持的 OpenClaw 表面。
使用此形状作为运行时文档：

|问题 |为什么这很重要 |
| -------------------------------------- | ----------------------------------------------------------------------------------------------------------------- |
|谁拥有模型循环？               |确定重试、工具继续和最终答案决策发生的位置。                   |
|谁拥有规范的线程历史记录？     |确定 OpenClaw 是否可以编辑历史记录或仅镜像历史记录。                                   |
| OpenClaw 动态工具有效吗？        |消息、会话、cron 和 OpenClaw 拥有的工具依赖于此。                                 |
|动态工具挂钩有用吗？            | Plugins 期望 `before_tool_call`、`after_tool_call` 以及围绕 OpenClaw 拥有的工具的中间件。 |
|原生工具钩子有用吗？             | Shell、补丁和运行时拥有的工具需要本机钩子支持来进行策略和观察。        |
|上下文引擎生命周期是否运行？ |内存和上下文插件依赖于组装、摄取、转后和压缩生命周期。      |
|暴露了哪些压缩数据？       |有些插件只需要通知，而其他插件则需要保留/删除元数据。                    |
|什么是故意不支持的？     |用户不应假定本机运行时拥有更多状态的 PI 等效性。                  |

Codex 运行时支持合同记录在
[Codex 线束](/plugins/codex-harness#v1-support-contract)。

## 状态标签

状态输出可能同时显示 `Execution` 和 `Runtime` 标签。将它们读为
诊断，而不是提供商名称。

- 诸如 `openai/gpt-5.5` 之类的模型引用会告诉你所选的提供商/模型。
- 运行时 ID（例如 `codex`）告诉你哪个循环正在执行回合。
- 频道标签（例如 Telegram 或 Discord）告诉你对话发生的位置。

如果更改运行时配置后会话仍然显示 PI，请启动新会话
使用 `/new` 或使用 `/reset` 清除当前值。现有会话保留其
记录运行时间，因此转录不会通过两个不兼容的本机重播
会话系统。

＃＃ 有关的

- [Codex harness](/plugins/codex-harness)
- [OpenAI](/providers/openai)
- [智能体线束插件](/plugins/sdk-agent-harness)
- [智能体循环](/concepts/agent-loop)
- [模型](/concepts/models)
- [状态](/cli/status)
