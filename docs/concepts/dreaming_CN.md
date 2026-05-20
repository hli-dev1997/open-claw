---
summary: "Background memory consolidation with light, deep, and REM phases plus a Dream Diary"
title: "Dreaming"
sidebarTitle: "Dreaming"
read_when:
  - You want memory promotion to run automatically
  - You want to understand what each dreaming phase does
  - You want to tune consolidation without polluting MEMORY.md
---

Dreaming是`memory-core`中的后台内存整合系统。它有助于 OpenClaw 将强烈的短期信号转移到持久记忆中，同时保持过程可解释和可审查。

<Note>
做梦是**选择加入**并且默认禁用。
</Note>

## 梦想写了什么

做梦保留两种输出：

- `memory/.dreams/` 中的**机器状态**（召回存储、阶段信号、摄取检查点、锁定）。
- `DREAMS.md`（或现有的 `dreams.md`）中的**人类可读输出**以及 `memory/dreaming/<phase>/YYYY-MM-DD.md` 下的可选阶段报告文件。

长期升级仍然只写入`MEMORY.md`。

## 相模型

Dreaming 使用三个合作阶段：

|相|目的|耐用书写 |
| -----| ---------------------------------------------------- | ----------------- |
|光|整理并整理近期短期材料|没有 |
|深|对持久的候选人进行评分和提拔|是 (`MEMORY.md`) |
| REM |反思主题和反复出现的想法|没有 |

这些阶段是内部实现细节，而不是单独的用户配置的“模式”。

<AccordionGroup>
  <Accordion title="Light phase">
    光阶段摄取最近的日常记忆信号并回忆痕迹，删除重复数据，并暂存候选行。

    - 读取短期回忆状态、最近的日常记忆文件以及经过编辑的会话记录（如果有）。
    - 当存储包含内联输出时，写入托管 `## Light Sleep` 块。
    - 记录强化信号以供以后深度排名。
    - 从不写入 `MEMORY.md`。

  </Accordion>
  <Accordion title="Deep phase">
    深度阶段决定什么成为长期记忆。

    - 使用加权评分和阈值门对候选人进行排名。
    - 需要 `minScore`、`minRecallCount` 和 `minUniqueQueries` 才能通过。
    - 在写入之前重新水合实时日常文件中的片段，因此会跳过陈旧/已删除的片段。
    - 将升级条目附加到 `MEMORY.md`。
    - 将 `## Deep Sleep` 摘要写入 `DREAMS.md` 并可选择写入 `memory/dreaming/deep/YYYY-MM-DD.md`。

  </Accordion>
  <Accordion title="REM phase">
    REM 相位提取图案和反射信号。

    - 根据最近的短期轨迹构建主题和反思摘要。
    - 当存储包含内联输出时，写入托管 `## REM Sleep` 块。
    - 记录深度排名使用的REM强化信号。
    - 从不写入 `MEMORY.md`。

  </Accordion>
</AccordionGroup>

## 会话记录摄取

做梦可以将经过编辑的会话记录摄取到做梦语料库中。当转录本可用时，它们会与日常记忆信号和回忆痕迹一起进入光阶段。个人内容和敏感内容在摄入前经过编辑。

## 梦想日记

梦还在`DREAMS.md`中保留了一篇叙述性的**梦日记**。每个阶段都有足够的材料后，`memory-core` 会尽力运行后台子智能体轮次并附加一个简短的日记条目。除非配置了 `dreaming.model` ，否则它使用默认的运行时模型。如果配置的模型不可用，梦想日记会使用会话默认模型重试一次。

<Note>
本日记仅供梦境UI中的人类阅读，并非推广来源。梦境生成的日记/报告制品不包括在短期促销中。只有接地内存片段才有资格升级为 `MEMORY.md`。
</Note>

还有一个接地的历史回填通道，用于审查和恢复工作：

<AccordionGroup>
  <Accordion title="Backfill commands">
    - `memory rem-harness --path ... --grounded` 预览历史 `YYYY-MM-DD.md` 笔记中的接地日记输出。
    - `memory rem-backfill --path ...` 将可逆接地日记条目写入 `DREAMS.md`。
    - `memory rem-backfill --path ... --stage-short-term` 阶段将持久候选者扎根到正常深度阶段已使用的相同短期证据存储中。
    - `memory rem-backfill --rollback` 和 `--rollback-short-term` 删除那些分阶段回填工件，而不触及普通日记条目或实时短期回忆。

  </Accordion>
</AccordionGroup>

Control UI 公开了相同的日记回填/重置流程，因此你可以在决定被禁足的候选人是否值得晋升之前检查“梦想”场景中的结果。该场景还显示了一个明显的接地通道，因此你可以看到哪些分阶段的短期条目来自历史重播，哪些促销项目是接地主导的，并且仅清除仅接地的分阶段条目，而不触及普通的实时短期状态。

## 深度排名信号

深度排名使用六个加权基本信号加上相位强化：

| Signal |重量 |描述 |
| ------------------- | ------ | ------------------------------------------------- |
|频率| 0.24 | 0.24入场累积了多少短期信号|
|相关性 | 0.30 | 0.30条目的平均检索质量 |
|查询多样性 | 0.15 | 0.15出现的不同查询/日期上下文 |
|近期 | 0.15 | 0.15随时间衰减的新鲜度得分 |
|整合| 0.10 | 0.10多日复发强度 |
|概念丰富性| 0.06 | 0.06片段/路径中的概念标签密度 |

光和 REM 阶段命中增加了 `memory/.dreams/phase-signals.json` 的小幅近期衰减提升。

## 调度

启用后，`memory-core` 自动管理一个 cron 作业以进行全面的梦想扫描。每次扫描按顺序运行阶段：浅→REM→深。

默认节奏行为：

|设置|默认 |
| -------------------- | ------------- |
| `dreaming.frequency` | `0 3 * * *` |
| `dreaming.model` |默认模型 |

## 快速开始

<Tabs>
  <Tab title="Enable dreaming">
    ```json
    {
      "plugins": {
        "entries": {
          "memory-core": {
            "config": {
              "dreaming": {
                "enabled": true
              }
            }
          }
        }
      }
    }
    ```
  </Tab>
  <Tab title="Custom sweep cadence">
    ```json
    {
      "plugins": {
        "entries": {
          "memory-core": {
            "config": {
              "dreaming": {
                "enabled": true,
                "timezone": "America/Los_Angeles",
                "frequency": "0 */6 * * *"
              }
            }
          }
        }
      }
    }
    ```
  </Tab>
</Tabs>

## 斜线命令

```
/dreaming status
/dreaming on
/dreaming off
/dreaming help
```

## CLI 工作流程

<Tabs>
  <Tab title="Promotion preview / apply">
    ```bash
    openclaw memory promote
    openclaw memory promote --apply
    openclaw memory promote --limit 5
    openclaw memory status --deep
    ```

    手动 `memory promote` 默认使用深相位阈值，除非用 CLI 标志覆盖。

  </Tab>
  <Tab title="Explain promotion">
    解释为什么特定候选人会或不会晋升：

    ```bash
    openclaw memory promote-explain "router vlan"
    openclaw memory promote-explain "router vlan" --json
    ```

  </Tab>
  <Tab title="REM harness preview">
    无需编写任何内容即可预览 REM 反思、候选真理和深度提升输出：

    ```bash
    openclaw memory rem-harness
    openclaw memory rem-harness --json
    ```

  </Tab>
</Tabs>

## 主要默认值

所有设置都位于 `plugins.entries.memory-core.config.dreaming` 下。

<ParamField path="enabled" type="boolean" default="false">
  启用或禁用梦想扫描。
</ParamField>
<ParamField path="frequency" type="string" default="0 3 * * *">
  全面梦想扫描的 Cron 节奏。
</ParamField>
<ParamField path="model" type="string">
  可选的梦想日记子智能体模型覆盖。在设置子智能体 `allowedModels` 允许列表时，请使用规范的 `provider/model` 值。
</ParamField>

<Warning>
`dreaming.model` 需要 `plugins.entries.memory-core.subagent.allowModelOverride: true`。要限制它，还需设置 `plugins.entries.memory-core.subagent.allowedModels`。信任或白名单失败保持可见，而不是默默地退回；重试仅涵盖模型不可用的错误。
</Warning>

<Note>
阶段策略、阈值和存储行为是内部实现细节（不是面向用户的配置）。有关完整按键列表，请参阅[内存配置参考](/reference/memory-config#dreaming)。
</Note>

## 梦想 UI

启用后，Gateway **Dreams** 选项卡显示：

- 当前的梦想启用状态
- 阶段级状态和管理扫描存在
- 短期的、扎根的、信号的和今天提升的计数
- 下一次预定的运行时间
- 一个独特的接地场景通道，用于上演历史重播条目
- 由 `doctor.memory.dreamDiary` 支持的可扩展梦想日记阅读器

## 相关

- [内存](/concepts/memory)
- [内存CLI](/cli/memory)
- [内存配置参考](/reference/memory-config)
- [内存搜索](/concepts/memory-search)
