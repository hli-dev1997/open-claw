---
summary: "Terminal UI (TUI): connect to the Gateway or run locally in embedded mode"
read_when:
  - You want a beginner-friendly walkthrough of the TUI
  - You need the complete list of TUI features, commands, and shortcuts
title: "TUI"
---

## 快速开始

### Gateway 模式

1. 启动Gateway。

```bash
openclaw gateway
```

2. 打开TUI。

```bash
openclaw tui
```

3. 输入消息并按 Enter。

远程Gateway：

```bash
openclaw tui --url ws://<host>:<port> --token <gateway-token>
```

如果你的 Gateway 使用密码认证，请使用 `--password`。

### 本地模式

在没有 Gateway 的情况下运行 TUI：

```bash
openclaw chat
# or
openclaw tui --local
```

注意事项：

- `openclaw chat` 和 `openclaw terminal` 是 `openclaw tui --local` 的别名。
- `--local` 不能与 `--url`、`--token` 或 `--password` 组合使用。
- 本地模式直接使用嵌入式智能体运行时。大多数本地工具都可以工作，但仅限 Gateway 的功能不可用。
- `openclaw` 和 `openclaw crestodian` 也使用此 TUI shell，并使用 Crestodian 作为本地设置和修复聊天后端。

## 你所看到的

- 标头：连接 URL、当前智能体、当前会话。
- 聊天记录：用户消息、助手回复、系统通知、工具卡。
- 状态行：连接/运行状态（连接、运行、流式传输、空闲、错误）。
- 页脚：连接状态+智能体+会话+模型+思考/快速/详细/跟踪/推理+token计数+交付。
- 输入：具有自动完成功能的文本编辑器。

## 心理模型：智能体+会话

- 智能体是独特的段头（e.g。`main`、`research`）。 Gateway 公开该列表。
- 会话属于当前智能体。
- 会话密钥存储为 `agent:<agentId>:<sessionKey>`。
  - 如果你键入 `/session main`，则 TUI 将其扩展为 `agent:<currentAgent>:main`。
  - 如果你键入 `/session agent:other:main`，则会显式切换到该智能体会话。
- 会议范围：
  - `per-sender`（默认）：每个智能体有多个会话。
  - `global`：TUI 始终使用 `global` 会话（选择器可能为空）。
- 当前智能体+会话始终在页脚中可见。

## 发送+交付

- 消息发送到Gateway；默认情况下关闭向提供商的交付。
- 打开交付：
  - `/deliver on`
  - 或设置面板
  - 或以 `openclaw tui --deliver` 开头

## 选择器 + 覆盖

- 模型选择器：列出可用模型并设置会话覆盖。
- 智能体选择器：选择不同的智能体。
- 会话选择器：仅显示当前智能体的会话。
- 设置：切换交付、工具输出扩展和思维可见性。

## 键盘快捷键

- 输入：发送消息
- Esc：中止活动运行
- Ctrl+C：清除输入（按两次退出）
- Ctrl+D：退出
- Ctrl+L：模型选择器
- Ctrl+G：智能体选择器
- Ctrl+P：会话选择器
- Ctrl+O：切换工具输出扩展
- Ctrl+T：切换思维可见性（重新加载历史记录）

## 斜线命令

核心：

- `/help`
- `/status`
- `/agent <id>`（或 `/agents`）
- `/session <key>`（或 `/sessions`）
- `/model <provider/model>` （或 `/models`）

会话控制：

- `/think <off|minimal|low|medium|high>`
- `/fast <status|on|off>`
- `/verbose <on|full|off>`
- `/trace <on|off>`
- `/reasoning <on|off|stream>`
- `/usage <off|tokens|full>`
- `/elevated <on|off|ask|full>`（别名：`/elev`）
- `/activation <mention|always>`
- `/deliver <on|off>`

会话生命周期：

- `/new` 或 `/reset` （重置会话）
- `/abort`（中止活动运行）
- `/settings`
- `/exit`

仅本地模式：

- `/auth [provider]` 在 TUI 中打开提供商认证/登录流程。

其他 Gateway 斜杠命令（例如 `/context`）将转发到 Gateway 并显示为系统输出。请参阅[斜杠命令](/tools/slash-commands)。

## 本地 shell 命令

- 在行前添加 `!` 前缀，以在 TUI 主机上运行本地 shell 命令。
- TUI 每个会话提示一次以允许本地执行；拒绝会使会话禁用 `!` 。
- 命令在 TUI 工作目录中的全新非交互式 shell 中运行（无持久 `cd`/env）。
- 本地 shell 命令在其环境中接收 `OPENCLAW_SHELL=tui-local`。
- 单独的 `!` 作为普通消息发送；前导空格不会触发本地执行。

## 从本地 TUI 修复配置

当当前配置已经验证并且你想要
嵌入式智能体在同一台机器上检查它，将其与文档进行比较，
并帮助修复漂移，而不依赖于正在运行的 Gateway。

如果 `openclaw config validate` 已经失败，请从 `openclaw configure` 开始
或首先 `openclaw doctor --fix` 。 `openclaw chat` 不会绕过无效的-
配置守卫。

典型循环：

1.启动本地模式：

```bash
openclaw chat
```

2. 询问智能体你想要检查什么，例如：

```text
Compare my gateway auth config with the docs and suggest the smallest fix.
```

3. 使用本地 shell 命令进行准确的证据和验证：

```text
!openclaw config file
!openclaw docs gateway auth token secretref
!openclaw config validate
!openclaw doctor
```

4. 使用 `openclaw config set` 或 `openclaw configure` 应用小范围更改，然后重新运行 `!openclaw config validate`。
5. 如果 Doctor 建议自动迁移或修复，请检查并运行 `!openclaw doctor --fix`。

温馨提示：

- 优先选择 `openclaw config set` 或 `openclaw configure` 而不是手动编辑 `openclaw.json`。
- `openclaw docs "<query>"` 从同一台机器搜索实时文档索引。
- 当你需要结构化模式和 SecretRef/可解析性错误时，`openclaw config validate --json` 非常有用。

## 工具输出

- 工具调用显示为带有参数+结果的卡片。
- Ctrl+O 在折叠/展开视图之间切换。
- 工具运行时，部分更新会流入同一张卡中。

## 终端颜色

- TUI 将助手正文保留在终端的默认前景中，以便深色和浅色终端都保持可读。
- 如果你的终端使用浅色背景且自动检测错误，请在启动 `openclaw tui` 之前设置 `OPENCLAW_THEME=light`。
- 要强制使用原始深色调色板，请设置 `OPENCLAW_THEME=dark`。

## 历史记录 + 流媒体

- 连接时，TUI 加载最新历史记录（默认 200 条消息）。
- 流媒体响应更新到位，直至最终确定。
- TUI 还监听智能体工具事件以获取更丰富的工具卡。

## 连接详细信息

- TUI 向 Gateway 注册为 `mode: "tui"`。
- 重新连接显示系统消息；事件间隙会在日志中显示。

＃＃ 选项

- `--local`：针对本地嵌入式智能体运行时运行
- `--url <url>`: Gateway WebSocket URL （默认为配置或 `ws://127.0.0.1:<port>`）
- `--token <token>`：Gateway token（如果需要）
- `--password <password>`：Gateway 密码（如果需要）
- `--session <key>`：会话密钥（默认值：`main`，或当范围为全局时为 `global`）
- `--deliver`：向提供商提供助理回复（默认关闭）
- `--thinking <level>`：覆盖发送的思考级别
- `--message <text>`：连接后发送初始消息
- `--timeout-ms <ms>`：智能体超时（以毫秒为单位）（默认为 `agents.defaults.timeoutSeconds`）
- `--history-limit <n>`：要加载的历史记录条目（默认`200`）

<Warning>
当你设置 `--url` 时，TUI 不会回退到配置或环境凭据。显式传递 `--token` 或 `--password` 。缺少显式凭据是一个错误。在本地模式下，请勿传递 `--url`、`--token` 或 `--password`。
</Warning>

## 故障排除

发送消息后无输出：

- 运行 TUI 中的 `/status` 以确认 Gateway 已连接且空闲/忙碌。
- 检查 Gateway 日志：`openclaw logs --follow`。
- 确认智能体可以运行：`openclaw status` 和 `openclaw models status`。
- 如果你希望在聊天频道中收到消息，请启用传递（`/deliver on` 或 `--deliver`）。

## 连接故障排除

- `disconnected`：确保 Gateway 正在运行并且你的 `--url/--token/--password` 正确。
- 选择器中没有智能体：检查 `openclaw agents list` 和你的路由配置。
- 空会话选择器：你可能处于全局范围内或还没有会话。

＃＃ 有关的

- [Control UI](/web/control-ui) — 基于 Web 的控制界面
- [Config](/cli/config) — 检查、验证和编辑 `openclaw.json`
- [Doctor](/cli/doctor) — 指导修复和迁移检查
- [CLI 参考](/cli) — 完整 CLI 命令参考
