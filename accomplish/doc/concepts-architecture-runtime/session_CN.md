---
summary: "How OpenClaw manages conversation sessions"
read_when:
  - You want to understand session routing and isolation
  - You want to configure DM scope for multi-user setups
  - You are debugging daily or idle session resets
title: "Session management"
---

OpenClaw 将对话组织成**会话**。每条消息都被路由到
会话基于其来源——私信、群聊、cron 作业等。

## 消息如何路由

|来源 |行为 |
| ---------------- | ---------------------------------- |
|直接留言 |默认共享会话 |
|群聊 |每组隔离 |
|房间/频道|每个房间隔离|
|计划任务 |每次运行新的会话 |
|网络钩子 |每个钩子隔离 |

## DM 隔离

默认情况下，所有 DM 共享一个会话以保证连续性。这对于
单用户设置。

<Warning>
如果多人可以向你的智能体发送消息，请启用 DM 隔离。没有它，一切
用户共享相同的对话上下文——Alice 的私人消息将是
鲍勃可见。
</Warning>

**修复：**

```json5
{
  session: {
    dmScope: "per-channel-peer", // isolate by channel + sender
  },
}
```

其他选项：

- `main`（默认）——所有 DM 共享一个会话。
- `per-peer` -- 按发送者隔离（跨通道）。
- `per-channel-peer` -- 按通道 + 发送者隔离（推荐）。
- `per-account-channel-peer` -- 按帐户+通道+发送者隔离。

<Tip>
如果同一个人通过多个渠道联系你，请使用
`session.identityLinks` 链接他们的身份，以便他们共享一个会话。
</Tip>

### 对接链接频道

Dock 命令允许用户将当前直接聊天会话的回复路由移动到
另一个链接的频道，无需启动新会话。参见
[频道对接](/concepts/channel-docking) 示例、配置和
故障排除。

使用 `openclaw security audit` 验证你的设置。

## 会话生命周期

会话将被重复使用，直到过期：

- **每日重置**（默认）——网关上当地时间凌晨 4:00 的新会话
  主机。每日新鲜度基于当前 `sessionId` 开始的时间，而不是
  稍后元数据写入。
- **空闲重置**（可选）——一段时间不活动后的新会话。套装
  `session.reset.idleMinutes`。空闲新鲜度是基于最后真实的
  用户/通道交互，因此心跳、cron 和 exec 系统事件不会
  保持会话存活。
- **手动重置** -- 在聊天中输入 `/new` 或 `/reset`。 `/new <model>` 也
  切换模型。

当每日重置和空闲重置均已配置时，以先到期者为准。
Heartbeat、cron、exec 和其他系统事件轮流可能会写入会话元数据，
但这些写入不会延长每日或空闲重置的新鲜度。当重置时
滚动会话，旧会话的排队系统事件通知是
已被丢弃，因此过时的后台更新不会添加到第一个提示之前
新会话。

具有活动提供商拥有的 CLI 会话的会话不会被隐式切断
每日默认。当这些情况时使用 `/reset` 或显式配置 `session.reset`
会话应该在计时器上到期。

## 状态所在

所有会话状态均由**网关**拥有。 UI 客户端查询网关
会话数据。

- **商店：** `~/.openclaw/agents/<agentId>/sessions/sessions.json`
- **成绩单：** `~/.openclaw/agents/<agentId>/sessions/<sessionId>.jsonl`

`sessions.json` 保留单独的生命周期时间戳：

- `sessionStartedAt`：当前`sessionId`开始时；每日重置使用此。
- `lastInteractionAt`：最后一次用户/通道交互，延长空闲寿命。
- `updatedAt`：最后一个存储行突变；对于列表和修剪有用，但不是
  每日/空闲重置新鲜度的权威。

没有 `sessionStartedAt` 的旧行从记录 JSONL 解析
会话标头（如果可用）。如果较旧的行也缺少 `lastInteractionAt`，
空闲新鲜度回落到该会话开始时间，而不是稍后的记账时间
写道。

## 会话维护

OpenClaw 随着时间的推移自动限制会话存储。默认情况下，它运行
在 `warn` 模式下（报告将清理的内容）。设置 `session.maintenance.mode`
到 `"enforce"` 进行自动清理：

```json5
{
  session: {
    maintenance: {
      mode: "enforce",
      pruneAfter: "30d",
      maxEntries: 500,
    },
  },
}
```

对于生产规模的 `maxEntries` 限制，Gateway 运行时写入使用小型高水位缓冲区，并批量清理回配置的上限。在 Gateway 启动期间，会话存储读取不会修剪或限制条目。这可以避免在每次启动或隔离的 cron 会话时运行完整的存储清理。 `openclaw sessions cleanup --enforce` 立即应用上限。

使用 `openclaw sessions cleanup --dry-run` 进行预览。

## 检查会话

- `openclaw status` -- 会话存储路径和最近的活动。
- `openclaw sessions --json` -- 所有会话（使用 `--active <minutes>` 进行过滤）。
- 聊天中的 `/status` -- 上下文使用、模型和切换。
- `/context list` -- 系统提示词符中的内容。

## 进一步阅读

- [会话修剪](/concepts/session-pruning) -- 修剪工具结果
- [Compaction](/concepts/compaction) -- 总结长对话
- [Session Tools](/concepts/session-tool) -- 跨会话工作的智能体工具
- [会话管理深入探讨](/reference/session-management-compaction) --
  存储架构、成绩单、发送策略、源元数据和高级配置
- [多智能体](/concepts/multi-agent) — 跨智能体的路由和会话隔离
- [后台任务](/automation/tasks) — 分离工作如何使用会话引用创建任务记录
- [通道路由](/channels/channel-routing) — 入站消息如何路由到会话

## 相关

- [会话修剪](/concepts/session-pruning)
- [会话工具](/concepts/session-tool)
- [命令队列](/concepts/queue)
