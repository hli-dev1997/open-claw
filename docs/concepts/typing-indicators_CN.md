---
summary: "When OpenClaw shows typing indicators and how to tune them"
read_when:
  - Changing typing indicator behavior or defaults
title: "Typing indicators"
---

当跑步处于活动状态时，键入指示器会发送到聊天频道。使用
`agents.defaults.typingMode` 控制**何时**开始输入和 `typingIntervalSeconds`
控制它刷新的**频率**。

## 默认值

当 `agents.defaults.typingMode` **未设置**时， OpenClaw 保留旧行为：

- **直接聊天**：模型循环开始后立即开始输入。
- **带有提及的群聊**：立即开始输入。
- **无需提及的群聊**：仅当消息文本开始流式传输时才开始输入。
- **心跳运行**：如果心跳运行开始，则开始输入
  解析的心跳目标是一个可以打字的聊天，并且打字不会被禁用。

## 模式

将 `agents.defaults.typingMode` 设置为以下之一：

- `never` — 永远没有打字指示器。
- `instant` — 模型循环一开始**就开始输入，即使运行
  稍后仅返回静默回复token。
- `thinking` — 开始输入**第一个推理增量**（需要
  `reasoningLevel: "stream"` 用于运行）。
- `message` — 开始在**第一个非静默文本增量**上输入（忽略
  `NO_REPLY` 无声token）。

“多早触发”的顺序：
`never` → `message` → `thinking` → `instant`

## 配置

```json5
{
  agent: {
    typingMode: "thinking",
    typingIntervalSeconds: 6,
  },
}
```

你可以覆盖每个会话的模式或节奏：

```json5
{
  session: {
    typingMode: "message",
    typingIntervalSeconds: 4,
  },
}
```

## 注释

- `message` 模式在整个过程中不会显示仅静默回复的输入
  有效负载是确切的静默token（例如 `NO_REPLY` / `no_reply`，
  匹配时不区分大小写）。
- `thinking` 仅在运行流推理 (`reasoningLevel: "stream"`) 时触发。
  如果模型不发出推理增量，则不会开始输入。
- 心跳输入是已解析交付目标的活跃信号。它
  从 heartbeat run start 开始，而不是跟随 `message` 或 `thinking`
  流计时。设置 `typingMode: "never"` 将其禁用。
- 当目标不能时，心跳在 `target: "none"` 时不显示输入
  当心跳禁用聊天传送时，或者当
  频道不支持打字。
- `typingIntervalSeconds` 控制**刷新节奏**，而不是开始时间。
  默认值为 6 秒。

## 相关

- [存在](/concepts/presence)
- [流和分块](/concepts/streaming)
