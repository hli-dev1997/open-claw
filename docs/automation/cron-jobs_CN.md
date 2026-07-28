---
summary: "Scheduled jobs, webhooks, and Gmail PubSub triggers for the Gateway scheduler"
read_when:
  - Scheduling background jobs or wakeups
  - Wiring external triggers (webhooks, Gmail) into OpenClaw
  - Deciding between heartbeat and cron for scheduled tasks
title: "Scheduled tasks"
sidebarTitle: "Scheduled tasks"
---

Cron 是 Gateway 的内置调度程序。它保留作业，在正确的时间唤醒智能体，并可以将输出传递回聊天通道或 Webhook 端点。

## 快速开始

<Steps>
  <Step title="Add a one-shot reminder">
    ```bash
    openclaw cron add \
      --name "Reminder" \
      --at "2026-02-01T16:00:00Z" \
      --session main \
      --system-event "Reminder: check the cron docs draft" \
      --wake now \
      --delete-after-run
    ```
  </Step>
  <Step title="Check your jobs">
    ```bash
    openclaw cron list
    openclaw cron show <job-id>
    ```
  </Step>
  <Step title="See run history">
    ```bash
    openclaw cron runs --id <job-id>
    ```
  </Step>
</Steps>

## cron 是如何工作的

- Cron 在 Gateway\*\* 进程内运行（不在模型内）。
- 作业定义保留在 `~/.openclaw/cron/jobs.json` 处，因此重新启动不会丢失计划。
- 运行时执行状态保留在 `~/.openclaw/cron/jobs-state.json` 中。如果你在 git 中跟踪 cron 定义，请跟踪 `jobs.json` 和 gitignore `jobs-state.json`。
- 拆分后，较旧的 OpenClaw 版本可以读取 `jobs.json` 但可能将作业视为新作业，因为运行时字段现在位于 `jobs-state.json` 中。
- 当 Gateway 正在运行或停止时编辑 `jobs.json` 时，OpenClaw 会将已更改的计划字段与挂起的运行时槽元数据进行比较，并清除过时的 `nextRunAtMs` 值。纯格式化或仅按键顺序重写会保留待处理的插槽。
- 所有 cron 执行都会创建 [后台任务](/automation/tasks) 记录。
- 在 Gateway 启动时，过期的隔离智能体轮转作业将被重新安排到通道连接窗口之外，而不是立即重播，因此 Discord/Telegram 启动和本机命令设置在重新启动后保持响应。
- 一次性作业 (`--at`) 默认情况下成功后自动删除。
- 运行完成时，隔离的 cron 会尽最大努力为其 `cron:<jobId>` 会话运行密切跟踪的浏览器选项卡/进程，因此分离的浏览器自动化不会留下孤立的进程。
- 隔离的 cron 运行还可以防止过时的确认回复。如果第一个结果只是临时状态更新（`on it`、`pulling everything together` 和类似提示），并且没有后代子智能体运行仍负责最终答案，则 OpenClaw 会在交付前重新提示一次实际结果。
- 隔离的 cron 运行更喜欢来自嵌入式运行的结构化执行拒绝元数据，然后回退到已知的最终摘要/输出标记，例如 `SYSTEM_RUN_DENIED` 和 `INVALID_REQUEST`，因此阻止的命令不会报告为绿色运行。
- 隔离的 cron 运行也会将运行级别智能体故障视为作业错误，即使没有生成回复有效负载，因此模型/提供商故障会增加错误计数器并触发故障通知，而不是将作业清除为成功。
- 当隔离的智能体轮转作业到达 `timeoutSeconds` 时，cron 会中止底层智能体运行并为其提供一个简短的清理窗口。如果运行没有耗尽，Gateway 拥有的清理会在 cron 记录超时之前强制清除该运行的会话所有权，因此排队的聊天工作不会留下陈旧的处理会话。

<a id="maintenance"></a>

<Note>
cron 的任务协调首先由运行时拥有，其次由持久历史记录支持：活动的 cron 任务保持活动状态，而 cron 运行时仍然跟踪该作业正在运行，即使旧的子会话行仍然存在。一旦运行时停止拥有作业并且 5 分钟宽限期到期，维护将检查匹配的 `cron:<jobId>:<startedAt>` 运行的持久运行日志和作业状态。如果该持久历史记录显示最终结果，则任务分类帐由此完成；否则Gateway拥有的维护可以将任务标记为`lost`。离线 CLI 审计可以从持久历史记录中恢复，但它不会将其自己的空进程内活动作业集视为 Gateway 拥有的 cron 运行已消失的证据。
</Note>

## 时间表类型

| 亲切    | CLI 标志  | 描述                                           |
| ------- | --------- | ---------------------------------------------- |
| `at`    | `--at`    | 一次性时间戳（ISO 8601 或类似 `20m` 的相对值） |
| `every` | `--every` | 固定间隔                                       |
| `cron`  | `--cron`  | 带有可选 `--tz` 的 5 字段或 6 字段 cron 表达式 |

没有时区的时间戳被视为 UTC。添加 `--tz America/New_York` 以进行本地挂钟调度。

重复出现的最高时段表达式会自动错开最多 5 分钟，以减少负载峰值。使用 `--exact` 强制精确计时，或使用 `--stagger 30s` 实现显式窗口。

### 月份中的某一天和星期几使用 OR 逻辑

Cron 表达式由 [croner](https://github.com/Hexagon/croner) 解析。当月份和星期几字段都是非通配符时，当 **任一** 字段匹配时，croner 会匹配 - 而不是两者都匹配。这是标准的 Vixie cron 行为。

```
# Intended: "9 AM on the 15th, only if it's a Monday"
# Actual:   "9 AM on every 15th, AND 9 AM on every Monday"
0 9 15 * 1
```

每月会触发约 5-6 次，而不是每月 0-1 次。 OpenClaw 此处使用 Croner 的默认 OR 行为。要同时满足这两个条件，请使用 Croner 的 `+` 星期几修饰符 (`0 9 15 * +1`) 或在一个字段上进行安排，并在作业的提示或命令中保护另一个字段。

## 执行风格

| 风格       | `--session` 值      | 运行于             | 最适合                     |
| ---------- | ------------------- | ------------------ | -------------------------- |
| 主会场     | `main`              | 下一个心跳转       | 提醒、系统事件             |
| 隔离       | `isolated`          | 专用`cron:<jobId>` | 报告、后台杂务             |
| 当前会话   | `current`           | 在创建时绑定       | 情境感知的重复工作         |
| 自定义会话 | `session:custom-id` | 持久命名会话       | 建立在历史基础上的工作流程 |

<AccordionGroup>
  <Accordion title="Main session vs isolated vs custom">
    **主会话**作业将系统事件排入队列，并可选择唤醒心跳（`--wake now` 或 `--wake next-heartbeat`）。这些系统事件不会延长目标会话的每日/空闲重置新鲜度。 **隔离**作业通过新会话运行专用智能体轮流。 **自定义会话** (`session:xxx`) 在运行过程中保留上下文，从而实现基于先前摘要的每日站会等工作流程。
  </Accordion>
  <Accordion title="What 'fresh session' means for isolated jobs">
    对于隔离作业，“新会话”意味着每次运行都有一个新的转录本/会话 ID。 OpenClaw 可能携带安全首选项，例如思考/快速/详细设置、标签和显式用户选择的模型/认证覆盖，但它不会从旧的 cron 行继承环境对话上下文：通道/组路由、发送或队列策略、提升、起源或 ACP 运行时绑定。当重复作业应刻意构建在相同的对话上下文上时，请使用 `current` 或 `session:<id>`。
  </Accordion>
  <Accordion title="Runtime cleanup">
    对于孤立的作业，运行时拆卸现在包括对该 cron 会话进行最大努力的浏览器清理。清理失败将被忽略，因此实际的 cron 结果仍然获胜。

    隔离的 cron 运行还会通过共享运行时清理路径来处置为作业创建的任何捆绑的 MCP 运行时实例。这与主会话和自定义会话 MCP 客户端的拆除方式相匹配，因此隔离的 cron 作业不会在运行期间泄漏 stdio 子进程或长期存在的 MCP 连接。

  </Accordion>
  <Accordion title="Subagent and Discord delivery">
    当隔离的 cron 运行编排子智能体时，传递也更喜欢最终的后代输出而不是陈旧的父临时文本。如果后代仍在运行，OpenClaw 会抑制部分父更新而不是宣布它。

    对于纯文本 Discord 公告目标，OpenClaw 发送规范的最终助理文本一次，而不是重播流式/中间文本负载和最终答案。媒体和结构化 Discord 有效负载仍作为单独的有效负载提供，因此附件和组件不会丢失。

  </Accordion>
</AccordionGroup>

### 独立作业的有效负载选项

<ParamField path="--message" type="string" required>
  提示文本（隔离时需要）。
</ParamField>
<ParamField path="--model" type="string">
  模型覆盖；使用为作业选择的允许模型。
</ParamField>
<ParamField path="--thinking" type="string">
  思维水平超越。
</ParamField>
<ParamField path="--light-context" type="boolean">
  跳过工作区引导文件注入。
</ParamField>
<ParamField path="--tools" type="string">
  限制作业可以使用哪些工具，例如 `--tools exec,read`。
</ParamField>

`--model` 使用选定的允许模型作为该作业的主要模型。它与聊天会话 `/model` 覆盖不同：当主作业失败时，配置的后备链仍然适用。如果请求的模型不被允许或无法解析，则 cron 会导致运行失败并显示显式验证错误，而不是默默地回退到作业的智能体/默认模型选择。

Cron 作业还可以携带有效负载级别 `fallbacks`。如果存在，该列表将替换为作业配置的后备链。当你希望严格的 cron 运行仅尝试所选模型时，请在作业负载/API 中使用 `fallbacks: []` 。如果作业具有 `--model` 但既没有有效负载也没有配置回退，则 OpenClaw 会传递显式空回退覆盖，因此智能体主节点不会作为隐藏的额外重试目标附加。

孤立作业的模型选择优先级是：

1. Gmail 挂钩模型覆盖（当运行来自 Gmail 并且允许覆盖时）
2. 每个作业有效负载 `model`
3. 用户选择的存储 cron 会话模型覆盖4.智能体/默认机型选择

快速模式也遵循已解决的实时选择。如果所选模型配置具有 `params.fastMode`，则隔离 cron 默认使用该配置。存储的会话 `fastMode` 覆盖仍然在任一方向上胜过配置。

如果隔离运行遇到实时模型切换切换，则 cron 会使用切换的提供商/模型重试，并在重试之前保留活动运行的实时选择。当交换机还携带新的认证配置文件时，cron 也会为活动运行保留该认证配置文件覆盖。重试次数是有限的：在初次尝试加上 2 次切换重试后，cron 将中止而不是永远循环。

在隔离的 cron 运行进入智能体运行程序之前，OpenClaw 检查已配置的 `api: "ollama"` 和 `api: "openai-completions"` 提供商（其 `baseUrl` 为环回、专用网络或 `.local`）的可访问本地提供商端点。如果该端点已关闭，则运行将记录为 `skipped` 并带有明显的提供商/模型错误，而不是启动模型调用。端点结果缓存 5 分钟，因此使用相同死本地 Ollama、vLLM、SGLang 或 LM Studio 服务器的许多到期作业共享一个小型探测器，而不是创建请求风暴。跳过提供商预检运行不会增加执行错误退避；当你想要重复跳过通知时启用 `failureAlert.includeSkipped` 。

## 交付和输出

| 模式       | 会发生什么                                    |
| ---------- | --------------------------------------------- |
| `announce` | 回退-如果智能体未发送，则将最终文本传递给目标 |
| `webhook`  | POST 完成事件负载到 URL                       |
| `none`     | 没有跑步者后备交付                            |

使用 `--announce --channel telegram --to "-1001234567890"` 进行通道传递。对于 Telegram 论坛主题，请使用 `-1001234567890:topic:123`；直接 RPC/config 调用者也可以将 `delivery.threadId` 作为字符串或数字传递。 Slack/Discord/Mattermost 目标应使用显式前缀（`channel:<id>`、`user:<id>`）。 Matrix 房间 ID 区分大小写；使用准确的房间 ID 或 Matrix 中的 `room:!room:server` 表格。

对于孤立的工作，聊天交付是共享的。如果聊天路由可用，则即使作业使用 `--no-deliver`，智能体也可以使用 `message` 工具。如果智能体发送到配置/当前目标，OpenClaw 会跳过回退公告。否则 `announce`、`webhook` 和 `none` 仅控制跑步者在智能体转弯后对最终回复执行的操作。

当客服人员从活动聊天中创建隔离提醒时，OpenClaw 会存储后备公告路由的保留实时传递目标。内部会话密钥可以是小写；当当前聊天上下文可用时，不会根据这些密钥重建提供商交付目标。

失败通知遵循单独的目标路径：

- `cron.failureDestination` 设置失败通知的全局默认值。
- `job.delivery.failureDestination` 覆盖每个作业的值。
- 如果两者均未设置并且作业已通过 `announce` 交付，则失败通知现在会回退到该主要公告目标。
- `delivery.failureDestination` 仅在 `sessionTarget="isolated"` 作业上受支持，除非主要传送模式为 `webhook`。
- `failureAlert.includeSkipped: true` 将作业或全局 cron 警报策略选择为重复跳过运行警报。跳过的运行保留一个单独的连续跳过计数器，因此它们不会影响执行错误退避。

## CLI 示例

<Tabs>
  <Tab title="One-shot reminder">
    ```bash
    openclaw cron add \
      --name "Calendar check" \
      --at "20m" \
      --session main \
      --system-event "Next heartbeat: check calendar." \
      --wake now
    ```
  </Tab>
  <Tab title="Recurring isolated job">
    ```bash
    openclaw cron add \
      --name "Morning brief" \
      --cron "0 7 * * *" \
      --tz "America/Los_Angeles" \
      --session isolated \
      --message "Summarize overnight updates." \
      --announce \
      --channel slack \
      --to "channel:C1234567890"
    ```
  </Tab>
  <Tab title="Model and thinking override">
    ```bash
    openclaw cron add \
      --name "Deep analysis" \
      --cron "0 6 * * 1" \
      --tz "America/Los_Angeles" \
      --session isolated \
      --message "Weekly deep analysis of project progress." \
      --model "opus" \
      --thinking high \
      --announce
    ```
  </Tab>
</Tabs>

## 网络钩子

Gateway 可以公开 HTTP webhook 端点以供外部触发器使用。在配置中启用：

```json5
{
  hooks: {
    enabled: true,
    token: "shared-secret",
    path: "/hooks",
  },
}
```

### 认证

每个请求都必须通过标头包含钩子token：

- `Authorization: Bearer <token>`（推荐）
- `x-openclaw-token: <token>`

查询字符串标记被拒绝。

<AccordionGroup>
  <Accordion title="POST /hooks/wake">
    将系统事件加入主会话队列：

    ```bash
    curl -X POST http://127.0.0.1:18789/hooks/wake \
      -H 'Authorization: Bearer SECRET' \
      -H 'Content-Type: application/json' \
      -d '{"text":"New email received","mode":"now"}'
    ```

    <ParamField path="text" type="string" required>
      事件描述。
    </ParamField>
    <ParamField path="mode" type="string" default="now">
      `now` 或 `next-heartbeat`。
    </ParamField>

  </Accordion>
  <Accordion title="POST /hooks/agent">
    运行一个孤立的智能体回合：

    ```bash
    curl -X POST http://127.0.0.1:18789/hooks/agent \
      -H 'Authorization: Bearer SECRET' \
      -H 'Content-Type: application/json' \
      -d '{"message":"Summarize inbox","name":"Email","model":"openai/gpt-5.4"}'
    ```

    字段：`message`（必填）、`name`、`agentId`、`wakeMode`、`deliver`、`channel`、 `to`、`model`、`fallbacks`、`thinking`、`timeoutSeconds`。

  </Accordion>
  <Accordion title="Mapped hooks (POST /hooks/<name>)">
    自定义挂钩名称通过 config.json 中的 `hooks.mappings` 解析。映射可以使用模板或代码转换将任意有效负载转换为 `wake` 或 `agent` 操作。
  </Accordion>
</AccordionGroup>

<Warning>
将钩子端点保留在环回、尾网或受信任的反向智能体后面。

- 使用专用的挂钩token；不要重复使用网关认证token。
- 将 `hooks.path` 保留在专用子路径上； `/` 被拒绝。
- 设置 `hooks.allowedAgentIds` 以限制显式 `agentId` 路由。
- 保留 `hooks.allowRequestSessionKey=false` 除非你需要呼叫者选择的会话。
- 如果启用 `hooks.allowRequestSessionKey`，还需设置 `hooks.allowedSessionKeyPrefixes` 以限制允许的会话密钥形状。
- 默认情况下，钩子有效负载被安全边界包裹。

</Warning>

## Gmail PubSub 集成

通过 Google PubSub 将 Gmail 收件箱触发器连接到 OpenClaw。

<Note>
**先决条件：** `gcloud` CLI、`gog` (gogcli)、OpenClaw 已启用挂钩、Tailscale 用于公共 HTTPS 端点。
</Note>

### 向导设置（推荐）

```bash
openclaw webhooks gmail setup --account openclaw@gmail.com
```

这将写入 `hooks.gmail` 配置，启用 Gmail 预设，并使用 Tailscale Funnel 作为推送端点。

### Gateway 自动启动

当设置 `hooks.enabled=true` 和 `hooks.gmail.account` 时，Gateway 在启动时启动 `gog gmail watch serve` 并自动更新手表。设置 `OPENCLAW_SKIP_GMAIL_WATCHER=1` 以选择退出。

### 手动一次性设置

<Steps>
  <Step title="Select the GCP project">
    选择拥有 `gog` 使用的 OAuth 客户端的 GCP 项目：

    ```bash
    gcloud auth login
    gcloud config set project <project-id>
    gcloud services enable gmail.googleapis.com pubsub.googleapis.com
    ```

  </Step>
  <Step title="Create topic and grant Gmail push access">
    ```bash
    gcloud pubsub topics create gog-gmail-watch
    gcloud pubsub topics add-iam-policy-binding gog-gmail-watch \
      --member=serviceAccount:gmail-api-push@system.gserviceaccount.com \
      --role=roles/pubsub.publisher
    ```
  </Step>
  <Step title="Start the watch">
    ```bash
    gog gmail watch start \
      --account openclaw@gmail.com \
      --label INBOX \
      --topic projects/<project-id>/topics/gog-gmail-watch
    ```
  </Step>
</Steps>

### Gmail 模型覆盖

```json5
{
  hooks: {
    gmail: {
      model: "openrouter/meta-llama/llama-3.3-70b-instruct:free",
      thinking: "off",
    },
  },
}
```

## 管理工作

```bash
# List all jobs
openclaw cron list

# Show one job, including resolved delivery route
openclaw cron show <jobId>

# Edit a job
openclaw cron edit <jobId> --message "Updated prompt" --model "opus"

# Force run a job now
openclaw cron run <jobId>

# Run only if due
openclaw cron run <jobId> --due

# View run history
openclaw cron runs --id <jobId> --limit 50

# Delete a job
openclaw cron remove <jobId>

# Agent selection (multi-agent setups)
openclaw cron add --name "Ops sweep" --cron "0 6 * * *" --session isolated --message "Check ops queue" --agent ops
openclaw cron edit <jobId> --clear-agent
```

<Note>
模型覆盖注意事项：

- `openclaw cron add|edit --model ...` 更改作业的选定模型。
- 如果允许该模型，则该确切的提供商/模型将到达隔离智能体运行。
- 如果不允许或无法解决，则 cron 运行失败并显示显式验证错误。
- 配置的回退链仍然适用，因为 cron `--model` 是主要作业，而不是会话 `/model` 覆盖。
- 有效负载 `fallbacks` 替换了该作业的配置后备； `fallbacks: []` 禁用回退并使运行严格。
- 没有显式或配置的后备列表的普通 `--model` 不会落入智能体主节点作为静默额外重试目标。

</Note>

## 配置

```json5
{
  cron: {
    enabled: true,
    store: "~/.openclaw/cron/jobs.json",
    maxConcurrentRuns: 1,
    retry: {
      maxAttempts: 3,
      backoffMs: [60000, 120000, 300000],
      retryOn: ["rate_limit", "overloaded", "network", "server_error"],
    },
    webhookToken: "replace-with-dedicated-webhook-token",
    sessionRetention: "24h",
    runLog: { maxBytes: "2mb", keepLines: 2000 },
  },
}
```

`maxConcurrentRuns` 限制计划的 cron 调度和隔离的智能体轮流执行。独立的 cron 智能体在内部轮流使用队列的专用 `cron-nested` 执行通道，因此提高此值可以让独立的 cron LLM 并行运行进度，而不是仅启动其外部 cron 包装器。此设置不会拓宽共享非 cron `nested` 通道。

运行时状态 sidecar 源自 `cron.store`：`.json` 存储（例如 `~/clawd/cron/jobs.json`）使用 `~/clawd/cron/jobs-state.json`，而没有 `.json` 后缀的存储路径会附加`-state.json`。

如果你手动编辑 `jobs.json`，请将 `jobs-state.json` 置于源代码控制之外。 OpenClaw 使用该 sidecar 来处理挂起的槽、活动标记、上次运行元数据以及告诉调度程序外部编辑的作业何时需要新的 `nextRunAtMs` 的调度标识。

禁用 cron：`cron.enabled: false` 或 `OPENCLAW_SKIP_CRON=1`。

<AccordionGroup>
  <Accordion title="Retry behavior">
    **一次性重试**：瞬时错误（速率限制、过载、网络、服务器错误）最多可重试 3 次，并采用指数退避。永久错误立即禁用。

    **重复重试**：重试之间的指数退避（30s 到 60m）。下一次成功运行后，退避重置。

  </Accordion>
  <Accordion title="Maintenance">
    `cron.sessionRetention` （默认 `24h`）修剪隔离的运行会话条目。 `cron.runLog.maxBytes` / `cron.runLog.keepLines` 自动修剪运行日志文件。
  </Accordion>
</AccordionGroup>

## 故障排除

### 命令阶梯

```bash
openclaw status
openclaw gateway status
openclaw cron status
openclaw cron list
openclaw cron runs --id <jobId> --limit 20
openclaw system heartbeat last
openclaw logs --follow
openclaw doctor
```

<AccordionGroup>
  <Accordion title="Cron not firing">
    - 检查 `cron.enabled` 和 `OPENCLAW_SKIP_CRON` 环境变量。
    - 确认 Gateway 正在连续运行。
    - 对于 `cron` 计划，验证时区 (`--tz`) 与主机时区。
    - 运行输出中的 `reason: not-due` 表示已使用 `openclaw cron run <jobId> --due` 检查了手动运行，并且作业尚未到期。

  </Accordion>
  <Accordion title="Cron fired but no delivery">
    - 交付模式 `none` 表示预计不会发送运行程序后备发送。当聊天路由可用时，智能体仍然可以直接使用 `message` 工具发送。
    - 递送目标缺失/无效 (`channel`/`to`) 表示出站被跳过。
    - 对于 Matrix，具有小写 `delivery.to` 房间 ID 的复制或旧作业可能会失败，因为 Matrix 房间 ID 区分大小写。将作业编辑为 Matrix 中的确切 `!room:server` 或 `room:!room:server` 值。
    - 通道认证错误（`unauthorized`、`Forbidden`）意味着传递被凭据阻止。
    - 如果隔离运行仅返回静默token (`NO_REPLY` / `no_reply`)，则 OpenClaw 会抑制直接出站传递，还会抑制回退排队摘要路径，因此不会将任何内容发回聊天。
    - 如果智能体应向用户本身发送消息，请检查作业是否具有可用的路由（`channel: "last"` 与之前的聊天，或明确的渠道/目标）。

  </Accordion>
  <Accordion title="Cron or heartbeat appears to prevent /new-style rollover">
    - 每日和闲置重置新鲜度不基于 `updatedAt`；请参阅[会话管理](/concepts/session#session-lifecycle)。
    - Cron 唤醒、心跳运行、执行通知和网关簿记可能会更新路由/状态的会话行，但它们不会扩展 `sessionStartedAt` 或 `lastInteractionAt`。
    - 对于在这些字段存在之前创建的旧行，当文件仍然可用时，OpenClaw 可以从记录 JSONL 会话标头恢复 `sessionStartedAt`。没有 `lastInteractionAt` 的旧空闲行使用恢复的开始时间作为其空闲基线。

  </Accordion>
  <Accordion title="Timezone gotchas">
    - 不带 `--tz` 的 Cron 使用网关主机时区。
    - 没有时区的 `at` 计划被视为 UTC。
    - 心跳 `activeHours` 使用配置的时区分辨率。

  </Accordion>
</AccordionGroup>

## 相关

- [自动化和任务](/automation) — 所有自动化机制一目了然
- [后台任务](/automation/tasks) — cron 执行的任务分类帐
- [Heartbeat](/gateway/heartbeat) — 定期主会话轮流
- [时区](/concepts/timezone) — 时区配置
