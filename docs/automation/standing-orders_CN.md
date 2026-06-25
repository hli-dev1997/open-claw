---
summary: "Define permanent operating authority for autonomous agent programs"
read_when:
  - Setting up autonomous agent workflows that run without per-task prompting
  - Defining what the agent can do independently vs. what needs human approval
  - Structuring multi-program agents with clear boundaries and escalation rules
title: "Standing orders"
---

常规订单授予你的智能体针对指定项目的**永久操作权**。你不必每次都给出单独的任务指令，而是可以定义具有明确范围、触发器和升级规则的程序，并且智能体在这些边界内自主执行。

这就是告诉你的助手每周五“发送每周报告”与授予常设权限之间的区别：“你拥有每周报告。每周五编译它，发送它，只有在出现问题时才升级。”

## 为什么定期订单

**无常规订单：**

- 你必须提示智能体完成每项任务
- 智能体在请求之间处于空闲状态
- 日常工作被遗忘或延迟
- 你成为瓶颈

**常规订单：**

- 智能体在定义的边界内自主执行
- 日常工作按计划进行，无需提示
- 你仅在例外和批准的情况下参与
- 座席有效地填补空闲时间

## 它们是如何工作的

常规订单在你的[智能体工作区](/concepts/agent-workspace) 文件中定义。建议的方法是将它们直接包含在 `AGENTS.md` 中（每个会话都会自动注入），以便智能体始终将它们放在上下文中。对于较大的配置，你还可以将它们放在专用文件中，例如 `standing-orders.md` 并从 `AGENTS.md` 引用它。

每个程序指定：

1. **范围** — 智能体人有权做什么
2. **触发器** — 何时执行（计划、事件或条件）
3. **批准门**——在行动之前需要人工签字
4. **升级规则** — 何时停止并寻求帮助

智能体在每个会话中通过工作区引导文件加载这些指令（有关自动注入文件的完整列表，请参阅 [智能体工作区](/concepts/agent-workspace)）并针对它们执行，并结合 [cron 作业](/automation/cron-jobs) 进行基于时间的强制执行。

<Tip>
将常规订单放入 `AGENTS.md` 中，以确保每次会话都会加载它们。工作区引导程序自动注入 `AGENTS.md`、`SOUL.md`、`TOOLS.md`、`IDENTITY.md`、`USER.md`、`HEARTBEAT.md`、 `BOOTSTRAP.md` 和 `MEMORY.md` — 但不是子目录中的任意文件。
</Tip>

## 常规订单的剖析

```markdown
## Program: Weekly Status Report

**Authority:** Compile data, generate report, deliver to stakeholders
**Trigger:** Every Friday at 4 PM (enforced via cron job)
**Approval gate:** None for standard reports. Flag anomalies for human review.
**Escalation:** If data source is unavailable or metrics look unusual (>2σ from norm)

### Execution steps

1. Pull metrics from configured sources
2. Compare to prior week and targets
3. Generate report in Reports/weekly/YYYY-MM-DD.md
4. Deliver summary via configured channel
5. Log completion to Agent/Logs/

### What NOT to do

- Do not send reports to external parties
- Do not modify source data
- Do not skip delivery if metrics look bad — report accurately
```

## 常规订单加上 cron 作业

常规指令定义了智能体有权执行的操作。 [Cron jobs](/automation/cron-jobs) 定义**何时**发生。他们一起工作：

```
Standing Order: "You own the daily inbox triage"
    ↓
Cron Job (8 AM daily): "Execute inbox triage per standing orders"
    ↓
Agent: Reads standing orders → executes steps → reports results
```

cron 作业提示应引用常规命令而不是重复它：

```bash
openclaw cron add \
  --name daily-inbox-triage \
  --cron "0 8 * * 1-5" \
  --tz America/New_York \
  --timeout-seconds 300 \
  --announce \
  --channel bluebubbles \
  --to "+1XXXXXXXXXX" \
  --message "Execute daily inbox triage per standing orders. Check mail for new alerts. Parse, categorize, and persist each item. Report summary to owner. Escalate unknowns."
```

## 示例

### 示例 1：内容和社交媒体（每周周期）

```markdown
## Program: Content & Social Media

**Authority:** Draft content, schedule posts, compile engagement reports
**Approval gate:** All posts require owner review for first 30 days, then standing approval
**Trigger:** Weekly cycle (Monday review → mid-week drafts → Friday brief)

### Weekly cycle

- **Monday:** Review platform metrics and audience engagement
- **Tuesday–Thursday:** Draft social posts, create blog content
- **Friday:** Compile weekly marketing brief → deliver to owner

### Content rules

- Voice must match the brand (see SOUL.md or brand voice guide)
- Never identify as AI in public-facing content
- Include metrics when available
- Focus on value to audience, not self-promotion
```

### 示例 2：财务操作（事件触发）

```markdown
## Program: Financial Processing

**Authority:** Process transaction data, generate reports, send summaries
**Approval gate:** None for analysis. Recommendations require owner approval.
**Trigger:** New data file detected OR scheduled monthly cycle

### When new data arrives

1. Detect new file in designated input directory
2. Parse and categorize all transactions
3. Compare against budget targets
4. Flag: unusual items, threshold breaches, new recurring charges
5. Generate report in designated output directory
6. Deliver summary to owner via configured channel

### Escalation rules

- Single item > $500: immediate alert
- Category > budget by 20%: flag in report
- Unrecognizable transaction: ask owner for categorization
- Failed processing after 2 retries: report failure, do not guess
```

### 示例 3：监控和警报（连续）

```markdown
## Program: System Monitoring

**Authority:** Check system health, restart services, send alerts
**Approval gate:** Restart services automatically. Escalate if restart fails twice.
**Trigger:** Every heartbeat cycle

### Checks

- Service health endpoints responding
- Disk space above threshold
- Pending tasks not stale (>24 hours)
- Delivery channels operational

### Response matrix

| Condition        | Action                   | Escalate?                |
| ---------------- | ------------------------ | ------------------------ |
| Service down     | Restart automatically    | Only if restart fails 2x |
| Disk space < 10% | Alert owner              | Yes                      |
| Stale task > 24h | Remind owner             | No                       |
| Channel offline  | Log and retry next cycle | If offline > 2 hours     |
```

## 执行-验证-报告模式

常规指令与严格的执行纪律相结合时效果最佳。常规顺序中的每个任务都应遵循以下循环：

1. **执行** — 执行实际工作（不要只是确认指令）
2. **验证** — 确认结果正确（文件存在、消息传递、数据解析）
3. **报告** — 告诉业主做了什么以及验证了什么

```markdown
### Execution rules

- Every task follows Execute-Verify-Report. No exceptions.
- "I'll do that" is not execution. Do it, then report.
- "Done" without verification is not acceptable. Prove it.
- If execution fails: retry once with adjusted approach.
- If still fails: report failure with diagnosis. Never silently fail.
- Never retry indefinitely — 3 attempts max, then escalate.
```

此模式可防止最常见的智能体失败模式：在未完成任务的情况下确认任务。

## 多程序架构

对于管理多个问题的智能体，将常规订单组织为具有明确边界的单独程序：

```markdown
## Program 1: [Domain A] (Weekly)

...

## Program 2: [Domain B] (Monthly + On-Demand)

...

## Program 3: [Domain C] (As-Needed)

...

## Escalation Rules (All Programs)

- [Common escalation criteria]
- [Approval gates that apply across programs]
```

每个程序应该有：

- 自己的**触发节奏**（每周、每月、事件驱动、连续）
- 自己的**审批门**（某些项目比其他项目需要更多的监督）
- 清晰的**边界**（智能体应该知道一个程序在哪里结束，另一个程序从哪里开始）

## 最佳实践

### 做

- 从狭窄的权力开始，随着信任的建立而扩大
- 为高风险行为定义明确的批准门槛
- 包括“NOT 要做的事情”部分 — 边界与权限一样重要
- 与 cron 作业结合以实现可靠的基于时间的执行
- 每周查看智能体日志以验证常规订单是否得到遵守
- 随着你的需求的变化更新常规订单 - 它们是动态文件

### 避免

- 在第一天授予广泛的权力（“做你认为最好的事情”）
- 跳过升级规则——每个程序都需要一个“何时停止并询问”条款
- 假设智能体会记住口头指令 - 将所有内容放入文件中
- 在单个程序中混合关注点——针对不同领域的单独程序
- 忘记用 cron 作业来执行——没有触发器的常规命令变成了建议

## 相关

- [自动化和任务](/automation)：所有自动化机制一目了然。
- [Cron jobs](/automation/cron-jobs)：安排常规命令的执行。
- [Hooks](/automation/hooks)：用于智能体生命周期事件的事件驱动脚本。
- [Webhooks](/automation/cron-jobs#webhooks)：入站 HTTP 事件触发器。
- [智能体工作区](/concepts/agent-workspace)：常规订单所在的位置，包括自动注入引导程序文件的完整列表（`AGENTS.md`、`SOUL.md` 等）。
