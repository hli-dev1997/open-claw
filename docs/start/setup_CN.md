---
summary: "Advanced setup and development workflows for OpenClaw"
read_when:
  - Setting up a new machine
  - You want “latest + greatest” without breaking your personal setup
title: "Setup"
---

<Note>
如果你是第一次设置，请从[入门](/start/getting-started)开始。
有关加入详细信息，请参阅[加入 (CLI)](/start/wizard)。
</Note>

## 长篇大论；博士

根据你需要更新的频率以及是否要自己运行 Gateway 选择设置工作流程：

- **剪裁位于存储库之外：**将你的配置和工作区保留在 `~/.openclaw/openclaw.json` 和 `~/.openclaw/workspace/` 中，以便存储库更新不会触及它们。
- **稳定的工作流程（推荐给大多数人）：** 安装 macOS 应用并让它运行捆绑的 Gateway。
- **前沿工作流程（开发）：** 通过 `pnpm gateway:watch` 自行运行 Gateway，然后让 macOS 应用在本地模式下附加。

## 先决条件（来自源）

- 推荐Node 24（Node 22 LTS，当前`22.14+`，仍然支持）
- `pnpm` 首选（或 Bun 如果你有意使用 [Bun 工作流程](/install/bun)）
- Docker （可选；仅适用于容器化设置/e2e — 请参阅 [Docker](/install/docker)）

## 定制策略（这样更新就不会造成伤害）

如果你想要“100% 为我量身定制”*并且*轻松更新，请将你的定制保留在：

- **配置：** `~/.openclaw/openclaw.json` (JSON/JSON5-ish)
- **工作区：** `~/.openclaw/workspace` （技能、提示、记忆；将其设为私人 git 存储库）

引导一次：

```bash
openclaw setup
```

在此存储库中，使用本地 CLI 条目：

```bash
openclaw setup
```

如果你还没有全局安装，请通过 `pnpm openclaw setup` （如果你使用的是 Bun 工作流程，则通过 `bun run openclaw setup` 运行）。

## 从此存储库运行 Gateway

`pnpm build`之后，可以直接运行打包好的CLI：

```bash
node openclaw.mjs gateway --port 18789 --verbose
```

## 稳定的工作流程（macOS 应用优先）

1. 安装 + 启动 **OpenClaw.app**（菜单栏）。
2. 完成加入/权限清单（TCC 提示）。
3. 确保 Gateway 是**本地**并且正在运行（应用管理它）。
4. 链接表面（示例：WhatsApp）：

```bash
openclaw channels login
```

5.健全性检查：

```bash
openclaw health
```

如果你的构建中不支持入门：

- 运行 `openclaw setup`，然后运行 `openclaw channels login`，然后手动启动 Gateway (`openclaw gateway`)。

## 前沿工作流程（终端中的 Gateway）

目标：处理 TypeScript Gateway，进行热重载，保持 macOS 应用 UI 附加。

### 0) （可选）也从源代码运行 macOS 应用

如果你还想要最前沿的 macOS 应用：

```bash
./scripts/restart-mac.sh
```

### 1) 启动开发Gateway

```bash
pnpm install
# First run only (or after resetting local OpenClaw config/workspace)
pnpm openclaw setup
pnpm gateway:watch
```

`gateway:watch` 在命名的 tmux 中启动或重新启动 Gateway 监视进程
会话并从交互式终端自动附加。非交互式 shell 保留
分离并打印 `tmux attach -t openclaw-gateway-watch-main`；使用
`OPENCLAW_GATEWAY_WATCH_ATTACH=0 pnpm gateway:watch` 保持交互式运行
分离，或 `pnpm gateway:watch:raw` 用于前台监视模式。观察者
重新加载相关源、配置和捆绑插件元数据更改。
`pnpm openclaw setup` 是用于全新签出的一次性本地配置/工作区初始化步骤。
`pnpm gateway:watch` 不会重建 `dist/control-ui`，因此在 `ui/` 更改后重新运行 `pnpm ui:build` 或在开发 Control UI 时使用 `pnpm ui:dev`。

如果你有意使用 Bun 工作流程，则等效命令为：

```bash
bun install
# First run only (or after resetting local OpenClaw config/workspace)
bun run openclaw setup
bun run gateway:watch
```

### 2) 将 macOS 应用指向正在运行的 Gateway

在 **OpenClaw.app** 中：

- 连接模式：**本地**
  该应用将连接到配置端口上正在运行的网关。

### 3) 验证

- 应用内 Gateway 状态应为 **“使用现有网关...”**
- 或通过 CLI：

```bash
openclaw health
```

### 常见枪械

- **端口错误：** Gateway WS 默认为 `ws://127.0.0.1:18789`；将 app + CLI 保留在同一端口上。
- **国家所在的地方：**
  - 通道/提供商状态：`~/.openclaw/credentials/`
  - 模型认证配置文件：`~/.openclaw/agents/<agentId>/agent/auth-profiles.json`
  - 会话：`~/.openclaw/agents/<agentId>/sessions/`
  - 日志：`/tmp/openclaw/`

## 凭证存储映射

在调试认证或决定备份内容时使用此选项：

- **WhatsApp**：`~/.openclaw/credentials/whatsapp/<accountId>/creds.json`
- **Telegram 机器人token**：config/env 或 `channels.telegram.tokenFile` （仅限常规文件；符号链接被拒绝）
- **Discord 机器人token**：config/env 或 SecretRef（env/file/exec 提供商）
- **Slack token**：config/env (`channels.slack.*`)
- **配对允许名单**：
  - `~/.openclaw/credentials/<channel>-allowFrom.json`（默认帐户）
  - `~/.openclaw/credentials/<channel>-<accountId>-allowFrom.json`（非默认帐户）
- **模型认证配置文件**：`~/.openclaw/agents/<agentId>/agent/auth-profiles.json`
- **文件支持的秘密负载（可选）**：`~/.openclaw/secrets.json`
- **旧版 OAuth 导入**：`~/.openclaw/credentials/oauth.json`
  更多详细信息：[安全](/gateway/security#credential-storage-map)。

## 更新（不会破坏你的设置）

- 将 `~/.openclaw/workspace` 和 `~/.openclaw/` 保留为“你的东西”；不要将个人提示/配置放入 `openclaw` 存储库中。
- 更新源：`git pull` + 你选择的包管理器安装步骤（默认为 `pnpm install`；`bun install` 用于 Bun 工作流程）+ 继续使用匹配的 `gateway:watch` 命令。

## Linux（systemd 用户服务）

Linux 安装使用 systemd **user** 服务。默认情况下，systemd 停止用户
注销/空闲时的服务，这会杀死 Gateway。入职尝试启用
为你徘徊（可能会提示输入 sudo）。如果它仍然关闭，请运行：

```bash
sudo loginctl enable-linger $USER
```

对于始终在线或多用户服务器，请考虑使用**系统**服务而不是
用户服务（无需拖延）。有关 systemd 注释，请参阅 [Gateway 运行手册](/gateway)。

## 相关文档

- [Gateway 运行手册](/gateway)（标志、监管、端口）
- [Gateway 配置](/gateway/configuration)（配置架构 + 示例）
- [Discord](/channels/discord) 和 [Telegram](/channels/telegram) （回复标签+replyToMode 设置）
- [OpenClaw 辅助设置](/start/openclaw)
- [macOS app](/platforms/macos)（网关生命周期）
