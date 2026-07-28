---
summary: "Inferred follow-up memory for check-ins that are not exact reminders"
title: "Inferred commitments"
sidebarTitle: "Commitments"
read_when:
  - You want OpenClaw to remember natural follow-ups
  - You want to understand how inferred check-ins differ from reminders
  - You want to review or dismiss follow-up commitments
---

承诺是短暂的后续记忆。启用后，OpenClaw 可以
请注意，一次对话创造了未来签到的机会，并记住
稍后再带回来。

示例：

- 你提到明天的采访。 OpenClaw 可能会在之后签入。
- 你说你累了。 OpenClaw 稍后可能会询问你是否睡觉。
- 智能体表示，有变化后会跟进。 OpenClaw 可能会跟踪
  那个开环。

承诺不是像 `MEMORY.md` 这样持久的事实，而且也不准确
提醒。它们位于内存和自动化之间：OpenClaw 记得一个
对话绑定的义务，然后心跳在到期时传递它。

## 启用承诺

默认情况下，承诺处于关闭状态。在配置中启用它们：

```bash
openclaw config set commitments.enabled true
openclaw config set commitments.maxPerDay 3
```

等效 `openclaw.json`：

```json
{
  "commitments": {
    "enabled": true,
    "maxPerDay": 3
  }
}
```

`commitments.maxPerDay` 限制可以提供的推断后续数量
滚动日内每个智能体会话。默认值为 `3`。

## 它是如何工作的

智能体回复后，OpenClaw 可能会在
单独的上下文。该通行证仅查找推断的后续承诺。它
不写入可见对话，也不询问主智能体
来推理提取。

当找到高可信度候选者时，OpenClaw 会存储一个承诺：

- 智能体 ID
- 会话密钥
- 原始渠道及投放目标
- 到期窗口
- 简短的建议入住
- 用于决定是否发送心跳的非指导性元数据

交付通过心跳进行。当承诺到期时，心跳
添加对相同智能体和渠道范围的心跳轮次的承诺。
该模型可以发送一个自然签到或回复 `HEARTBEAT_OK` 以驳回它。
如果心跳配置为 `target: "none"`，则保留应有的承诺
内部，不发送外部签到。承诺交付提示不
重播原始对话文本，到期承诺心跳轮流运行
没有 OpenClaw 工具。

OpenClaw 永远不会在编写后立即交付推断的承诺。
到期时间被限制在承诺后至少一个心跳间隔
已创建，因此后续内容无法在其创建的同一时刻回显
推断。

## 范围

承诺的范围仅限于其所在的确切智能体和渠道环境
创建的。与 Discord 中的一名特工交谈时推断出的后续行动不是
由另一个智能体、另一个通道或不相关的会话传递。

此范围是该功能的一部分。自然的签到感觉应该是一样的
对话仍在继续，不像全局提醒系统。

## 承诺与提醒

| 需要                                 | 使用                              |
| ------------------------------------ | --------------------------------- |
| “下午 3 点提醒我”                    | [计划任务](/automation/cron-jobs) |
| “20 分钟后联系我”                    | [计划任务](/automation/cron-jobs) |
| “每个工作日运行此报告”               | [计划任务](/automation/cron-jobs) |
| “我明天有面试”                       | 承诺                              |
| “我整夜没睡”                         | 承诺                              |
| “如果我不回答这个开放的话题，请跟进” | 承诺                              |

确切的用户请求已经属于调度程序路径。承诺仅
对于推断的后续行动：用户没有要求提醒的时刻，
但这次谈话显然为未来的签到创造了一个有用的机会。

## 管理承诺

使用 CLI 检查并清除存储的承诺：

```bash
openclaw commitments
openclaw commitments --all
openclaw commitments --agent main
openclaw commitments --status snoozed
openclaw commitments dismiss cm_abc123
```

有关命令参考，请参阅 [`openclaw commitments`](/cli/commitments)。

## 隐私和费用

承诺提取使用 LLM 通行证，因此启用它会添加后台模型
符合条件的回合后使用。该通行证对用户可见是隐藏的
对话，但它可以读取最近的交流，以决定是否进行
存在后续行动。

存储的承诺是本地 OpenClaw 状态。它们是操作内存，而不是
长期记忆。禁用该功能：

```bash
openclaw config set commitments.enabled false
```

## 故障排除

如果预期的后续行动没有出现：

- 确认 `commitments.enabled` 是 `true`。
- 检查 `openclaw commitments --all` 是否有待处理、已驳回、已暂停或已过期
  记录。
- 确保智能体正在运行心跳。
- 检查是否已达到 `commitments.maxPerDay`
  智能体会话。
- 请记住，承诺提取会跳过确切的提醒，因此应该
  而是出现在 [计划任务](/automation/cron-jobs) 下。

## 相关

- [内存概述](/concepts/memory)
- [活动内存](/concepts/active-memory)
- [心跳](/gateway/heartbeat)
- [计划任务](/automation/cron-jobs)
- [`openclaw commitments`](/cli/commitments)
- [配置参考](/gateway/configuration-reference#commitments)
