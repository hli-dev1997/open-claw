---
summary: "Gateway dashboard (Control UI) access and auth"
read_when:
  - Changing dashboard authentication or exposure modes
title: "Dashboard"
---

Gateway 仪表板是默认在 `/` 上服务的浏览器 Control UI
(override with `gateway.controlUi.basePath`).

Quick open (local Gateway):

- [http://127.0.0.1:18789/](http://127.0.0.1:18789/)（或 [http://localhost:18789/](http://localhost:18789/)）
- 对于 `gateway.tls.enabled: true`，使用 `https://127.0.0.1:18789/` 并
  `wss://127.0.0.1:18789` 用于 WebSocket 端点。

主要参考资料：

- [Control UI](/web/control-ui) 了解用法和 UI 功能。
- [Tailscale](/gateway/tailscale) 用于服务/漏斗自动化。
- [Web 表面](/web) 用于绑定模式和安全说明。

通过配置的网关在 WebSocket 握手时强制执行认证
授权路径：

- `connect.params.auth.token`
- `connect.params.auth.password`
- Tailscale 在 `gateway.auth.allowTailscale: true` 时提供身份标头
- `gateway.auth.mode: "trusted-proxy"` 时的可信智能体身份标头

请参阅 [Gateway 配置](/gateway/configuration) 中的 `gateway.auth`。

安全说明：Control UI 是一个 **管理界面**（聊天、配置、执行批准）。
不要公开暴露它。 UI 将仪表板 URL token保留在 sessionStorage 中
对于当前浏览器选项卡会话和选定的网关 URL，并在加载后将它们从 URL 中剥离。
首选本地主机、Tailscale 服务或 SSH 隧道。

## 快速路径（推荐）

- 登录后，CLI 自动打开仪表板并打印干净的（非标记化）链接。
- 随时重新打开：`openclaw dashboard`（复制链接，如果可能，打开浏览器，如果 headless，则显示 SSH 提示）。
- 如果 UI 提示进行共享秘密认证，请粘贴配置的token或
  密码进入 Control UI 设置。

## 认证基础知识（本地与远程）

- **本地主机**：打开 `http://127.0.0.1:18789/`。
- **Gateway TLS**：当 `gateway.tls.enabled: true` 时，仪表板/状态链接使用
  `https://` 和 Control UI WebSocket 链接使用 `wss://`。
- **共享秘密token源**：`gateway.auth.token`（或
  `OPENCLAW_GATEWAY_TOKEN`); `openclaw dashboard` 可以通过 URL 片段传递它
  对于一次性引导，Control UI 将其保存在 sessionStorage 中
  当前浏览器选项卡会话并选择网关 URL 而不是 localStorage。
- 如果 `gateway.auth.token` 是 SecretRef 管理的，则 `openclaw dashboard`
  按设计打印/复制/打开非标记化的 URL 。这样可以避免暴露
  shell 日志、剪贴板历史记录或浏览器启动中的外部管理token
  论据。
- 如果 `gateway.auth.token` 配置为 SecretRef 并且在你的
  当前 shell，`openclaw dashboard` 仍然打印非标记化的 URL plus
  可操作的认证设置指南。
- **共享秘密密码**：使用配置的 `gateway.auth.password` （或
  `OPENCLAW_GATEWAY_PASSWORD`)。仪表板不会跨区域保存密码
  重新加载。
- **身份承载模式**：Tailscale服务可以满足Control UI/WebSocket
  当 `gateway.auth.allowTailscale: true` 时通过身份标头进行认证，并且
  非环回身份感知反向智能体可以满足
  `gateway.auth.mode: "trusted-proxy"`。在这些模式下，仪表板不会
  需要 WebSocket 的粘贴共享密钥。
- **不是本地主机**：使用 Tailscale Serve，一个非环回共享秘密绑定，一个
  非环回身份识别反向智能体
  `gateway.auth.mode: "trusted-proxy"` 或 SSH 隧道。 HTTP API 仍在使用
  共享秘密认证，除非你故意运行 private-ingress
  `gateway.auth.mode: "none"` 或可信智能体 HTTP auth。参见
  [网络表面](/web)。

<a id="if-you-see-unauthorized-1008"></a>

## 如果你看到“未经授权”/1008

- 确保网关可访问（本地：`openclaw status`；远程：SSH 隧道 `ssh -N -L 18789:127.0.0.1:18789 user@host`，然后打开 `http://127.0.0.1:18789/`）。
- 对于 `AUTH_TOKEN_MISMATCH`，当网关返回重试提示时，客户端可以使用缓存的设备token执行一次可信重试。缓存token重试重用token的缓存批准范围；显式 `deviceToken` / 显式 `scopes` 调用者保留其请求的范围集。如果重试后认证仍然失败，请手动解决token漂移问题。
- 在该重试路径之外，连接认证优先级首先是显式共享token/密码，然后是显式 `deviceToken`，然后是存储的设备token，然后是引导token。
- 在异步 Tailscale 服务 Control UI 路径上，相同的尝试失败
  `{scope, ip}` 在失败的认证限制器记录它们之前被序列化，因此
  第二次并发错误重试已经可以显示 `retry later`。
- 对于token漂移修复步骤，请遵循[token漂移恢复清单](/cli/devices#token-drift-recovery-checklist)。
- 从网关主机检索或提供共享密钥：
  - token：`openclaw config get gateway.auth.token`
  - 密码：解析配置的`gateway.auth.password`或
    `OPENCLAW_GATEWAY_PASSWORD`
  - SecretRef 管理的token：解析外部秘密提供商或导出
    `OPENCLAW_GATEWAY_TOKEN` 在此 shell 中，然后重新运行 `openclaw dashboard`
  - 未配置共享密钥：`openclaw doctor --generate-gateway-token`
- 在仪表板设置中，将token或密码粘贴到认证字段中，
  然后连接。
- UI 语言选择器位于**概述 -> Gateway 访问 -> 语言**。
  它是门禁卡的一部分，而不是外观部分。

## 相关

- [Control UI](/web/control-ui)
- [WebChat](/web/webchat)
