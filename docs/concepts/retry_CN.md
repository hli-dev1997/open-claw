---
summary: "Retry policy for outbound provider calls"
read_when:
  - Updating provider retry behavior or defaults
  - Debugging provider send errors or rate limits
title: "Retry policy"
---

## 目标

- 按 HTTP 请求重试，而不是按多步流重试。
- 通过仅重试当前步骤来保留顺序。
- 避免重复的非幂等操作。

## 默认值

- 尝试次数：3
- 最大延迟上限：30000 ms
- 抖动：0.1（10%）
- 提供商默认值：
  - Telegram 最短延迟：400 毫秒
  - Discord 最短延迟：500 毫秒

## 行为

### 模型提供商

- OpenClaw 让提供商 SDK 处理正常的短重试。
- 对于基于不锈钢的 SDK，例如 Anthropic 和 OpenAI，可重试响应
  （`408`、`409`、`429` 和 `5xx`）可以包括 `retry-after-ms` 或
  `retry-after`。当等待时间超过 60 秒时，OpenClaw 会注入
  `x-should-retry: false` 因此 SDK 立即显示错误并模型
  故障转移可以轮换到另一个认证配置文件或后备模型。
- 使用 `OPENCLAW_SDK_RETRY_MAX_WAIT_SECONDS=<seconds>` 覆盖上限。
  将其设置为 `0`、`false`、`off`、`none` 或 `disabled` 以使 SDK 能够长期遵守
  `Retry-After` 在内部休眠。

### Discord

- 仅重试速率限制错误 (HTTP 429)。
- 如果可用，则使用 Discord `retry_after`，否则采用指数退避。

### Telegram

- 重试暂时性错误（429、超时、连接/重置/关闭、暂时不可用）。
- 如果可用，则使用 `retry_after`，否则采用指数退避。
- Markdown 解析错误不会重试；他们退回到纯文本。

## 配置

在 `~/.openclaw/openclaw.json` 中设置每个提供商的重试策略：

```json5
{
  channels: {
    telegram: {
      retry: {
        attempts: 3,
        minDelayMs: 400,
        maxDelayMs: 30000,
        jitter: 0.1,
      },
    },
    discord: {
      retry: {
        attempts: 3,
        minDelayMs: 500,
        maxDelayMs: 30000,
        jitter: 0.1,
      },
    },
  },
}
```

## 注释

- 根据请求重试（消息发送、媒体上传、反应、投票、贴纸）。
- 复合流不会重试已完成的步骤。

## 相关

- [模型故障转移](/concepts/model-failover)
- [命令队列](/concepts/queue)
