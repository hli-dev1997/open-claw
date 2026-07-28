---
summary: "Move one OpenClaw session's reply route between linked chat channels"
title: "Channel docking"
read_when:
  - You want replies for one active session to move from Telegram to Discord, Slack, Mattermost, or another linked channel
  - You are configuring session.identityLinks for cross-channel direct messages
  - A /dock command says the sender is not linked or no active session exists
---

通道对接是一个 OpenClaw 会话的呼叫转移。

它保持相同的对话上下文，但改变了未来的回复
该会议已交付。

## 示例

Alice 可以在 Telegram 和 Discord 上向 OpenClaw 发送消息：

```json5
{
  session: {
    identityLinks: {
      alice: ["telegram:123", "discord:456"],
    },
  },
}
```

如果 Alice 从 Telegram 发送此消息：

```text
/dock_discord
```

OpenClaw 保留当前会话上下文并更改回复路由：

|对接前|在 `/dock_discord` 之后 |
| ---------------------------- | ------------------------ | |
|回复至 Telegram `123` |回复至 Discord `456` |

不会重新创建会话。成绩单历史记录保留在
同一次会议。

## 为什么使用它

当某项任务在一个聊天应用中启动但下一个回复应该落地时，请使用对接
其他地方。

常见流程：

1. 从 Telegram 启动智能体任务。
2. 转到你正在协调工作的Discord。
3. 从 Telegram 会话发送 `/dock_discord`。
4. 保持相同的 OpenClaw 会话，但在 Discord 中接收未来回复。

## 所需配置

对接需要 `session.identityLinks`。源发送方和目标对等方
必须位于同一身份组中：

```json5
{
  session: {
    identityLinks: {
      alice: ["telegram:123", "discord:456", "slack:U123"],
    },
  },
}
```

这些值是通道前缀的对等 ID：

| 价值           | 意义                                    |
| -------------- | --------------------------------------- |
| `telegram:123` | `telegram:123` Telegram 发件人 ID `123` |
| `discord:456`  | Discord 直接对等 ID `456`               |
| `slack:U123`   | Slack 用户 ID `U123`                    |

规范密钥（上面的 `alice`）只是共享身份组名称。码头
命令使用通道前缀值来证明源发送者和
目标同伴是同一个人。

## 命令

Dock 命令是从支持本机的加载通道插件生成的
命令。当前捆绑的命令：

| 目标渠道 | 命令               | 别名               |
| -------- | ------------------ | ------------------ |
| Discord  | `/dock-discord`    | `/dock_discord`    |
| 最重要   | `/dock-mattermost` | `/dock_mattermost` |
| Slack    | `/dock-slack`      | `/dock_slack`      |
| Telegram | `/dock-telegram`   | `/dock_telegram`   |

下划线别名在本机命令表面上很有用，例如 Telegram。

## 有什么变化

对接更新活动会话传递字段：

| 会话字段        | `/dock_discord` 之后的示例 |
| --------------- | -------------------------- |
| `lastChannel`   | `discord`                  |
| `lastTo`        | `456`                      |
| `lastAccountId` | 目标频道帐户，或 `default` |

这些字段保留在会话存储中并供以后的回复使用
该会议的交付。

## 什么没有改变

对接不会：

- 创建频道帐户
- 连接新的 Discord、Telegram、Slack 或 Mattermost 机器人
- 授予用户访问权限
- 绕过渠道许可名单或 DM 政策
- 将成绩单历史记录移动到另一个会话
- 让不相关的用户共享一个会话

它仅更改当前会话的传递路线。

## 故障排除

**该命令表示发件人未链接。**

将当前发送者和目标对等点添加到同一个
`session.identityLinks` 组。例如，如果 Telegram 发送者 `123` 应停靠
到 Discord 对等 `456`，包括 `telegram:123` 和 `discord:456`。

**该命令表示不存在活动会话。**

从现有的直接聊天会话中停靠。该命令需要一个活动会话
条目，以便它可以保留新路线。

**回复仍然会转到旧频道。**

检查命令是否回复成功消息，并确认目标
对等 ID 与该通道使用的 ID 匹配。对接仅更改活动的
会话路线；另一个会话可能仍会路由到其他地方。

**我需要切换回来。**

发送原通道的匹配命令，如`/dock_telegram`或
`/dock-telegram`，来自链接的发件人。
