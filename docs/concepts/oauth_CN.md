---
summary: "OAuth in OpenClaw: token exchange, storage, and multi-account patterns"
read_when:
  - You want to understand OpenClaw OAuth end-to-end
  - You hit token invalidation / logout issues
  - You want Claude CLI or OAuth auth flows
  - You want multiple accounts or profile routing
title: "OAuth"
---

OpenClaw 通过 OAuth 支持提供“订阅认证”的提供商
（特别是 **OpenAI Codex (ChatGPT OAuth)**）。对于 Anthropic，实际分割
现在是：

- **Anthropic API key**：正常 Anthropic API 计费
- **Anthropic Claude CLI / OpenClaw** 内的订阅授权：Anthropic 工作人员
  告诉我们再次允许这种用法

OpenAI Codex OAuth 明确支持在外部工具中使用，例如
OpenClaw。本页说明：

对于生产中的 Anthropic，API 密钥认证是更安全的推荐路径。

- OAuth **token交换**如何工作 (PKCE)
- token**存储在哪里**（以及原因）
- 如何处理**多个帐户**（配置文件+每个会话覆盖）

OpenClaw 还支持提供自己的 OAuth 或 API 密钥的**提供商插件**
流动。通过以下方式运行它们：

```bash
openclaw models auth login --provider <id>
```

## token接收器（为什么存在）

OAuth 提供商通常会在登录/刷新流程期间创建**新的刷新token**。当为同一用户/应用颁发新的刷新token时，某些提供商（或 OAuth 客户端）可能会使旧的刷新token失效。

实际症状：

- 你通过 OpenClaw 登录并通过 Claude 代码 / Codex CLI → 其中一个稍后会随机“注销”

为了减少这种情况，OpenClaw 将 `auth-profiles.json` 视为 **token接收器**：

- 运行时从**一个地方**读取凭据
- 我们可以保留多个配置文件并确定性地路由它们
- 外部 CLI 重用是特定于提供商的： Codex CLI 可以引导一个空的
  `openai-codex:default` 配置文件，但是一旦 OpenClaw 具有本地 OAuth 配置文件，
  本地刷新token是规范的；其他集成可以保留
  外部管理并重新读取其 CLI auth 存储
- 已经知道配置的提供商集范围的状态和启动路径
  该集的外部 CLI 发现，因此不相关的 CLI 登录存储不是
  调查单一提供商设置

## 存储（token所在的地方）

秘密存储在智能体认证存储中：

- 认证配置文件（OAuth + API 键 + 可选值级别引用）：`~/.openclaw/agents/<agentId>/agent/auth-profiles.json`
- 旧版兼容性文件：`~/.openclaw/agents/<agentId>/agent/auth.json`
  （静态 `api_key` 条目在发现时会被清除）

旧版仅导入文件（仍然支持，但不是主存储）：

- `~/.openclaw/credentials/oauth.json`（首次使用时导入到 `auth-profiles.json`）

以上所有内容也遵循 `$OPENCLAW_STATE_DIR` （状态目录覆盖）。完整参考：[/gateway/configuration](/gateway/configuration-reference#auth-storage)

有关静态机密引用和运行时快照激活行为，请参阅[机密管理](/gateway/secrets)。

当辅助智能体没有本地认证配置文件时，OpenClaw 使用通读
从默认/主智能体存储继承。它不克隆主
读取时智能体的 `auth-profiles.json`。 OAuth 刷新token尤其如此
敏感：正常复制流程默认会跳过它们，因为某些提供商会轮换
或在使用后使刷新token失效。为一个单独的 OAuth 登录配置
需要独立账户时智能体。

## Anthropic 旧token兼容性

<Warning>
Anthropic 的公共 Claude 代码文档说直接 Claude 代码使用保持在
Claude 订阅限制，以及 Anthropic 工作人员告诉我们 OpenClaw 风格 Claude
再次允许使用 CLI。 OpenClaw 因此对待 Claude CLI 重用和
`claude -p` 的用法与此集成一致，除非 Anthropic
发布新政策。

对于 Anthropic 当前的直接-Claude-代码计划文档，请参阅[使用 Claude 代码
与你的 Pro 或 Max
计划](https://support.claude.com/en/articles/11145838-using-claude-code-with-your-pro-or-max-plan)
以及[与你的团队或企业一起使用 Claude 代码
计划](https://support.anthropic.com/en/articles/11845131-using-claude-code-with-your-team-or-enterprise-plan/)。

如果你想要 OpenClaw 中的其他订阅样式选项，请参阅 [OpenAI
Codex](/providers/openai),【Qwen云编码
计划](/providers/qwen), [MiniMax 编码计划](/providers/minimax),
和 [Z.AI / GLM 编码计划](/providers/glm)。
</Warning>

OpenClaw 还公开 Anthropic setup-token 作为受支持的token认证路径，但它现在更喜欢 Claude CLI 重用和 `claude -p` （如果可用）。

## Anthropic Claude CLI 迁移

OpenClaw 支持 Anthropic Claude CLI 再次重用。如果你已经有本地
Claude登录主机，onboarding/configure可以直接复用。

## OAuth 交换（登录如何工作）

OpenClaw 的交互式登录流程在 `@mariozechner/pi-ai` 中实现，并连接到向导/命令中。

### Anthropic 设置token

流形：

1. 从 OpenClaw 启动 Anthropic 设置token或粘贴token
2. OpenClaw 将生成的 Anthropic 凭证存储在认证配置文件中
3. 模型选择停留在`anthropic/...`
4. 现有的 Anthropic 认证配置文件仍然可用于回滚/顺序控制

### OpenAI Codex (ChatGPT OAuth)

OpenAI Codex OAuth 明确支持在 Codex CLI 之外使用，包括 OpenClaw 工作流程。

流动形状 (PKCE)：

1.生成PKCE验证者/挑战+随机`state`
2.打开`https://auth.openai.com/oauth/authorize?...`
3.尝试捕获 `http://127.0.0.1:1455/auth/callback` 回调
4. 如果回调无法绑定（或者你是远程/headless），请粘贴重定向URL/code
5. 兑换于`https://auth.openai.com/oauth/token`
6. 从访问token中提取 `accountId` 并存储 `{ access, refresh, expires, accountId }`

向导路径为 `openclaw onboard` → 认证选择 `openai-codex`。

## 刷新+过期

配置文件存储 `expires` 时间戳。

运行时：

- 如果 `expires` 是将来的 → 使用存储的访问token
- 如果过期→刷新（在文件锁定下）并覆盖存储的凭据
- 如果辅助智能体读取继承的主智能体 OAuth 配置文件，则刷新
  写回到主智能体存储，而不是将刷新token复制到
  二级智能体店
- 例外：一些外部 CLI 凭证保持外部管理； OpenClaw
  重新读取这些 CLI 认证存储，而不是花费复制的刷新token。
  Codex CLI bootstrap 故意变窄：它播种了一个空的
  `openai-codex:default` 配置文件，然后 OpenClaw 拥有的刷新保留本地
  配置文件规范。

刷新流程是自动的；你通常不需要手动管理token。

## 多个帐户（配置文件）+路由

两种模式：

### 1) 首选：独立智能体

如果你希望“个人”和“工作”永远不会交互，请使用隔离智能体（单独的会话+凭据+工作区）：

```bash
openclaw agents add work
openclaw agents add personal
```

然后配置每个智能体的认证（向导）并将聊天路由到正确的智能体。

### 2) 高级：一个智能体中有多个配置文件

`auth-profiles.json` 支持同一提供商的多个配置文件 ID。

选择使用哪个配置文件：

- 通过配置排序全局 (`auth.order`)
- 每个会话通过 `/model ...@<profileId>`

示例（会话覆盖）：

- `/model Opus@anthropic:work`

如何查看存在哪些配置文件 ID：

- `openclaw channels list --json`（显示 `auth[]`）

相关文档：

- [模型故障转移](/concepts/model-failover)（轮换+冷却规则）
- [斜线命令](/tools/slash-commands)（命令表面）

## 相关

- [Authentication](/gateway/authentication) — 模型提供商认证概述
- [Secrets](/gateway/secrets) — 凭证存储和 SecretRef
- [配置参考](/gateway/configuration-reference#auth-storage) — 认证配置密钥
