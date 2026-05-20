---
summary: "TypeBox schemas as the single source of truth for the gateway protocol"
read_when:
  - Updating protocol schemas or codegen
title: "TypeBox"
---

# TypeBox 作为协议的真实来源

最后更新: 2026-01-10

TypeBox 是一个 TypeScript-first 模式库。我们用它来定义 **Gateway
WebSocket 协议**（握手、请求/响应、服务器事件）。那些模式
驱动 **运行时验证**、**JSON Schema 导出**和 **Swift 代码生成**
macOS 应用。真理的一个来源；其他一切都会生成。

如果你想要更高级别的协议上下文，请从
[Gateway 架构](/concepts/architecture)。

## 心智模型（30 秒）

每个 Gateway WS 消息都是以下三个帧之一：

- **请求**：`{ type: "req", id, method, params }`
- **响应**：`{ type: "res", id, ok, payload | error }`
- **事件**：`{ type: "event", event, payload, seq?, stateVersion? }`

第一帧**必须**是 `connect` 请求。之后，客户可以致电
方法 (e.g. `health`, `send`, `chat.send`) 并订阅事件 (e.g.
`presence`、`tick`、`agent`)。

连接流量（最小）：

```
Client                    Gateway
  |---- req:connect -------->|
  |<---- res:hello-ok --------|
  |<---- event:tick ----------|
  |---- req:health ---------->|
  |<---- res:health ----------|
```

常用方法+事件：

|类别 |示例 |笔记|
| ---------- | ---------------------------------------------------------------------- | ---------------------------------- |
|核心| `connect`、`health`、`status` | `connect` 必须是第一个 |
|消息 | `send`、`agent`、`agent.wait`、`system-event`、`logs.tail` |副作用需要 `idempotencyKey` |
|聊天 | `chat.history`、`chat.send`、`chat.abort` | WebChat 使用这些 |
|会议 | `sessions.list`、`sessions.patch`、`sessions.delete` |会话管理|
|自动化| `wake`、`cron.list`、`cron.run`、`cron.runs` |唤醒+cron控制|
|节点| `node.list`、`node.invoke`、`node.pair.*` | Gateway WS + 节点操作 |
|活动 | `tick`、`presence`、`agent`、`chat`、`health`、`shutdown` |服务器推送|

权威广告**发现**库存位于
`src/gateway/server-methods-list.ts`（`listGatewayMethods`、`GATEWAY_EVENTS`）。

## 模式所在的位置

- 来源：`src/gateway/protocol/schema.ts`
- 运行时验证器 (AJV)：`src/gateway/protocol/index.ts`
- 公布的功能/发现注册表：`src/gateway/server-methods-list.ts`
- 服务器握手+方法调度：`src/gateway/server.impl.ts`
- Node 客户端：`src/gateway/client.ts`
- 生成 JSON Schema：`dist/protocol.schema.json`
- 生成 Swift 模型：`apps/macos/Sources/OpenClawProtocol/GatewayModels.swift`

## 当前管道

- `pnpm protocol:gen`
  - 将 JSON Schema（草案 07）写入 `dist/protocol.schema.json`
- `pnpm protocol:gen:swift`
  - 生成 Swift 网关模型
- `pnpm protocol:check`
  - 运行两个生成器并验证输出是否已提交

## 运行时如何使用模式

- **服务器端**：每个入站帧均使用 AJV 进行验证。仅握手
  接受参数与 `ConnectParams` 匹配的 `connect` 请求。
- **客户端**：JS 客户端在之前验证事件和响应帧
  使用它们。
- **功能发现**：Gateway 发送保守的 `features.methods`
  和 `features.events` 列表在 `hello-ok` 中，来自 `listGatewayMethods()` 和
  `GATEWAY_EVENTS`。
- 该发现列表不是每个可调用帮助程序的生成转储
  `coreGatewayHandlers`;一些辅助 RPC 的实现是
  `src/gateway/server-methods/*.ts` 未在广告中列举
  功能列表。

## 示例框架

连接（第一条消息）：

```json
{
  "type": "req",
  "id": "c1",
  "method": "connect",
  "params": {
    "minProtocol": 3,
    "maxProtocol": 3,
    "client": {
      "id": "openclaw-macos",
      "displayName": "macos",
      "version": "1.0.0",
      "platform": "macos 15.1",
      "mode": "ui",
      "instanceId": "A1B2"
    }
  }
}
```

你好-好的回复：

```json
{
  "type": "res",
  "id": "c1",
  "ok": true,
  "payload": {
    "type": "hello-ok",
    "protocol": 3,
    "server": { "version": "dev", "connId": "ws-1" },
    "features": { "methods": ["health"], "events": ["tick"] },
    "snapshot": {
      "presence": [],
      "health": {},
      "stateVersion": { "presence": 0, "health": 0 },
      "uptimeMs": 0
    },
    "policy": { "maxPayload": 1048576, "maxBufferedBytes": 1048576, "tickIntervalMs": 30000 }
  }
}
```

请求+响应：

```json
{ "type": "req", "id": "r1", "method": "health" }
```

```json
{ "type": "res", "id": "r1", "ok": true, "payload": { "ok": true } }
```

事件：

```json
{ "type": "event", "event": "tick", "payload": { "ts": 1730000000 }, "seq": 12 }
```

## 最小客户端 (Node.js)

最小有用流量：连接+健康。

```ts
import { WebSocket } from "ws";

const ws = new WebSocket("ws://127.0.0.1:18789");

ws.on("open", () => {
  ws.send(
    JSON.stringify({
      type: "req",
      id: "c1",
      method: "connect",
      params: {
        minProtocol: 3,
        maxProtocol: 3,
        client: {
          id: "cli",
          displayName: "example",
          version: "dev",
          platform: "node",
          mode: "cli",
        },
      },
    }),
  );
});

ws.on("message", (data) => {
  const msg = JSON.parse(String(data));
  if (msg.type === "res" && msg.id === "c1" && msg.ok) {
    ws.send(JSON.stringify({ type: "req", id: "h1", method: "health" }));
  }
  if (msg.type === "res" && msg.id === "h1") {
    console.log("health:", msg.payload);
    ws.close();
  }
});
```

## 工作示例：添加一个端到端的方法

示例：添加一个返回 `{ ok: true, text }` 的新 `system.echo` 请求。

1. **架构（事实来源）**

添加到`src/gateway/protocol/schema.ts`：

```ts
export const SystemEchoParamsSchema = Type.Object(
  { text: NonEmptyString },
  { additionalProperties: false },
);

export const SystemEchoResultSchema = Type.Object(
  { ok: Type.Boolean(), text: NonEmptyString },
  { additionalProperties: false },
);
```

将两者添加到 `ProtocolSchemas` 并导出类型：

```ts
  SystemEchoParams: SystemEchoParamsSchema,
  SystemEchoResult: SystemEchoResultSchema,
```

```ts
export type SystemEchoParams = Static<typeof SystemEchoParamsSchema>;
export type SystemEchoResult = Static<typeof SystemEchoResultSchema>;
```

2. **验证**

在 `src/gateway/protocol/index.ts` 中，导出 AJV 验证器：

```ts
export const validateSystemEchoParams = ajv.compile<SystemEchoParams>(SystemEchoParamsSchema);
```

3. **服务器行为**

在 `src/gateway/server-methods/system.ts` 中添加处理程序：

```ts
export const systemHandlers: GatewayRequestHandlers = {
  "system.echo": ({ params, respond }) => {
    const text = String(params.text ?? "");
    respond(true, { ok: true, text });
  },
};
```

将其注册到 `src/gateway/server-methods.ts` （已合并 `systemHandlers`），
然后将 `"system.echo"` 添加到 `listGatewayMethods` 输入中
`src/gateway/server-methods-list.ts`。

如果该方法可由操作员或节点客户端调用，也将其分类为
`src/gateway/method-scopes.ts` 所以范围强制和 `hello-ok` 功能
广告保持一致。

4. **再生**

```bash
pnpm protocol:check
```

5. **测试+文档**

在 `src/gateway/server.*.test.ts` 中添加服务器测试并记下文档中的方法。

## Swift 代码生成行为

Swift 生成器发出：

- `GatewayFrame` 枚举，包含 `req`、`res`、`event` 和 `unknown` 情况
- 强类型有效负载结构/枚举
- `ErrorCode` 值和 `GATEWAY_PROTOCOL_VERSION`

未知的帧类型被保留为原始有效负载以实现前向兼容性。

## 版本控制+兼容性

- `PROTOCOL_VERSION` 住在 `src/gateway/protocol/schema.ts`。
- 客户端发送`minProtocol` + `maxProtocol`；服务器拒绝不匹配。
- Swift 模型保留未知的帧类型，以避免破坏旧客户端。

## 模式模式和约定

- 大多数对象使用 `additionalProperties: false` 来实现严格的有效负载。
- `NonEmptyString` 是 ID 和方法/事件名称的默认值。
- 顶级 `GatewayFrame` 在 `type` 上使用 **鉴别器**。
- 有副作用的方法通常需要在参数中添加 `idempotencyKey`
  （例如：`send`、`poll`、`agent`、`chat.send`）。
- `agent` 接受可选的 `internalEvents` 用于运行时生成的编排上下文
  （例如子智能体/cron 任务完成切换）；将此视为内部 API 表面。

## 实时模式 JSON

生成的 JSON Schema 位于 `dist/protocol.schema.json` 的存储库中。的
发布的原始文件通常可在以下位置获得：

- [https://raw.githubusercontent.com/openclaw/openclaw/main/dist/protocol.schema.json](https://raw.githubusercontent.com/openclaw/openclaw/main/dist/protocol.schema.json)

## 当你改变模式时

1. 更新 TypeBox 架构。
2. 在`src/gateway/server-methods-list.ts`中注册方法/事件。
3. 当新的 RPC 需要运算符或时更新 `src/gateway/method-scopes.ts`
   节点范围分类。
4. 运行`pnpm protocol:check`。
5. 提交重新生成的架构 + Swift 模型。

## 相关

- [丰富的输出协议](/reference/rich-output-protocol)
- [RPC 适配器](/reference/rpc)
