---
summary: "Gateway web surfaces: Control UI, bind modes, and security"
read_when:
  - You want to access the Gateway over Tailscale
  - You want the browser Control UI and config editing
title: "Web"
---

Gateway 从与 Gateway WebSocket 相同的端口提供小型 **浏览器 Control UI** (Vite + Lit)：

- 默认值：`http://<host>:18789/`
- 与 `gateway.tls.enabled: true`: `https://<host>:18789/`
- 可选前缀：设置 `gateway.controlUi.basePath` (e.g.`/openclaw`)

功能位于 [Control UI](/web/control-ui) 中。本页的其余部分重点介绍绑定模式、安全性和面向 Web 的表面。

## 网络钩子

当 `hooks.enabled=true` 时，Gateway 还会在同一 HTTP 服务器上公开一个小型 Webhook 端点。
请参阅 [Gateway 配置](/gateway/configuration) → `hooks` 了解认证 + 有效负载。

## 配置（默认开启）

当资产存在 (`dist/control-ui`) 时，Control UI **默认启用**。
你可以通过配置来控制它：

```json5
{
  gateway: {
    controlUi: { enabled: true, basePath: "/openclaw" }, // basePath optional
  },
}
```

## Tailscale 访问

### 综合服务（推荐）

保持 Gateway 处于环回状态，并让 Tailscale 为其提供智能体：

```json5
{
  gateway: {
    bind: "loopback",
    tailscale: { mode: "serve" },
  },
}
```

然后启动网关：

```bash
openclaw gateway
```

打开：

- `https://<magicdns>/` （或你配置的 `gateway.controlUi.basePath`）

### Tailnet 绑定 + token

```json5
{
  gateway: {
    bind: "tailnet",
    controlUi: { enabled: true },
    auth: { mode: "token", token: "your-token" },
  },
}
```

然后启动网关（这个非环回示例使用共享秘密token
授权）：

```bash
openclaw gateway
```

打开：

- `http://<tailscale-ip>:18789/` （或你配置的 `gateway.controlUi.basePath`）

### 公共互联网（漏斗）

```json5
{
  gateway: {
    bind: "loopback",
    tailscale: { mode: "funnel" },
    auth: { mode: "password" }, // or OPENCLAW_GATEWAY_PASSWORD
  },
}
```

## 安全说明

- 默认情况下需要 Gateway 认证（token、密码、可信智能体或 Tailscale 在启用时提供身份标头）。
- 非环回绑定仍然**需要**网关认证。实际上，这意味着token/密码认证或具有 `gateway.auth.mode: "trusted-proxy"` 的身份识别反向智能体。
- 向导默认创建共享秘密认证，通常会生成一个
  网关token（即使在环回时）。
- 在共享秘密模式下，UI 发送 `connect.params.auth.token` 或
  `connect.params.auth.password`。
- 当 `gateway.tls.enabled: true` 时，本地仪表板和状态助手呈现
  `https://` 仪表板 URL 和 `wss://` WebSocket URL。
- 在身份承载模式（例如 Tailscale Serve 或 `trusted-proxy`）中，
  WebSocket 认证检查是通过请求标头满足的。
- 对于非环回 Control UI 部署，设置 `gateway.controlUi.allowedOrigins`
  明确地（完整的起源）。如果没有它，默认情况下会拒绝网关启动。
- `gateway.controlUi.dangerouslyAllowHostHeaderOriginFallback=true` 启用
  主机标头起源回退模式，但却是危险的安全降级。
- 使用 Serve，Tailscale 身份标头可以满足 Control UI/WebSocket 认证
  当 `gateway.auth.allowTailscale` 为 `true` 时（不需要token/密码）。
  HTTP API 端点不使用那些 Tailscale 身份标头；他们跟随
  改为网关的正常 HTTP 认证模式。套装
  `gateway.auth.allowTailscale: false` 需要显式凭据。参见
  [Tailscale](/gateway/tailscale) 和 [安全](/gateway/security)。这个
  无token流假设网关主机是可信的。
- `gateway.tailscale.mode: "funnel"` 需要 `gateway.auth.mode: "password"` （共享密码）。

## 构建 UI

Gateway 提供来自 `dist/control-ui` 的静态文件。构建它们：

```bash
pnpm ui:build
```
