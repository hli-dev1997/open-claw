---
summary: "CLI onboarding: guided setup for gateway, workspace, channels, and skills"
read_when:
  - Running or configuring CLI onboarding
  - Setting up a new machine
title: "Onboarding (CLI)"
sidebarTitle: "Onboarding: CLI"
---

CLI 载入是在 macOS 上设置 OpenClaw 的**推荐**方法，
Linux 或 Windows（通过 WSL2；强烈推荐）。
它配置本地 Gateway 或远程 Gateway 连接，以及通道、技能、
和工作区默认处于一个引导流程中。

```bash
openclaw onboard
```

<Info>
最快的首次聊天：打开 Control UI （无需频道设置）。运行
`openclaw dashboard` 并在浏览器中聊天。文档：[仪表板](/web/dashboard)。
</Info>

稍后重新配置：

```bash
openclaw configure
openclaw agents add <name>
```

<Note>
`--json` 并不意味着非交互模式。对于脚本，请使用 `--non-interactive`。
</Note>

<Tip>
CLI 入职包括网络搜索步骤，你可以在其中选择提供商
例如 Brave、DuckDuckGo、Exa、Firecrawl、Gemini、Grok、Kimi、MiniMax Search、
Ollama 网页搜索、Perplexity、SearXNG 或 Tavily。一些提供商要求
API 密钥，而其他则无密钥。你也可以稍后配置
`openclaw configure --section web`。文档：[网络工具](/tools/web)。
</Tip>

## 快速入门与高级

入职从**快速启动**（默认）与**高级**（完全控制）开始。

<Tabs>
  <Tab title="QuickStart (defaults)">
    - 本地网关（环回）
    - 默认工作区（或现有工作区）
    - Gateway 端口 **18789**
    - Gateway auth **token**（自动生成，即使在环回时）
    - 新本地设置的工具策略默认值：`tools.profile: "coding"`（保留现有的显式配置文件）
    - DM 隔离默认值：未设置时，本地载入写入 `session.dmScope: "per-channel-peer"`。详细信息：[CLI 设置参考](/start/wizard-cli-reference#outputs-and-internals)
    - Tailscale 曝光 **关闭**
    - Telegram + WhatsApp DM 默认为 **白名单**（系统会提示你输入电话号码）

  </Tab>
  <Tab title="Advanced (full control)">
    - 公开每一步（模式、工作区、网关、通道、守护进程、技能）。

  </Tab>
</Tabs>

## 入门配置是什么

**本地模式（默认）**将引导你完成以下步骤：

1. **模型/认证** — 选择任何受支持的提供商/认证流程（API 密钥、OAuth 或提供商特定的手动认证），包括自定义提供商
   （OpenAI 兼容、Anthropic 兼容或未知自动检测）。选择默认模型。
   安全说明：如果此智能体将运行工具或处理 webhook/hooks 内容，请首选可用的最强大的最新一代模型并严格遵守工具策略。较弱/较旧的层更容易提示注入。
   对于非交互式运行， `--secret-input-mode ref` 将环境支持的引用存储在认证配置文件中，而不是纯文本 API 键值。
   在非交互式 `ref` 模式下，必须设置提供商环境变量；在没有该环境变量的情况下传递内联键标志会很快失败。
   在交互式运行中，选择秘密引用模式可让你指向环境变量或配置的提供商引用（`file` 或 `exec`），并在保存前进行快速预检验证。
   对于 Anthropic，交互式入门/配置提供 **Anthropic Claude CLI** 作为首选本地路径，并提供 **Anthropic API key** 作为推荐的生产路径。 Anthropic setup-token 也仍然可用作受支持的token认证路径。
2. **工作区** — 智能体文件的位置（默认 `~/.openclaw/workspace`）。种子引导文件。
3. **Gateway** — 端口、绑定地址、认证模式、Tailscale 暴露。
   在交互式token模式下，选择默认纯文本token存储或选择 SecretRef。
   非交互式token SecretRef 路径：`--gateway-token-ref-env <ENV_VAR>`。
4. **频道** — 内置和捆绑的聊天频道，例如 BlueBubbles、Discord、飞书、Google Chat、Mattermost、Microsoft Teams、QQ Bot、Signal、Slack、 Telegram、WhatsApp 等。
5. **守护进程** — 安装 LaunchAgent (macOS)、systemd 用户单元 (Linux/WSL2) 或具有每用户启动文件夹回退功能的本机 Windows 计划任务。
   如果token认证需要token并且 `gateway.auth.token` 是 SecretRef 管理的，则守护程序安装会验证它，但不会将解析的token保留到主管服务环境元数据中。
   如果token认证需要token并且配置的token SecretRef 未解析，则守护程序安装将被阻止并提供可操作的指导。
   如果同时配置了 `gateway.auth.token` 和 `gateway.auth.password` 并且未设置 `gateway.auth.mode`，则守护程序安装将被阻止，直到显式设置模式为止。
6. **运行状况检查** — 启动 Gateway 并验证其是否正在运行。
7. **Skills** — 安装推荐的技能和可选依赖项。

<Note>
重新运行入职不会**擦除任何内容，除非你明确选择**重置**（或传递 `--reset`）。
CLI `--reset` 默认为配置、凭据和会话；使用 `--reset-scope full` 包含工作区。
如果配置无效或包含旧密钥，入门会要求你首先运行 `openclaw doctor`。
</Note>

**远程模式**仅配置本地客户端连接到其他地方的 Gateway 。
它**不会**安装或更改远程主机上的任何内容。

## 添加另一个智能体

使用 `openclaw agents add <name>` 创建一个具有自己的工作区的单独智能体，
会话和认证配置文件。在没有 `--workspace` 的情况下运行会启动入门。

它设置了什么：

- `agents.list[].name`
- `agents.list[].workspace`
- `agents.list[].agentDir`

注意事项：

- 默认工作区遵循 `~/.openclaw/workspace-<agentId>`。
- 添加 `bindings` 来路由入站消息（入门可以执行此操作）。
- 非交互式标志：`--model`、`--agent-dir`、`--bind`、`--non-interactive`。

## 完整参考

有关详细的分步故障和配置输出，请参阅
[CLI 设置参考](/start/wizard-cli-reference)。
有关非交互式示例，请参阅 [CLI 自动化](/start/wizard-cli-automation)。
有关更深入的技术参考，包括 RPC 详细信息，请参阅
[入门参考](/reference/wizard)。

## 相关文档

- CLI 命令参考：[`openclaw onboard`](/cli/onboard)
- 入门概述：[入门概述](/start/onboarding-overview)
- macOS 应用入门：[入门](/start/onboarding)
- 特工首次运行仪式：[特工引导](/start/bootstrapping)
