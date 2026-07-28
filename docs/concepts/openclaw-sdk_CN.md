---
summary: "Public OpenClaw App SDK for external apps, scripts, dashboards, CI jobs, and IDE extensions"
title: "OpenClaw App SDK"
sidebarTitle: "App SDK"
read_when:
  - You are building an external app, script, dashboard, CI job, or IDE extension that talks to OpenClaw
  - You are choosing between the App SDK and the Plugin SDK
  - You are integrating with Gateway agent runs, sessions, events, approvals, models, or tools
---

**OpenClaw 应用 SDK** 是公共客户端 API，适用于外部应用
OpenClaw 进程。当脚本、仪表板、CI 作业、IDE 时使用 `@openclaw/sdk`
扩展程序或其他外部应用想要连接到 Gateway，启动智能体
运行、流式传输事件、等待结果、取消工作或检查 Gateway
资源。

<Note>
  应用 SDK 与 [Plugin SDK](/plugins/sdk-overview) 不同。
  `@openclaw/sdk` 从 OpenClaw 外部与 Gateway 进行对话。
  `openclaw/plugin-sdk/*` 仅适用于在 OpenClaw 内部运行的插件，并且
  注册提供商、通道、工具、挂钩或可信运行时。
</Note>

## 今天发货的商品

`@openclaw/sdk` 附带：

| 表面                      | 状态             | 它有什么作用                                              |
| ------------------------- | ---------------- | --------------------------------------------------------- |
| `OpenClaw`                | `OpenClaw`准备好 | 主要客户端入口点。拥有传输、连接、请求和事件。            |
| `GatewayClientTransport`  | 准备好           | WebSocket 传输由 Gateway 客户端支持。                     |
| `oc.agents`               | 准备好           | 列出、创建、更新、删除和获取智能体句柄。                  |
| `Agent.run()`             | 准备好           | 启动 Gateway `agent` 运行并返回 `Run`。                   |
| `oc.runs`                 | 准备好           | 创建、获取、等待、取消和流运行。                          |
| `Run.events()`            | 准备好           | 流式传输规范化的每次运行事件并重播以实现快速运行。        |
| `Run.wait()`              | 准备好           | 调用 `agent.wait` 并返回稳定的 `RunResult`。              |
| `Run.cancel()`            | 准备好           | 通过运行 ID 调用 `sessions.abort`，并使用可用的会话密钥。 |
| `oc.sessions`             | 准备好           | 创建、解析、发送、修补、压缩和获取会话句柄。              |
| `Session.send()`          | 准备好           | 调用 `sessions.send` 并返回 `Run`。                       |
| `oc.models`               | 准备好           | 调用 `models.list` 和当前 `models.authStatus` 状态 RPC。  |
| `oc.tools`                | 准备好           | 通过策略管道列出、范围和调用 Gateway 工具。               |
| `oc.artifacts`            | 准备好           | 列出、获取和下载 Gateway 转录工件。                       |
| `oc.approvals`            | 准备好           | 通过 Gateway 批准 RPC 列出并解析执行批准。                |
| `oc.rawEvents()`          | 准备好           | 为高级消费者公开原始 Gateway 事件。                       |
| `normalizeGatewayEvent()` | 准备好           | 将原始 Gateway 事件转换为稳定的 SDK 事件形状。            |

SDK 还导出这些表面使用的核心类型：
`AgentRunParams`、`RunResult`、`RunStatus`、`OpenClawEvent`、
`OpenClawEventType`、`GatewayEvent`、`OpenClawTransport`、
`GatewayRequestOptions`、`SessionCreateParams`、`SessionSendParams`、
`ArtifactSummary`、`ArtifactQuery`、`ArtifactsListResult`、
`ArtifactsGetResult`、`ArtifactsDownloadResult`、`RuntimeSelection`、
`EnvironmentSelection`、`WorkspaceSelection`、`ApprovalMode` 及相关
结果类型。

## 连接到 Gateway

使用显式 Gateway URL 创建客户端，或注入自定义传输
测试和嵌入式应用运行时。

```typescript
import { OpenClaw } from "@openclaw/sdk";

const oc = new OpenClaw({
  url: "ws://127.0.0.1:14565",
  token: process.env.OPENCLAW_GATEWAY_TOKEN,
  requestTimeoutMs: 30_000,
});

await oc.connect();
```

`new OpenClaw({ gateway: "ws://..." })` 相当于 `url`。的
`gateway: "auto"` 选项被构造函数接受，但自动 Gateway
发现还不是一个单独的 SDK 功能；当应用不传递 `url` 时
已经知道如何发现 Gateway。

对于测试，传递一个实现 `OpenClawTransport` 的对象：

```typescript
const oc = new OpenClaw({
  transport: {
    async request(method, params) {
      return { method, params };
    },
    async *events() {},
  },
});
```

## 运行智能体

当应用需要智能体句柄时使用 `oc.agents.get(id)`，然后调用
`agent.run()`。

```typescript
const agent = await oc.agents.get("main");

const run = await agent.run({
  input: "Review this pull request and suggest the smallest safe fix.",
  model: "openai/gpt-5.5",
  sessionKey: "main",
  timeoutMs: 30_000,
});

for await (const event of run.events()) {
  const data = event.data as { delta?: unknown };
  if (event.type === "assistant.delta" && typeof data.delta === "string") {
    process.stdout.write(data.delta);
  }
}

const result = await run.wait({ timeoutMs: 120_000 });
console.log(result.status);
```

提供商限定的模型引用（例如 `openai/gpt-5.5`）被拆分为 Gateway
`provider` 和 `model` 覆盖。 `timeoutMs` 在 SDK 中停留毫秒并且
转换为 Gateway 超时秒数为 `agent` RPC。

`run.wait()` 使用 Gateway `agent.wait` RPC。等待期限已到期
当运行仍处于活动状态时返回 `status: "accepted"` 而不是假装
运行本身超时。运行时超时、中止运行和取消运行
标准化为 `timed_out` 或 `cancelled`。

## 创建和重用会话

当应用需要持久的转录状态时使用会话。

```typescript
const session = await oc.sessions.create({
  agentId: "main",
  label: "release-review",
});

const run = await session.send("Prepare release notes from the current diff.");
await run.wait();
```

`Session.send()` 调用 `sessions.send` 并返回 `Run`。会话句柄也
支持：

```typescript
await session.abort(run.id);
await session.patch({ label: "renamed-session" });
await session.compact({ maxLines: 200 });
```

## 直播活动

SDK 将原始 Gateway 事件标准化为稳定的 `OpenClawEvent` 包络：

```typescript
type OpenClawEvent = {
  version: 1;
  id: string;
  ts: number;
  type: OpenClawEventType;
  runId?: string;
  sessionId?: string;
  sessionKey?: string;
  taskId?: string;
  agentId?: string;
  data: unknown;
  raw?: GatewayEvent;
};
```

常见的事件类型包括：

| 活动类型              | 来源 Gateway 事件                  |
| --------------------- | ---------------------------------- |
| `run.started`         | `run.started` `agent` 生命周期开始 |
| `run.completed`       | `agent` 生命周期结束               |
| `run.failed`          | `agent` 生命周期错误               |
| `run.cancelled`       | 中止/取消生命周期结束              |
| `run.timed_out`       | 超时生命周期结束                   |
| `assistant.delta`     | 助理流媒体Delta                    |
| `assistant.message`   | 助理留言                           |
| `thinking.delta`      | 思考或计划流                       |
| `tool.call.started`   | 工具/项目/命令启动                 |
| `tool.call.delta`     | 工具/项目/命令更新                 |
| `tool.call.completed` | 工具/项目/命令完成                 |
| `tool.call.failed`    | 工具/项目/命令失败或阻止状态       |
| `approval.requested`  | 执行或插件批准请求                 |
| `approval.resolved`   | Exec或插件批准决议                 |
| `session.created`     | `sessions.changed` 创建            |
| `session.updated`     | `sessions.changed` 更新            |
| `session.compacted`   | `sessions.changed` 压缩            |
| `task.updated`        | 任务更新事件                       |
| `artifact.updated`    | 补丁流事件                         |
| `raw`                 | 尚未有稳定 SDK 映射的任何事件      |

`Run.events()` 将事件过滤到一个运行 ID 并重播已见过的事件
快速奔跑。这意味着记录的流程是安全的：

```typescript
const run = await agent.run("Summarize the latest session.");

for await (const event of run.events()) {
  if (event.type === "run.completed") {
    break;
  }
}
```

对于应用范围的流，请使用 `oc.events()`。对于原始 Gateway 帧，请使用
`oc.rawEvents()`。

## 模型、工具、工件和批准

模型助手映射到当前的 Gateway 方法：

```typescript
await oc.models.list();
await oc.models.status({ probe: false }); // calls models.authStatus
```

工具助手公开 Gateway 目录、有效的工具视图和直接
Gateway 工具调用。 `oc.tools.invoke()` 返回一个键入的信封
投掷政策或拒绝批准。

```typescript
await oc.tools.list();
await oc.tools.effective({ sessionKey: "main" });
await oc.tools.invoke("tool-name", {
  args: { input: "value" },
  sessionKey: "main",
  confirm: false,
  idempotencyKey: "tool-call-1",
});
```

工件助手公开会话、运行或的 Gateway 工件投影
任务上下文。每个调用都需要一个显式 `sessionKey`、`runId` 或
`taskId` 范围：

```typescript
const { artifacts } = await oc.artifacts.list({ sessionKey: "main" });
const first = artifacts[0];

if (first) {
  const { artifact } = await oc.artifacts.get(first.id, { sessionKey: "main" });
  const download = await oc.artifacts.download(artifact.id, { sessionKey: "main" });
  console.log(download.encoding, download.url);
}
```

批准助手使用 exec 批准 RPC：

```typescript
const approvals = await oc.approvals.list();
await oc.approvals.respond("approval-id", { decision: "approve" });
```

## 今天明确不受支持

SDK 包含我们想要的产品模型的名称，但它不会默默地
假装 Gateway RPC 存在。这些调用当前抛出显式不支持的错误
错误：

```typescript
await oc.tasks.list();
await oc.tasks.get("task-id");
await oc.tasks.cancel("task-id");

await oc.environments.list();
await oc.environments.create({});
await oc.environments.status("environment-id");
await oc.environments.delete("environment-id");
```

每次运行时键入 `workspace`、`runtime`、`environment` 和 `approvals` 字段
作为未来的形状，但当前的 Gateway 不支持这些覆盖
`agent` RPC。如果调用者传递它们，则 SDK 在提交运行之前抛出
因此工作不会意外地使用默认工作区、运行时执行，
环境或认可行为。

## 应用 SDK 与 Plugin SDK

当代码位于 OpenClaw 之外时，使用应用 SDK：

- Node 启动或观察智能体运行的脚本
- 调用 Gateway 的 CI 作业
- 仪表板和管理面板
- IDE 扩展
- 不需要成为通道插件的外部桥
- 与假或真 Gateway 传输的集成测试

当代码在 OpenClaw 内部运行时，使用 Plugin SDK：

- 提供商插件
- 频道插件
- 工具或生命周期挂钩
- 智能体线束插件
- 值得信赖的运行时助手

应用 SDK 代码应从 `@openclaw/sdk` 导入。 Plugin 代码应从以下位置导入
记录了 `openclaw/plugin-sdk/*` 子路径。不要混淆这两个合同。

## 相关文档

- [OpenClaw 应用 SDK API 设计](/reference/openclaw-sdk-api-design)
- [Gateway RPC 参考](/reference/rpc)
- [智能体循环](/concepts/agent-loop)
- [智能体运行时间](/concepts/agent-runtimes)
- [会话](/concepts/session)
- [后台任务](/automation/tasks)
- [ACP 特工](/tools/acp-agents)
- [Plugin SDK 概述](/plugins/sdk-overview)
