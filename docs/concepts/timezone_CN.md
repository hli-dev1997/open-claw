---
summary: "Timezone handling for agents, envelopes, and prompts"
read_when:
  - You need to understand how timestamps are normalized for the model
  - Configuring the user timezone for system prompts
title: "Timezones"
---

OpenClaw 标准化时间戳，以便模型看到**单一参考时间**。

## 消息信封（默认为本地）

入站消息被包装在一个信封中，如下所示：

```
[Provider ... 2026-01-05 16:26 PST] message text
```

信封中的时间戳是**默认主机本地**，精度为分钟。

你可以使用以下方法覆盖它：

```json5
{
  agents: {
    defaults: {
      envelopeTimezone: "local", // "utc" | "local" | "user" | IANA timezone
      envelopeTimestamp: "on", // "on" | "off"
      envelopeElapsed: "on", // "on" | "off"
    },
  },
}
```

- `envelopeTimezone: "utc"` 使用 UTC。
- `envelopeTimezone: "user"` 使用 `agents.defaults.userTimezone` （回退到主机时区）。
- 使用显式 IANA 时区（e.g.、`"Europe/Vienna"`）作为固定偏移量。
- `envelopeTimestamp: "off"` 从信封标头中删除绝对时间戳。
- `envelopeElapsed: "off"` 删除经过的时间后缀（`+2m` 样式）。

### 示例

**本地（默认）：**

```
[Signal Alice +1555 2026-01-18 00:19 PST] hello
```

**固定时区：**

```
[Signal Alice +1555 2026-01-18 06:19 GMT+1] hello
```

**经过时间：**

```
[Signal Alice +1555 +2m 2026-01-18T05:19Z] follow-up
```

## 工具有效负载（原始提供商数据+标准化字段）

工具调用（`channels.discord.readMessages`、`channels.slack.readMessages` 等）返回**原始提供商时间戳**。
我们还附加标准化字段以保持一致性：

- `timestampMs` （UTC 纪元毫秒）
- `timestampUtc`（ISO 8601 UTC 字符串）

保留原始提供商字段。

## 系统提示词的用户时区

设置 `agents.defaults.userTimezone` 来告诉模型用户的本地时区。如果是的话
未设置，OpenClaw 解析**运行时的主机时区**（无配置写入）。

```json5
{
  agents: { defaults: { userTimezone: "America/Chicago" } },
}
```

系统提示词信息包括：

- `Current Date & Time` 部分包含本地时间和时区
- `Time format: 12-hour` 或 `24-hour`

你可以使用 `agents.defaults.timeFormat` (`auto` | `12` | `24`) 控制提示格式。

请参阅 [日期和时间](/date-time) 了解完整的行为和示例。

## 相关

- [Heartbeat](/gateway/heartbeat) — 活动时间使用时区进行调度
- [Cron Jobs](/automation/cron-jobs) — cron 表达式使用时区进行调度
- [日期和时间](/date-time) — 完整的日期/时间行为和示例
