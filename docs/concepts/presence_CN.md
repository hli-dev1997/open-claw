---
summary: "How OpenClaw presence entries are produced, merged, and displayed"
read_when:
  - Debugging the Instances tab
  - Investigating duplicate or stale instance rows
  - Changing gateway WS connect or system-event beacons
title: "Presence"
---

OpenClaw“存在”是一个轻量级的、尽力而为的视图：

- **Gateway** 本身，以及
- **连接到 Gateway** 的客户端（mac 应用、WebChat、CLI 等）

Presence 主要用于呈现 macOS 应用的 **Instances** 选项卡以及
提供快速的操作员可见性。

## 存在字段（显示的内容）

存在条目是具有以下字段的结构化对象：

- `instanceId`（可选但强烈推荐）：稳定的客户端身份（通常为`connect.client.instanceId`）
- `host`：人类友好的主机名
- `ip`：尽力而为的 IP 地址
- `version`：客户端版本字符串
- `deviceFamily` / `modelIdentifier`：硬件提示
- `mode`：`ui`、`webchat`、`cli`、`backend`、`probe`、`test`、 `node`，...
- `lastInputSeconds`：“自上次用户输入以来的秒数”（如果已知）
- `reason`：`self`、`connect`、`node-connected`、`periodic`、...
- `ts`：上次更新时间戳（自纪元以来的毫秒数）

## 制作人（存在感的来源）

状态条目由多个来源生成并**合并**。

### 1) Gateway 自输入

Gateway 始终在启动时播种一个“self”条目，以便 UI 显示网关主机
甚至在任何客户端连接之前。

### 2) WebSocket 连接

每个 WS 客户端都以 `connect` 请求开始。握手成功后
Gateway 更新插入该连接的存在条目。

#### 为什么一次性 CLI 命令不显示

CLI 通常会连接以执行简短的一次性命令。为了避免发送垃圾邮件
实例列表 `client.mode === "cli"` **未** 转换为存在条目。

### 3) `system-event` 信标

客户端可以通过 `system-event` 方法发送更丰富的周期性信标。麦克
应用使用它来报告主机名、IP 和 `lastInputSeconds`。

### 4) Node 连接（角色：节点）

当节点通过 Gateway WebSocket 与 `role: node` 连接时，Gateway
更新插入该节点的存在条目（与其他 WS 客户端的流程相同）。

## 合并 + 重复数据删除规则（为什么 `instanceId` 很重要）

存在条目存储在单个内存映射中：

- 条目由 **存在密钥** 键入。
- 最好的密钥是一个稳定的 `instanceId` （来自 `connect.client.instanceId`），可以在重新启动后继续存在。
- 按键不区分大小写。

如果客户端在没有稳定的 `instanceId` 的情况下重新连接，它可能会显示为
**重复**行。

## TTL 和有限大小

存在是故意短暂的：

- **TTL:** 超过 5 分钟的条目将被修剪
- **最大条目数：** 200（最旧的先删除）

这使列表保持新鲜并避免无限制的内存增长。

## 远程/隧道警告（环回 IP）

当客户端通过 SSH 隧道/本地端口转发连接时，Gateway 可能会
将远程地址视为 `127.0.0.1`。避免覆盖良好的客户报告
IP、环回远程地址将被忽略。

## 消费者

### macOS 实例选项卡

macOS 应用呈现 `system-presence` 的输出并应用一个小状态
基于上次更新时间的指示器（活动/空闲/过时）。

## 调试技巧

- 要查看原始列表，请针对 Gateway 调用 `system-presence`。
- 如果你看到重复项：
  - 确认客户端在握手中发送稳定的 `client.instanceId`
  - 确认周期性信标使用相同的`instanceId`
  - 检查连接派生条目是否缺少 `instanceId`（预计会出现重复）

## 相关

- [打字指示器](/concepts/typing-indicators)
- [流和分块](/concepts/streaming)
