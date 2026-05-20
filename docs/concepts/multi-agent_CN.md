---
summary: "Multi-agent routing: isolated agents, channel accounts, and bindings"
title: "Multi-agent routing"
sidebarTitle: "Multi-agent routing"
read_when: "You want multiple isolated agents (workspaces + auth) in one gateway process."
status: active
---

运行多个 _隔离的_ 智能体：每个智能体都有自己的工作区、状态目录（`agentDir`）和会话历史；同时在一个运行中的 Gateway 中使用多个通道帐户（例如两个 WhatsApp）。入站消息通过绑定路由到正确的智能体。

这里的**智能体**是完整的每 persona 范围：工作区文件、认证配置文件、模型注册表和会话存储。`agentDir` 是磁盘状态目录，在 `~/.openclaw/agents/<agentId>/` 保存该智能体的配置。**绑定** 会把通道帐户（例如 Slack 工作区或 WhatsApp 号码）映射到其中一个智能体。

## 什么是“一个智能体”？

**智能体**是一个具有完整范围的大脑，拥有自己的：

- **工作区**（文件、AGENTS.md/SOUL.md/USER.md、本地注释、角色规则）。
- **状态目录** (`agentDir`) 用于认证配置文件、模型注册表和每个智能体配置。
- **会话存储**（聊天历史记录 + 路由状态）位于 `~/.openclaw/agents/<agentId>/sessions` 下。

认证配置文件是**每个智能体**。每个智能体读取自己的内容：

```text
~/.openclaw/agents/<agentId>/agent/auth-profiles.json
```

<Note>
`sessions_history` 在这里也是更安全的跨会话调用路径：它返回有界的、经过清理的视图，而不是原始转录本转储。助手召回剥离了思维标签、`<relevant-memories>` 脚手架、纯文本工具调用 XML 有效负载（包括 `<tool_call>...</tool_call>`、`<function_call>...</function_call>`、`<tool_calls>...</tool_calls>`、`<function_calls>...</function_calls>` 和截断的工具调用块）、降级的工具调用脚手架、泄漏的 ASCII/全角模型控制token以及编辑/截断之前格式错误的 MiniMax 工具调用 XML。
</Note>

<Warning>
切勿跨智能体重复使用 `agentDir`（这会导致认证/会话冲突）。当智能体没有
本地配置文件时，可以透传读取 default/main 智能体的认证配置文件，
但 OpenClaw 不会将 OAuth 刷新 token 克隆到
次级智能体存储中。如果你想要独立的 OAuth 帐户，请从
该智能体登录；如果你手动复制凭据，则仅复制可移植的静态
`api_key` 或 `token` 配置文件。
</Warning>

Skills 从每个智能体工作区以及共享根（例如 `~/.openclaw/skills`）加载，然后在配置时按有效智能体技能白名单进行过滤。使用 `agents.defaults.skills` 进行共享基线，使用 `agents.list[].skills` 进行每个智能体的替换。请参阅 [Skills：每个智能体与共享](/tools/skills#per-agent-vs-shared-skills) 和 [Skills：智能体技能白名单](/tools/skills#agent-skill-allowlists)。

Gateway 可以托管**一个智能体**（默认）或并排托管**多个智能体**。

<Note>
**工作区注意：**每个智能体的工作区是**默认的cwd**，而不是硬沙箱。相对路径在工作区内部解析，但除非启用沙箱，否则绝对路径可以到达其他主机位置。请参阅[沙盒](/gateway/sandboxing)。
</Note>

## 路径（快速地图）

- 配置：`~/.openclaw/openclaw.json`（或`OPENCLAW_CONFIG_PATH`）
- 状态目录：`~/.openclaw`（或`OPENCLAW_STATE_DIR`）
- 工作区：`~/.openclaw/workspace`（或`~/.openclaw/workspace-<agentId>`）
- 智能体目录：`~/.openclaw/agents/<agentId>/agent`（或 `agents.list[].agentDir`）
- 会话：`~/.openclaw/agents/<agentId>/sessions`

### 单智能体模式（默认）

如果你什么都不做，OpenClaw 会运行单个智能体：

- `agentId` 默认为 **`main`**。
- 会话的密钥为 `agent:main:<mainKey>`。
- 工作区默认为 `~/.openclaw/workspace` （或当设置 `OPENCLAW_PROFILE` 时为 `~/.openclaw/workspace-<profile>`）。
- 状态默认为 `~/.openclaw/agents/main/agent`。

## 智能体助手

使用智能体向导添加新的隔离智能体：

```bash
openclaw agents add work
```

然后添加 `bindings` （或让向导执行此操作）以路由入站消息。

验证：

```bash
openclaw agents list --bindings
```

## 快速开始

<Steps>
  <Step title="Create each agent workspace">
    使用向导或手动创建工作区：

    ```bash
    openclaw agents add coding
    openclaw agents add social
    ```

    每个智能体都有自己的工作区，包括 `SOUL.md`、`AGENTS.md` 和可选的 `USER.md`，以及专用的 `agentDir` 和 `~/.openclaw/agents/<agentId>` 下的会话存储。

  </Step>
  <Step title="Create channel accounts">
    在你的首选渠道上为每个智能体创建一个帐户：

    - Discord：每个智能体一个机器人，启用消息内容意图，复制每个token。
    - Telegram：每个智能体一个机器人通过 BotFather，复制每个token。
    - WhatsApp：链接每个帐户的每个电话号码。

    ```bash
    openclaw channels login --channel whatsapp --account work
    ```

    请参阅频道指南：[Discord](/channels/discord)、[Telegram](/channels/telegram)、[WhatsApp](/channels/whatsapp)。

  </Step>
  <Step title="Add agents, accounts, and bindings">
    在 `agents.list` 下添加智能体，在 `channels.<channel>.accounts` 下添加渠道帐户，并将它们与 `bindings` 连接（示例如下）。
  </Step>
  <Step title="Restart and verify">
    ```bash
    openclaw gateway restart
    openclaw agents list --bindings
    openclaw channels status --probe
    ```
  </Step>
</Steps>

## 多个智能体=多人，多重性格

通过 **多个智能体**，每个 `agentId` 成为 **完全隔离的角色**：

- **不同的电话号码/帐户**（每个频道 `accountId`）。
- **不同的个性**（每个智能体工作区文件，例如 `AGENTS.md` 和 `SOUL.md`）。
- **单独的认证+会话**（除非明确启用，否则不会发生串扰）。

这使得**多人**可以共享一台 Gateway 服务器，同时保持他们的人工智能“大脑”和数据隔离。

## 跨智能体QMD内存搜索

如果一个智能体应搜索另一智能体的 QMD 会话记录，请在 `agents.list[].memorySearch.qmd.extraCollections` 下添加额外的集合。仅当每个智能体都应继承相同的共享转录本集合时，才使用 `agents.defaults.memorySearch.qmd.extraCollections` 。

```json5
{
  agents: {
    defaults: {
      workspace: "~/workspaces/main",
      memorySearch: {
        qmd: {
          extraCollections: [{ path: "~/agents/family/sessions", name: "family-sessions" }],
        },
      },
    },
    list: [
      {
        id: "main",
        workspace: "~/workspaces/main",
        memorySearch: {
          qmd: {
            extraCollections: [{ path: "notes" }], // resolves inside workspace -> collection named "notes-main"
          },
        },
      },
      { id: "family", workspace: "~/workspaces/family" },
    ],
  },
  memory: {
    backend: "qmd",
    qmd: { includeDefaultMemory: false },
  },
}
```

额外的集合路径可以在智能体之间共享，但当路径位于智能体工作区之外时，集合名称保持明确。工作区内的路径保持智能体范围，因此每个智能体保留自己的转录搜索集。

## 一个WhatsApp号，多人（DM拆分）

你可以将**不同的 WhatsApp DM** 路由到不同的智能体，同时保留在**一个 WhatsApp 帐户**。发送方 E.164（如 `+15551234567`）与 `peer.kind: "direct"` 匹配。回复仍然来自相同的 WhatsApp 号码（没有每个智能体发件人身份）。

<Note>
直接聊天会崩溃到智能体的**主会话密钥**，因此真正的隔离需要**每人一个智能体**。
</Note>

示例：

```json5
{
  agents: {
    list: [
      { id: "alex", workspace: "~/.openclaw/workspace-alex" },
      { id: "mia", workspace: "~/.openclaw/workspace-mia" },
    ],
  },
  bindings: [
    {
      agentId: "alex",
      match: { channel: "whatsapp", peer: { kind: "direct", id: "+15551230001" } },
    },
    {
      agentId: "mia",
      match: { channel: "whatsapp", peer: { kind: "direct", id: "+15551230002" } },
    },
  ],
  channels: {
    whatsapp: {
      dmPolicy: "allowlist",
      allowFrom: ["+15551230001", "+15551230002"],
    },
  },
}
```

注意事项：

- DM 访问控制是**针对每个 WhatsApp 帐户**（配对/允许列表）的全局控制，而不是针对每个智能体。
- 对于共享组，将组绑定到一个智能体或使用[广播组](/channels/broadcast-groups)。

## 路由规则（消息如何选择智能体）

绑定是**确定性**和**最具体的胜利**：

<Steps>
  <Step title="peer match">
    准确的 DM/组/频道 ID。
  </Step>
  <Step title="parentPeer match">
    线程继承。
  </Step>
  <Step title="guildId + roles">
    Discord 角色路由。
  </Step>
  <Step title="guildId">
    Discord。
  </Step>
  <Step title="teamId">
    Slack。
  </Step>
  <Step title="accountId match for a channel">
    每个帐户的回退。
  </Step>
  <Step title="Channel-level match">
    `accountId: "*"`。
  </Step>
  <Step title="Default agent">
    回退到 `agents.list[].default`，否则第一个列表条目，默认值：`main`。
  </Step>
</Steps>

<AccordionGroup>
  <Accordion title="Tie-breaking and AND semantics">
    - 如果多个绑定在同一层中匹配，则配置顺序中的第一个获胜。
    - 如果绑定设置多个匹配字段（例如 `peer` + `guildId`），则所有指定字段都是必需的（`AND` 语义）。

  </Accordion>
  <Accordion title="Account-scope detail">
    - 省略 `accountId` 的绑定仅与默认帐户匹配。
    - 使用 `accountId: "*"` 在所有帐户之间进行通道范围的回退。
    - 如果你稍后使用显式帐户 ID 为同一智能体添加相同的绑定，OpenClaw 会将现有的仅通道绑定升级到帐户范围，而不是重复它。

  </Accordion>
</AccordionGroup>

## 多个帐户/电话号码

支持**多个帐户** (e.g.WhatsApp) 的通道使用 `accountId` 来标识每次登录。每个 `accountId` 可以路由到不同的智能体，因此一台服务器可以托管多个电话号码，而无需混合会话。

如果你希望在省略 `accountId` 时使用通道范围的默认帐户，请设置 `channels.<channel>.defaultAccount` （可选）。未设置时，OpenClaw 如果存在，则回退到 `default`，否则为第一个配置的帐户 ID（已排序）。

支持这种模式的常见渠道包括：

- `whatsapp`、`telegram`、`discord`、`slack`、`signal`、`imessage`
- `irc`、`line`、`googlechat`、`mattermost`、`matrix`、`nextcloud-talk`
- `bluebubbles`、`zalo`、`zalouser`、`nostr`、`feishu`

## 概念

- `agentId`：一个“大脑”（工作区、每个智能体认证、每个智能体会话存储）。
- `accountId`：一个通道帐户实例（e.g。WhatsApp 帐户 `"personal"` 与 `"biz"`）。
- `binding`：通过 `(channel, accountId, peer)` 和可选的公会/团队 ID 将入站消息路由到 `agentId`。
- 直接聊天崩溃为`agent:<agentId>:<mainKey>`（每个智能体“主要”；`session.mainKey`）。

## 平台示例

<AccordionGroup>
  <Accordion title="Discord bots per agent">
    每个 Discord 机器人帐户映射到一个唯一的 `accountId`。将每个帐户绑定到智能体并保留每个机器人的许可名单。

    ```json5
    {
      agents: {
        list: [
          { id: "main", workspace: "~/.openclaw/workspace-main" },
          { id: "coding", workspace: "~/.openclaw/workspace-coding" },
        ],
      },
      bindings: [
        { agentId: "main", match: { channel: "discord", accountId: "default" } },
        { agentId: "coding", match: { channel: "discord", accountId: "coding" } },
      ],
      channels: {
        discord: {
          groupPolicy: "allowlist",
          accounts: {
            default: {
              token: "DISCORD_BOT_TOKEN_MAIN",
              guilds: {
                "123456789012345678": {
                  channels: {
                    "222222222222222222": { allow: true, requireMention: false },
                  },
                },
              },
            },
            coding: {
              token: "DISCORD_BOT_TOKEN_CODING",
              guilds: {
                "123456789012345678": {
                  channels: {
                    "333333333333333333": { allow: true, requireMention: false },
                  },
                },
              },
            },
          },
        },
      },
    }
    ```

    - 邀请每个机器人加入公会并启用消息内容意图。
    - token位于 `channels.discord.accounts.<id>.token` （默认帐户可以使用 `DISCORD_BOT_TOKEN`）。

  </Accordion>
  <Accordion title="Telegram bots per agent">
    ```json5
    {
      agents: {
        list: [
          { id: "main", workspace: "~/.openclaw/workspace-main" },
          { id: "alerts", workspace: "~/.openclaw/workspace-alerts" },
        ],
      },
      bindings: [
        { agentId: "main", match: { channel: "telegram", accountId: "default" } },
        { agentId: "alerts", match: { channel: "telegram", accountId: "alerts" } },
      ],
      channels: {
        telegram: {
          accounts: {
            default: {
              botToken: "123456:ABC...",
              dmPolicy: "pairing",
            },
            alerts: {
              botToken: "987654:XYZ...",
              dmPolicy: "allowlist",
              allowFrom: ["tg:123456789"],
            },
          },
        },
      },
    }
    ```

    - 使用 BotFather 为每个智能体创建一个机器人并复制每个token。
    - token位于 `channels.telegram.accounts.<id>.botToken` （默认帐户可以使用 `TELEGRAM_BOT_TOKEN`）。

  </Accordion>
  <Accordion title="WhatsApp numbers per agent">
    在启动网关之前链接每个帐户：

    ```bash
    openclaw channels login --channel whatsapp --account personal
    openclaw channels login --channel whatsapp --account biz
    ```

    `~/.openclaw/openclaw.json` (JSON5):

    ```js
    {
      agents: {
        list: [
          {
            id: "home",
            default: true,
            name: "Home",
            workspace: "~/.openclaw/workspace-home",
            agentDir: "~/.openclaw/agents/home/agent",
          },
          {
            id: "work",
            name: "Work",
            workspace: "~/.openclaw/workspace-work",
            agentDir: "~/.openclaw/agents/work/agent",
          },
        ],
      },

      // Deterministic routing: first match wins (most-specific first).
      bindings: [
        { agentId: "home", match: { channel: "whatsapp", accountId: "personal" } },
        { agentId: "work", match: { channel: "whatsapp", accountId: "biz" } },

        // Optional per-peer override (example: send a specific group to work agent).
        {
          agentId: "work",
          match: {
            channel: "whatsapp",
            accountId: "personal",
            peer: { kind: "group", id: "1203630...@g.us" },
          },
        },
      ],

      // Off by default: agent-to-agent messaging must be explicitly enabled + allowlisted.
      tools: {
        agentToAgent: {
          enabled: false,
          allow: ["home", "work"],
        },
      },

      channels: {
        whatsapp: {
          accounts: {
            personal: {
              // Optional override. Default: ~/.openclaw/credentials/whatsapp/personal
              // authDir: "~/.openclaw/credentials/whatsapp/personal",
            },
            biz: {
              // Optional override. Default: ~/.openclaw/credentials/whatsapp/biz
              // authDir: "~/.openclaw/credentials/whatsapp/biz",
            },
          },
        },
      },
    }
    ```

  </Accordion>
</AccordionGroup>

## 常见模式

<Tabs>
  <Tab title="WhatsApp daily + Telegram deep work">
    按渠道拆分：将 WhatsApp 路由至快速日常智能体，将 Telegram 路由至 Opus 智能体。

    ```json5
    {
      agents: {
        list: [
          {
            id: "chat",
            name: "Everyday",
            workspace: "~/.openclaw/workspace-chat",
            model: "anthropic/claude-sonnet-4-6",
          },
          {
            id: "opus",
            name: "Deep Work",
            workspace: "~/.openclaw/workspace-opus",
            model: "anthropic/claude-opus-4-6",
          },
        ],
      },
      bindings: [
        { agentId: "chat", match: { channel: "whatsapp" } },
        { agentId: "opus", match: { channel: "telegram" } },
      ],
    }
    ```

    注意事项：

    - 如果你的频道有多个帐户，请将 `accountId` 添加到绑定（例如 `{ channel: "whatsapp", accountId: "personal" }`）。
    - 要将单个 DM/组路由到 Opus，同时保持其余的聊天，请为该对等点添加 `match.peer` 绑定；同行比赛总是胜过频道范围内的规则。

  </Tab>
  <Tab title="Same channel, one peer to Opus">
    将 WhatsApp 保留在快速智能体上，但将一个 DM 路由到 Opus：

    ```json5
    {
      agents: {
        list: [
          {
            id: "chat",
            name: "Everyday",
            workspace: "~/.openclaw/workspace-chat",
            model: "anthropic/claude-sonnet-4-6",
          },
          {
            id: "opus",
            name: "Deep Work",
            workspace: "~/.openclaw/workspace-opus",
            model: "anthropic/claude-opus-4-6",
          },
        ],
      },
      bindings: [
        {
          agentId: "opus",
          match: { channel: "whatsapp", peer: { kind: "direct", id: "+15551234567" } },
        },
        { agentId: "chat", match: { channel: "whatsapp" } },
      ],
    }
    ```

    对等绑定总是获胜，因此请将它们置于通道范围规则之上。

  </Tab>
  <Tab title="Family agent bound to a WhatsApp group">
    将专用的家族智能体绑定到单个 WhatsApp 组，并使用提及门控和更严格的工具策略：

    ```json5
    {
      agents: {
        list: [
          {
            id: "family",
            name: "Family",
            workspace: "~/.openclaw/workspace-family",
            identity: { name: "Family Bot" },
            groupChat: {
              mentionPatterns: ["@family", "@familybot", "@Family Bot"],
            },
            sandbox: {
              mode: "all",
              scope: "agent",
            },
            tools: {
              allow: [
                "exec",
                "read",
                "sessions_list",
                "sessions_history",
                "sessions_send",
                "sessions_spawn",
                "session_status",
              ],
              deny: ["write", "edit", "apply_patch", "browser", "canvas", "nodes", "cron"],
            },
          },
        ],
      },
      bindings: [
        {
          agentId: "family",
          match: {
            channel: "whatsapp",
            peer: { kind: "group", id: "120363999999999999@g.us" },
          },
        },
      ],
    }
    ```

    注意事项：

    - 工具允许/拒绝列表是**工具**，而不是技能。如果技能需要运行二进制文件，请确保允许 `exec` 并且该二进制文件存在于沙箱中。
    - 要进行更严格的控制，请设置 `agents.list[].groupChat.mentionPatterns` 并保持为通道启用组允许列表。

  </Tab>
</Tabs>

## 每个智能体沙箱和工具配置

每个智能体可以有自己的沙箱和工具限制：

```js
{
  agents: {
    list: [
      {
        id: "personal",
        workspace: "~/.openclaw/workspace-personal",
        sandbox: {
          mode: "off",  // No sandbox for personal agent
        },
        // No tool restrictions - all tools available
      },
      {
        id: "family",
        workspace: "~/.openclaw/workspace-family",
        sandbox: {
          mode: "all",     // Always sandboxed
          scope: "agent",  // One container per agent
          docker: {
            // Optional one-time setup after container creation
            setupCommand: "apt-get update && apt-get install -y git curl",
          },
        },
        tools: {
          allow: ["read"],                    // Only read tool
          deny: ["exec", "write", "edit", "apply_patch"],    // Deny others
        },
      },
    ],
  },
}
```

<Note>
`setupCommand` 位于 `sandbox.docker` 下，并在容器创建时运行一次。当解析的范围为 `"shared"` 时，将忽略每个智能体 `sandbox.docker.*` 覆盖。
</Note>

**好处：**

- **安全隔离**：限制不受信任的智能体使用的工具。
- **资源控制**：沙箱特定智能体，同时将其他智能体保留在主机上。
- **灵活的政策**：每个智能体有不同的权限。

<Note>
`tools.elevated` 是**全局**并且基于发送者；它不可针对每个智能体进行配置。如果你需要每个智能体边界，请使用 `agents.list[].tools` 拒绝 `exec`。对于组定位，请使用 `agents.list[].groupChat.mentionPatterns`，以便 @mentions 清晰地映射到目标智能体。
</Note>

有关详细示例，请参阅[多智能体沙箱和工具](/tools/multi-agent-sandbox-tools)。

## 相关

- [ACP 智能体](/tools/acp-agents) — 运行外部编码线束
- [通道路由](/channels/channel-routing) — 消息如何路由到智能体
- [存在](/concepts/presence) — 智能体存在和可用性
- [Session](/concepts/session) — 会话隔离和路由
- [子智能体](/tools/subagents) — 生成后台智能体运行
