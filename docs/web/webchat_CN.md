---
summary: "Loopback WebChat static host and Gateway WS usage for chat UI"
read_when:
  - Debugging or configuring WebChat access
title: "WebChat"
---

状态：macOS/iOS SwiftUI 聊天 UI 直接与 Gateway WebSocket 对话。

## 它是什么

- 用于网关的本机聊天UI（无嵌入式浏览器，无本地静态服务器）。
- 使用与其他通道相同的会话和路由规则。
- 确定性路由：回复始终返回至 WebChat。

## 快速开始

1. 启动网关。
2. 打开 WebChat UI (macOS/iOS 应用) 或 Control UI 聊天选项卡。
3. 确保配置了有效的网关认证路径（默认为共享秘密，
   即使在环回上）。

## 它是如何工作的（行为）

- UI 连接到 Gateway WebSocket 并使用 `chat.history`、`chat.send` 和 `chat.inject`。
- `chat.history` 的稳定性受到限制：Gateway 可能会截断长文本字段，省略大量元数据，并用 `[chat.history omitted: message too large]` 替换过大的条目。
- `chat.history` 遵循现代仅附加会话文件的活动转录分支，因此放弃的重写分支和取代的提示副本不会在 WebChat 中呈现。
- Control UI 在生成新的 `chat.send` 运行 ID 之前合并同一会话、消息和附件的重复的正在进行的提交； Gateway 仍然会删除重复使用相同幂等性密钥的重复请求。
- `chat.history` 也是显示标准化的：仅运行时 OpenClaw 上下文，
  入站信封包装器、内联传递指令标签
  例如 `[[reply_to_*]]` 和 `[[audio_as_voice]]`，纯文本工具调用 XML
  有效负载（包括 `<tool_call>...</tool_call>`，
  `<function_call>...</function_call>`、`<tool_calls>...</tool_calls>`、
  `<function_calls>...</function_calls>` 和截断的工具调用块），以及
  泄露的 ASCII/全角模型控制标记已从可见文本中剥离，
  和辅助条目，其整个可见文本只是精确的无声文本
  token `NO_REPLY` / `no_reply` 被省略。
- 带有推理标记的回复有效负载 (`isReasoning: true`) 被排除在 WebChat 辅助内容、转录重播文本和音频内容块之外，因此仅思考有效负载不会以可见辅助消息或可播放音频的形式出现。
- `chat.inject` 将助理注释直接附加到记录中并将其广播到 UI （无智能体运行）。
- 中止的运行可以使部分助手输出在 UI 中保持可见。
- 当缓冲输出存在时，Gateway 将中止的部分助理文本保留到转录历史记录中，并用中止元数据标记这些条目。
- 历史记录始终从网关获取（无本地文件监视）。
- 如果网关无法访问，则 WebChat 为只读。

## Control UI 智能体工具面板

- The Control UI `/agents` Tools panel has two separate views:
  - **Available Right Now** uses `tools.effective(sessionKey=...)` and shows what the current
    session can actually use at runtime, including core, plugin, and channel-owned tools.
  - **Tool Configuration** uses `tools.catalog` and stays focused on profiles, overrides, and
    目录语义。
- 运行时可用性是会话范围内的。 Switching sessions on the same agent can change the
  **立即可用**列表。
- The config editor does not imply runtime availability;有效准入仍遵循政策
  precedence (`allow`/`deny`, per-agent and provider/channel overrides).

## 远程使用

- Remote mode tunnels the gateway WebSocket over SSH/Tailscale.
- You do not need to run a separate WebChat server.

## 配置参考(WebChat)

Full configuration: [Configuration](/gateway/configuration)

WebChat 选项：

- `gateway.webchat.chatHistoryMaxChars`: maximum character count for text fields in `chat.history` responses. When a transcript entry exceeds this limit, Gateway truncates long text fields and may replace oversized messages with a placeholder. Per-request `maxChars` can also be sent by the client to override this default for a single `chat.history` call.

相关全局选项：

- `gateway.port`、`gateway.bind`：WebSocket 主机/端口。
- `gateway.auth.mode`、`gateway.auth.token`、`gateway.auth.password`：
  共享秘密 WebSocket auth。
- `gateway.auth.allowTailscale`：浏览器Control UI聊天选项卡可以使用Tailscale
  启用后提供身份标头。
- `gateway.auth.mode: "trusted-proxy"`：在身份识别**非环回**智能体源后面的浏览器客户端的反向智能体认证（请参阅[受信任的智能体认证](/gateway/trusted-proxy-auth)）。
- `gateway.remote.url`、`gateway.remote.token`、`gateway.remote.password`：远程网关目标。
- `session.*`：会话存储和主密钥默认值。

## 相关

- [Control UI](/web/control-ui)
- [仪表板](/web/dashboard)
