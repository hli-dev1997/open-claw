---
summary: "Complete reference for CLI setup flow, auth/model setup, outputs, and internals"
read_when:
  - You need detailed behavior for openclaw onboard
  - You are debugging onboarding results or integrating onboarding clients
title: "CLI setup reference"
sidebarTitle: "CLI reference"
---

本页是 `openclaw onboard` 的完整参考。
有关简短指南，请参阅[入门 (CLI)](/start/wizard)。

## 向导的作用

本地模式（默认）将引导你完成：

- 模型和认证设置（OpenAI 代码订阅 OAuth、Anthropic Claude CLI 或 API 密钥，加上 MiniMax、GLM、 Ollama、Moonshot、StepFun 和 AI Gateway 选项）
- 工作区位置和引导文件
- Gateway 设置（端口、绑定、认证、tailscale）
- 频道和提供商（Telegram、WhatsApp、Discord、Google Chat、Mattermost、Signal、BlueBubbles 和其他捆绑频道插件）
- 守护进程安装（LaunchAgent、systemd 用户单元或具有启动文件夹回退功能的本机 Windows 计划任务）
- 健康检查
- Skills 设置

远程模式将此计算机配置为连接到其他地方的网关。
它不会在远程主机上安装或修改任何内容。

## 本地流量详情

<Steps>
  <Step title="Existing config detection">
    - 如果 `~/.openclaw/openclaw.json` 存在，请选择“保留”、“修改”或“重置”。
    - 重新运行向导不会擦除任何内容，除非你明确选择重置（或传递 `--reset`）。
    - CLI `--reset` 默认为 `config+creds+sessions`；使用 `--reset-scope full` 也删除工作区。
    - 如果配置无效或包含旧密钥，向导将停止并要求你在继续之前运行 `openclaw doctor`。
    - 重置使用 `trash` 并提供范围：
      - 仅配置
      - 配置+凭据+会话
      - 完全重置（也删除工作区）

  </Step>
  <Step title="Model and auth">
    - 完整选项矩阵位于[Auth and model options](#auth-and-model-options)中。

  </Step>
  <Step title="Workspace">
    - 默认 `~/.openclaw/workspace` （可配置）。
    - 种子首次运行引导仪式所需的工作区文件。
    - 工作区布局：[智能体工作区](/concepts/agent-workspace)。

  </Step>
  <Step title="Gateway">
    - 提示端口、绑定、认证模式和尾部暴露。
    - 建议：即使对于环回也保持启用token认证，以便本地 WS 客户端必须进行认证。
    - 在token模式下，交互式设置提供：
      - **生成/存储明文token**（默认）
      - **使用 SecretRef**（选择加入）
    - 在密码模式下，交互式设置还支持纯文本或 SecretRef 存储。
    - 非交互式token SecretRef 路径：`--gateway-token-ref-env <ENV_VAR>`。
      - 入职流程环境中需要非空环境变量。
      - 不能与 `--gateway-token` 结合使用。
    - 仅当你完全信任每个本地进程时才禁用认证。
    - 非环回绑定仍然需要认证。

  </Step>
  <Step title="Channels">
    - [WhatsApp](/channels/whatsapp)：可选的二维码登录
    - [Telegram](/channels/telegram)：机器人token
    - [Discord](/channels/discord)：机器人token
    - [Google Chat](/channels/googlechat)：服务帐户 JSON + webhook 受众
    - [Mattermost](/channels/mattermost)：机器人代币 + 基础 URL
    - [Signal](/channels/signal)：可选`signal-cli`安装+帐户配置
    - [BlueBubbles](/channels/bluebubbles)：推荐用于iMessage；服务器 URL + 密码 + webhook
    - [iMessage](/channels/imessage)：旧版 `imsg` CLI 路径 + 数据库访问
    - DM 安全：默认为配对。首先DM发送一个代码；批准通过
      `openclaw pairing approve <channel> <code>` 或使用允许列表。
  </Step>
  <Step title="Daemon install">
    - macOS：启动智能体
      - 需要登录的用户会话；对于 headless，使用自定义 LaunchDaemon（未提供）。
    - Linux 和 Windows 通过 WSL2：systemd 用户单元
      - 向导尝试 `loginctl enable-linger <user>`，以便网关在注销后保持运行状态。
      - 可能会提示输入 sudo（写入 `/var/lib/systemd/linger`）；它首先尝试不使用 sudo 。
    - 本机Windows：计划任务优先
      - 如果任务创建被拒绝，OpenClaw 将回退到每用户启动文件夹登录项并立即启动网关。
      - 计划任务仍然是首选，因为它们提供更好的主管状态。
    - 运行时选择：节点（推荐；WhatsApp 和 Telegram 必需）。不推荐包子。

  </Step>
  <Step title="Health check">
    - 启动网关（如果需要）并运行 `openclaw health`。
    - `openclaw status --deep` 将实时网关运行状况探测添加到状态输出，包括支持的通道探测。

  </Step>
  <Step title="Skills">
    - 阅读可用技能并检查要求。
    - 允许你选择节点管理器：npm、pnpm 或 Bun。
    - 安装可选依赖项（有些在 macOS 上使用 Homebrew）。

  </Step>
  <Step title="Finish">
    - 摘要和后续步骤，包括 iOS、Android 和 macOS 应用选项。

  </Step>
</Steps>

<Note>
如果未检测到 GUI，向导将打印 Control UI 的 SSH 端口转发指令，而不是打开浏览器。
如果缺少 Control UI 资产，向导会尝试构建它们；后备是 `pnpm ui:build` （自动安装 UI deps）。
</Note>

## 远程模式详细信息

远程模式将此计算机配置为连接到其他地方的网关。

<Info>
远程模式不会在远程主机上安装或修改任何内容。
</Info>

你设置的内容：

- 远程网关 URL (`ws://...`)
- 如果需要远程网关认证，则需要token（推荐）

<Note>
- 如果网关仅环回，请使用 SSH 隧道或尾网。
- 发现提示：
  - macOS：你好 (`dns-sd`)
  - Linux：Avahi (`avahi-browse`)

</Note>

## 授权和模型选项

<AccordionGroup>
  <Accordion title="Anthropic API key">
    使用 `ANTHROPIC_API_KEY`（如果存在）或提示输入密钥，然后将其保存以供守护程序使用。
  </Accordion>
  <Accordion title="OpenAI Code subscription (OAuth)">
    浏览器流量；粘贴 `code#state`。

    当模型未设置或已经是 OpenAI 系列时，将 `agents.defaults.model` 设置为 `openai-codex/gpt-5.5`。

  </Accordion>
  <Accordion title="OpenAI Code subscription (device pairing)">
    浏览器与短期设备代码的配对流程。

    当模型未设置或已经是 OpenAI 系列时，将 `agents.defaults.model` 设置为 `openai-codex/gpt-5.5`。

  </Accordion>
  <Accordion title="OpenAI API key">
    使用 `OPENAI_API_KEY`（如果存在）或提示输入密钥，然后将凭据存储在认证配置文件中。

    当模型未设置时，将 `agents.defaults.model` 设置为 `openai/gpt-5.5`、`openai/*` 或 `openai-codex/*`。

  </Accordion>
  <Accordion title="xAI (Grok) API key">
    提示输入 `XAI_API_KEY` 并将 xAI 配置为模型提供商。
  </Accordion>
  <Accordion title="OpenCode">
    提示输入 `OPENCODE_API_KEY` （或 `OPENCODE_ZEN_API_KEY`）并让你选择 Zen 或 Go 目录。
    设置URL：[opencode.ai/auth](https://opencode.ai/auth)。
  </Accordion>
  <Accordion title="API key (generic)">
    为你存储密钥。
  </Accordion>
  <Accordion title="Vercel AI Gateway">
    提示 `AI_GATEWAY_API_KEY`。
    更多详细信息：[Vercel AI Gateway](/providers/vercel-ai-gateway)。
  </Accordion>
  <Accordion title="Cloudflare AI Gateway">
    提示输入帐户 ID、网关 ID 和 `CLOUDFLARE_AI_GATEWAY_API_KEY`。
    更多详细信息：[Cloudflare AI Gateway](/providers/cloudflare-ai-gateway)。
  </Accordion>
  <Accordion title="MiniMax">
    配置是自动写入的。托管默认为 `MiniMax-M2.7`； API-键设置使用
    `minimax/...`，OAuth 设置使用 `minimax-portal/...`。
    更多详细信息：[MiniMax](/providers/minimax)。
  </Accordion>
  <Accordion title="StepFun">
    配置是针对中国或全球端点上的 StepFun 标准或 Step Plan 自动编写的。
    标准当前包括 `step-3.5-flash`，步骤计划还包括 `step-3.5-flash-2603`。
    更多详细信息：[StepFun](/providers/stepfun)。
  </Accordion>
  <Accordion title="Synthetic (Anthropic-compatible)">
    提示 `SYNTHETIC_API_KEY`。
    更多详细信息：[合成](/providers/synthetic)。
  </Accordion>
  <Accordion title="Ollama (Cloud and local open models)">
    首先提示输入 `Cloud + Local`、`Cloud only` 或 `Local only`。
    `Cloud only` 使用 `OLLAMA_API_KEY` 和 `https://ollama.com`。
    主机支持的模式提示输入基本 URL （默认 `http://127.0.0.1:11434`），发现可用模型并建议默认值。
    `Cloud + Local` 还会检查 Ollama 主机是否已登录以进行云访问。
    更多详细信息：[Ollama](/providers/ollama)。
  </Accordion>
  <Accordion title="Moonshot and Kimi Coding">
    Moonshot (Kimi K2) 和 Kimi Coding 配置是自动编写的。
    更多详细信息：[Moonshot AI（Kimi + Kimi 编码）](/providers/moonshot)。
  </Accordion>
  <Accordion title="Custom provider">
    适用于 OpenAI 兼容和 Anthropic 兼容端点。

    交互式加入支持与其他提供商 API 密钥流程相同的 API 密钥存储选择：
    - **现在粘贴 API 密钥**（纯文本）
    - **使用秘密引用**（env ref 或配置的提供商引用，带有预检验证）

    非交互式标志：
    - `--auth-choice custom-api-key`
    - `--custom-base-url`
    - `--custom-model-id`
    - `--custom-api-key` （可选；回退到 `CUSTOM_API_KEY`）
    - `--custom-provider-id`（可选）
    - `--custom-compatibility <openai|anthropic>`（可选；默认 `openai`）
    - `--custom-image-input` / `--custom-text-input` （可选；覆盖推断的模型输入功能）

  </Accordion>
  <Accordion title="Skip">
    使认证保持未配置状态。
  </Accordion>
</AccordionGroup>

模型行为：

- 从检测到的选项中选择默认模型，或手动输入提供商和模型。
- 自定义提供商加入推断对常见模型 ID 的图像支持，并且仅在模型名称未知时询问。
- 当从提供商认证选择开始入职时，模型选择器更喜欢
  该提供商自动。对于 Volcengine 和 BytePlus，相同的偏好
  也匹配它们的编码计划变体（`volcengine-plan/*`，
  `byteplus-plan/*`)。
- 如果首选提供商过滤器为空，则选择器会回退到
  完整的目录而不是不显示任何模型。
- 向导运行模型检查，并在配置的模型未知或缺少认证时发出警告。

凭证和配置文件路径：

- 认证配置文件（API 密钥 + OAuth）：`~/.openclaw/agents/<agentId>/agent/auth-profiles.json`
- 旧版 OAuth 导入：`~/.openclaw/credentials/oauth.json`

凭证存储方式：

- 默认加入行为将 API 键保留为认证配置文件中的纯文本值。
- `--secret-input-mode ref` 启用引用模式而不是明文密钥存储。
  在交互式设置中，你可以选择：
  - 环境变量引用（例如 `keyRef: { source: "env", provider: "default", id: "OPENAI_API_KEY" }`）
  - 使用提供商别名 + id 配置提供商引用（`file` 或 `exec`）
- 交互式参考模式在保存之前运行快速预检验证。
  - Env refs：验证当前入门环境中的变量名称+非空值。
  - 提供商参考：验证提供商配置并解析请求的 ID。
  - 如果预检失败，入门会显示错误并让你重试。
- 在非交互模式下，`--secret-input-mode ref` 仅受环境支持。
  - 在入职流程环境中设置提供商环境变量。
  - 内联键标志（例如 `--openai-api-key`）要求设置环境变量；否则入职很快就会失败。
  - 对于自定义提供商，非交互式 `ref` 模式将 `models.providers.<id>.apiKey` 存储为 `{ source: "env", provider: "default", id: "CUSTOM_API_KEY" }`。
  - 在自定义提供商的情况下，`--custom-api-key` 需要设置 `CUSTOM_API_KEY`；否则入职很快就会失败。
- Gateway 认证凭据支持交互式设置中的明文和 SecretRef 选择：
  - token模式：**生成/存储明文token**（默认）或**使用 SecretRef**。
  - 密码模式：明文或SecretRef。
- 非交互式token SecretRef 路径：`--gateway-token-ref-env <ENV_VAR>`。
- 现有的明文设置继续保持不变。

<Note>
无头和服务器提示：在带有浏览器的机器上完成 OAuth，然后复制
该智能体的 `auth-profiles.json` （例如
`~/.openclaw/agents/<agentId>/agent/auth-profiles.json`，或匹配的
`$OPENCLAW_STATE_DIR/...` 路径）到网关主机。 `credentials/oauth.json`
只是一个遗留的导入源。
</Note>

## 输出和内部

`~/.openclaw/openclaw.json` 中的典型字段：

- `agents.defaults.workspace`
- `agents.defaults.skipBootstrap` 当 `--skip-bootstrap` 被传递时
- `agents.defaults.model` / `models.providers` （如果选择极小极大）
- `tools.profile`（未设置时，本地载入默认为 `"coding"`；保留现有显式值）
- `gateway.*`（模式、绑定、认证、tailscale）
- `session.dmScope`（未设置时本地载入默认为 `per-channel-peer`；保留现有显式值）
- `channels.telegram.botToken`、`channels.discord.token`、`channels.matrix.*`、`channels.signal.*`、`channels.imessage.*`
- 当你在提示期间选择加入时，频道允许列表（Slack、Discord、Matrix、Microsoft Teams）（如果可能，名称会解析为 ID）
- `skills.install.nodeManager`
  - `setup --node-manager` 标志接受 `npm`、`pnpm` 或 `bun`。
  - 稍后手动配置仍然可以设置`skills.install.nodeManager: "yarn"`。
- `wizard.lastRunAt`
- `wizard.lastRunVersion`
- `wizard.lastRunCommit`
- `wizard.lastRunCommand`
- `wizard.lastRunMode`

`openclaw agents add` 写入 `agents.list[]` 和可选的 `bindings`。

WhatsApp 凭据位于 `~/.openclaw/credentials/whatsapp/<accountId>/` 下。
会话存储在 `~/.openclaw/agents/<agentId>/sessions/` 下。

<Note>
某些频道作为插件提供。在安装过程中选择后，向导
在通道配置之前提示安装插件（npm 或本地路径）。
</Note>

Gateway 向导 RPC：

- `wizard.start`
- `wizard.next`
- `wizard.cancel`
- `wizard.status`

客户端（macOS 应用和 Control UI）可以渲染步骤，而无需重新实现载入逻辑。

Signal 设置行为：

- 下载适当的发布资产
- 将其存储在 `~/.openclaw/tools/signal-cli/<version>/` 下
- 在配置中写入 `channels.signal.cliPath`
- JVM 构建需要 Java 21
- 可用时使用本机构建
- Windows 使用 WSL2 并遵循 WSL 内的 Linux signal-cli 流程

## 相关文档

- 入职中心：[入职 (CLI)](/start/wizard)
- 自动化和脚本：[CLI 自动化](/start/wizard-cli-automation)
- 命令参考：[`openclaw onboard`](/cli/onboard)
