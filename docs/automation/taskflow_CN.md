---
summary: "Task Flow flow orchestration layer above background tasks"
read_when:
  - You want to understand how Task Flow relates to background tasks
  - You encounter Task Flow or openclaw tasks flow in release notes or docs
  - You want to inspect or manage durable flow state
title: "Task flow"
---

Task Flow 是位于[后台任务](/automation/tasks) 之上的流程编排基底。它通过自己的状态、修订跟踪和同步语义来管理持久的多步骤流程，而各个任务仍然是独立的工作单元。

## 何时使用 Task Flow

当工作跨越多个顺序或分支步骤并且你需要跨网关重新启动进行持久进度跟踪时，请使用 Task Flow。对于单个后台操作，普通的 [task](/automation/tasks) 就足够了。

|场景 |使用|
| -------------------------------------------------- | -------------------- |
|单一后台作业 |简单的任务|
|多步骤管道（A、B、C）| Task Flow（托管）|
|观察外部创建的任务 | Task Flow（镜像）|
|一键提醒|计划任务 |

## 可靠的预定工作流程模式

对于市场情报简报等重复工作流程，请将计划、编排和可靠性检查视为单独的层：

1. 使用[计划任务](/automation/cron-jobs)进行计时。
2. 当工作流应基于先前的上下文构建时，请使用持久的 cron 会话。
3. 使用 [Lobster](/tools/lobster) 进行确定性步骤、批准门和恢复token。
4. 使用 Task Flow 跟踪子任务、等待、重试和网关重启的多步骤运行。

cron 形状示例：

```bash
openclaw cron add \
  --name "Market intelligence brief" \
  --cron "0 7 * * 1-5" \
  --tz "America/New_York" \
  --session session:market-intel \
  --message "Run the market-intel Lobster workflow. Verify source freshness before summarizing." \
  --announce \
  --channel slack \
  --to "channel:C1234567890"
```

当重复工作流程需要详细历史记录、先前运行摘要或常设上下文时，请使用 `session:<id>` 而不是 `isolated`。当每次运行都应重新开始并且所有必需的状态在工作流程中明确时，请使用 `isolated`。

在工作流程中，将可靠性检查放在 LLM 摘要步骤之前：

```yaml
name: market-intel-brief
steps:
  - id: preflight
    command: market-intel check --json
  - id: collect
    command: market-intel collect --json
    stdin: $preflight.json
  - id: summarize
    command: market-intel summarize --json
    stdin: $collect.json
  - id: approve
    command: market-intel deliver --preview
    stdin: $summarize.json
    approval: required
  - id: deliver
    command: market-intel deliver --execute
    stdin: $summarize.json
    condition: $approve.approved
```

建议的飞行前检查：

- 浏览器可用性和配置文件选择，例如用于托管状态的 `openclaw` 或需要登录 Chrome 会话时的 `user`。请参阅[浏览器](/tools/browser)。
- 每个源的 API 凭据和配额。
- 所需端点的网络可达性。
- 为智能体启用所需的工具，例如 `lobster`、`browser` 和 `llm-task`。
- 为 cron 配置故障目标，以便预检故障可见。请参阅[计划任务](/automation/cron-jobs#delivery-and-output)。

每个收集项目的推荐数据来源字段：

```json
{
  "sourceUrl": "https://example.com/report",
  "retrievedAt": "2026-04-24T12:00:00Z",
  "asOf": "2026-04-24",
  "title": "Example report",
  "content": "..."
}
```

让工作流在汇总之前拒绝或标记过时的项目。 LLM 步骤应仅接收结构化 JSON，并应要求在其输出中保留 `sourceUrl`、`retrievedAt` 和 `asOf`。当你需要工作流程中的模式验证模型步骤时，请使用 [LLM 任务](/tools/llm-task)。

对于可重用的团队或社区工作流程，请将 CLI、`.lobster` 文件以及任何设置注释打包为技能或插件，并通过 [ClawHub](/tools/clawhub) 发布。将特定于工作流的护栏保留在该包中，除非插件 API 缺少所需的通用功能。

## 同步模式

### 托管模式

Task Flow 拥有端到端的生命周期。它将任务创建为流程步骤，驱动它们完成，并自动推进流程状态。

示例：每周报告流程：(1) 收集数据，(2) 生成报告，(3) 交付报告。 Task Flow 将每个步骤创建为后台任务，等待完成，然后转到下一步。

```
Flow: weekly-report
  Step 1: gather-data     → task created → succeeded
  Step 2: generate-report → task created → succeeded
  Step 3: deliver         → task created → running
```

### 镜像模式

Task Flow 观察外部创建的任务并保持流程状态同步，而无需获取任务创建的所有权。当任务源自 cron 作业、CLI 命令或其他来源并且你希望以流程形式统一查看其进度时，这非常有用。

示例：三个独立的 cron 作业一起形成“早晨操作”例程。镜像流跟踪他们的集体进度，而不控制他们运行的时间或方式。

## 持久状态和修订跟踪

每个流程都会保留自己的状态并跟踪修订，以便在网关重新启动后仍能保持进度。当多个源尝试同时推进同一流程时，修订跟踪可以实现冲突检测。
流注册表使用具有有限预写日志维护功能的 SQLite，包括
定期和关闭检查点，因此长期运行的网关不会保留
无限制的 `registry.sqlite-wal` sidecar 文件。

## 取消行为

`openclaw tasks flow cancel` 在流上设置粘性取消意图。流程中的活动任务将被取消，并且不会启动新的步骤。取消意图在重新启动后仍然存在，因此即使网关在所有子任务终止之前重新启动，已取消的流仍会保持取消状态。

## CLI 命令

```bash
# List active and recent flows
openclaw tasks flow list

# Show details for a specific flow
openclaw tasks flow show <lookup>

# Cancel a running flow and its active tasks
openclaw tasks flow cancel <lookup>
```

|命令 |描述 |
| --------------------------------- | -------------------------------------------------------- |
| `openclaw tasks flow list` |显示跟踪的流量以及状态和同步模式 |
| `openclaw tasks flow show <id>` |通过流 ID 或查找键检查一个流 |
| `openclaw tasks flow cancel <id>` |取消正在运行的流程及其活动任务 |

## 流程与任务的关系

流程协调任务，而不是取代它们。单个流在其生命周期内可能驱动多个后台任务。使用 `openclaw tasks` 检查各个任务记录，并使用 `openclaw tasks flow` 检查编排流程。

## 相关

- [后台任务](/automation/tasks) — 流动协调的独立工作分类帐
- [CLI: 任务](/cli/tasks) — CLI 命令参考 `openclaw tasks flow`
- [自动化概述](/automation) — 所有自动化机制一目了然
- [Cron Jobs](/automation/cron-jobs) — 可能会馈入流程的计划作业
