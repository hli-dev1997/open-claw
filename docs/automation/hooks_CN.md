---
summary: "Hooks: event-driven automation for commands and lifecycle events"
read_when:
  - You want event-driven automation for /new, /reset, /stop, and agent lifecycle events
  - You want to build, install, or debug hooks
title: "Hooks"
---

挂钩是当 Gateway 内部发生某些情况时运行的小脚本。可以从目录中发现它们并使用 `openclaw hooks` 进行检查。仅在启用挂钩或配置至少一个挂钩条目、挂钩包、旧处理程序或额外挂钩目录后，Gateway 才会加载内部挂钩。

OpenClaw 中有两种钩子：

- **内部挂钩**（本页）：当智能体事件触发时（例如 `/new`、`/reset`、`/stop` 或生命周期事件），在 Gateway 内部运行。
- **Webhooks**：外部 HTTP 端点，让其他系统触发 OpenClaw 中的工作。请参阅 [Webhooks](/automation/cron-jobs#webhooks)。

Hooks 也可以捆绑在插件中。 `openclaw hooks list` 显示独立挂钩和插件管理挂钩。

## 快速开始

```bash
# List available hooks
openclaw hooks list

# Enable a hook
openclaw hooks enable session-memory

# Check hook status
openclaw hooks check

# Get detailed information
openclaw hooks info session-memory
```

## 事件类型

|活动 |当它发生时 |
| ------------------------ | ---------------------------------------------------------------------- |
| `command:new` | `command:new` `/new` 命令已发出 |
| `command:reset` | `/reset` 命令已发出 |
| `command:stop` | `/stop` 命令已发出 |
| `command` |任何命令事件（一般侦听器）|
| `session:compact:before` |压缩前总结历史|
| `session:compact:after` |压缩完成后|
| `session:patch` |当会话属性被修改时 |
| `agent:bootstrap` |在注入工作区引导文件之前 |
| `gateway:startup` |通道启动并加载挂钩后 |
| `gateway:shutdown` |网关何时开始关闭 |
| `gateway:pre-restart` |在预期的网关重新启动之前 |
| `message:received` |来自任何渠道的入站消息 |
| `message:transcribed` |音频转录完成后 |
| `message:preprocessed` |媒体和链接预处理完成或被跳过后 |
| `message:sent` |已发送出站消息 |

## 编写钩子

### 钩子结构

每个钩子都是一个包含两个文件的目录：

```
my-hook/
├── HOOK.md          # Metadata + documentation
└── handler.ts       # Handler implementation
```

### HOOK.md 格式

```markdown
---
name: my-hook
description: "Short description of what this hook does"
metadata:
  { "openclaw": { "emoji": "🔗", "events": ["command:new"], "requires": { "bins": ["node"] } } }
---

# My Hook

Detailed documentation goes here.
```

**元数据字段** (`metadata.openclaw`)：

|领域 |描述 |
| ---------- | ---------------------------------------------------------------- |
| `emoji` |显示 CLI 的表情符号 |
| `events` |要侦听的事件数组 |
| `export` |要使用的命名导出（默认为 `"default"`）|
| `os` |所需平台（e.g.、`["darwin", "linux"]`）|
| `requires` |所需的 `bins`、`anyBins`、`env` 或 `config` 路径 |
| `always` |绕过资格检查（布尔值）|
| `install` |安装方法 |

### 处理程序实现

```typescript
const handler = async (event) => {
  if (event.type !== "command" || event.action !== "new") {
    return;
  }

  console.log(`[my-hook] New command triggered`);
  // Your logic here

  // Optionally send message to user
  event.messages.push("Hook executed!");
};

export default handler;
```

每个事件包括：`type`、`action`、`sessionKey`、`timestamp`、`messages`（推送发送给用户）和 `context`（事件特定数据）。智能体和工具插件挂钩上下文还可以包括 `trace`，这是一个只读的 W3C 兼容诊断跟踪上下文，插件可以将其传递到结构化日志中以进行 OTEL 相关性。

### 事件背景亮点

**命令事件**（`command:new`、`command:reset`）：`context.sessionEntry`、`context.previousSessionEntry`、`context.commandSource`、`context.workspaceDir`、`context.cfg`。

**消息事件** (`message:received`)：`context.from`、`context.content`、`context.channelId`、`context.metadata`（特定于提供商的数据包括 `senderId`、 `senderName`、`guildId`)。

**消息事件** (`message:sent`)：`context.to`、`context.content`、`context.success`、`context.channelId`。

**消息事件** (`message:transcribed`)：`context.transcript`、`context.from`、`context.channelId`、`context.mediaPath`。

**消息事件** (`message:preprocessed`)：`context.bodyForAgent`（最终丰富正文）、`context.from`、`context.channelId`。

**引导事件** (`agent:bootstrap`)：`context.bootstrapFiles`（可变数组）、`context.agentId`。

**会话补丁事件** (`session:patch`)：`context.sessionEntry`、`context.patch`（仅更改的字段）、`context.cfg`。只有特权客户端才能触发补丁事件。

**压缩事件**：`session:compact:before` 包括 `messageCount`、`tokenCount`。 `session:compact:after` 添加 `compactedCount`、`summaryLength`、`tokensBefore`、`tokensAfter`。

`command:stop` 观察到用户发出 `/stop`；这是取消/命令
生命周期，而不是智能体最终确定门。 Plugins 需要检查
自然的最终答案并要求智能体再提供一次通行证应使用打字的
改为插件挂钩 `before_agent_finalize` 。请参阅 [Plugin 挂钩](/plugins/hooks)。

**Gateway 生命周期事件**：`gateway:shutdown` 包括 `reason` 和 `restartExpectedMs`，并在网关开始关闭时触发。 `gateway:pre-restart` 包含相同的上下文，但仅当关闭是预期重新启动的一部分并且提供了有限的 `restartExpectedMs` 值时才会触发。在关闭期间，每个生命周期钩子等待都是尽力而为且有界的，因此如果处理程序停止，关闭将继续。

## 钩子发现

钩子是从这些目录中发现的，按照覆盖优先级递增的顺序：

1. **捆绑挂钩**：随 OpenClaw 一起提供
2. **Plugin hooks**：捆绑在已安装插件内的钩子
3. **托管挂钩**：`~/.openclaw/hooks/`（用户安装，跨工作区共享）。 `hooks.internal.load.extraDirs` 中的额外目录共享此优先级。
4. **工作区挂钩**：`<workspace>/hooks/`（每个智能体，默认禁用，直到明确启用）

工作区挂钩可以添加新的挂钩名称，但不能覆盖具有相同名称的捆绑、托管或插件提供的挂钩。

Gateway 在启动时跳过内部挂钩发现，直到配置内部挂钩。使用 `openclaw hooks enable <name>` 启用捆绑或托管挂钩、安装挂钩包或设置 `hooks.internal.enabled=true` 选择加入。当你启用一个命名挂钩时，Gateway 仅加载该挂钩的处理程序； `hooks.internal.enabled=true`、额外的钩子目录和遗留处理程序选择进行广泛的发现。

### 挂钩包

Hook 包是通过 `package.json` 中的 `openclaw.hooks` 导出 hook 的 npm 包。安装：

```bash
openclaw plugins install <path-or-spec>
```

Npm 规范仅包含注册表（包名称 + 可选的确切版本或 dist-tag）。 Git/URL/文件规范和语义版本范围被拒绝。

## 捆绑钩子

|钩|活动 |它有什么作用 |
| -------------------- | ------------------------------------------ | ---------------------------------------------------------------- |
|会话内存| `command:new`、`command:reset` |将会话上下文保存到 `<workspace>/memory/` |
|引导额外文件 | `agent:bootstrap` |从 glob 模式注入额外的引导文件 |
|命令记录器 | `command` |将所有命令记录到 `~/.openclaw/logs/commands.log` |
|启动MD | `gateway:startup` |网关启动时运行 `BOOT.md` |

启用任何捆绑的钩子：

```bash
openclaw hooks enable <hook-name>
```

<a id="session-memory"></a>

### 会话内存详细信息

提取最后 15 条用户/助理消息，通过 LLM 生成描述性文件名段，并使用主机本地日期保存到 `<workspace>/memory/YYYY-MM-DD-slug.md`。需要配置 `workspace.dir`。

<a id="bootstrap-extra-files"></a>

### bootstrap-extra-files 配置

```json
{
  "hooks": {
    "internal": {
      "entries": {
        "bootstrap-extra-files": {
          "enabled": true,
          "paths": ["packages/*/AGENTS.md", "packages/*/TOOLS.md"]
        }
      }
    }
  }
}
```

路径相对于工作区进行解析。仅加载可识别的引导程序基名（`AGENTS.md`、`SOUL.md`、`TOOLS.md`、`IDENTITY.md`、`USER.md`、`HEARTBEAT.md`、 `BOOTSTRAP.md`、`MEMORY.md`)。

<a id="command-logger"></a>

### 命令记录器详细信息

将每个斜杠命令记录到 `~/.openclaw/logs/commands.log`。

<a id="boot-md"></a>

### boot-md 详细信息

网关启动时从活动工作区运行 `BOOT.md`。

## Plugin 钩子

Plugins 可以通过 Plugin SDK 注册类型化钩子以进行更深入的集成：
拦截工具调用、修改提示、控制消息流等等。
当你需要 `before_tool_call`、`before_agent_reply` 时，请使用插件挂钩，
`before_install`，或其他进程内生命周期挂钩。

有关完整的插件挂钩参考，请参阅 [Plugin 挂钩](/plugins/hooks)。

＃＃ 配置

```json
{
  "hooks": {
    "internal": {
      "enabled": true,
      "entries": {
        "session-memory": { "enabled": true },
        "command-logger": { "enabled": false }
      }
    }
  }
}
```

每个钩子环境变量：

```json
{
  "hooks": {
    "internal": {
      "entries": {
        "my-hook": {
          "enabled": true,
          "env": { "MY_CUSTOM_VAR": "value" }
        }
      }
    }
  }
}
```

额外的钩子目录：

```json
{
  "hooks": {
    "internal": {
      "load": {
        "extraDirs": ["/path/to/more/hooks"]
      }
    }
  }
}
```

<Note>
仍支持旧版 `hooks.internal.handlers` 数组配置格式以实现向后兼容性，但新挂钩应使用基于发现的系统。
</Note>

## CLI 参考

```bash
# List all hooks (add --eligible, --verbose, or --json)
openclaw hooks list

# Show detailed info about a hook
openclaw hooks info <hook-name>

# Show eligibility summary
openclaw hooks check

# Enable/disable
openclaw hooks enable <hook-name>
openclaw hooks disable <hook-name>
```

## 最佳实践

- **保持处理程序快速。** 在命令处理期间运行挂钩。使用 `void processInBackground(event)` 进行“即发即忘”的繁重工作。
- **优雅地处理错误。** 将有风险的操作包装在 try/catch 中；不要抛出异常，以便其他处理程序可以运行。
- **尽早过滤事件。**如果事件类型/操作不相关，则立即返回。
- **使用特定事件键。** 优先使用 `"events": ["command:new"]` 而不是 `"events": ["command"]` 以减少开销。

## 故障排除

### 未发现钩子

```bash
# Verify directory structure
ls -la ~/.openclaw/hooks/my-hook/
# Should show: HOOK.md, handler.ts

# List all discovered hooks
openclaw hooks list
```

### 挂钩不符合条件

```bash
openclaw hooks info my-hook
```

检查是否缺少二进制文件 (PATH)、环境变量、配置值或操作系统兼容性。

### 钩子未执行

1. 验证钩子已启用：`openclaw hooks list`
2. 重新启动网关进程，以便重新加载挂钩。
3.检查网关日志：`./scripts/clawlog.sh | grep hook`

## 相关

- [CLI 参考：钩子](/cli/hooks)
- [Webhooks](/automation/cron-jobs#webhooks)
- [Plugin hooks](/plugins/hooks) — 进程内插件生命周期挂钩
- [配置](/gateway/configuration-reference#hooks)
