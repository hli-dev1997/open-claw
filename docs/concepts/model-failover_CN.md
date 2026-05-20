---
summary: "How OpenClaw rotates auth profiles and falls back across models"
read_when:
  - Diagnosing auth profile rotation, cooldowns, or model fallback behavior
  - Updating failover rules for auth profiles or models
  - Understanding how session model overrides interact with fallback retries
title: "Model failover"
sidebarTitle: "Model failover"
---

OpenClaw 分两个阶段处理故障：

1. **当前提供商内的认证配置文件轮换**。
2. **模型回退**到 `agents.defaults.model.fallbacks` 中的下一个模型。

本文档解释了运行时规则以及支持它们的数据。

## 运行时流程

对于正常的文本运行，OpenClaw 按以下顺序评估候选者：

<Steps>
  <Step title="Resolve session state">
    解析活动会话模型和认证配置文件首选项。
  </Step>
  <Step title="Build candidate chain">
    根据当前模型选择和该选择源的后备策略构建模型候选链。配置的默认值、cron 作业主要和自动选择的回退模型可以使用配置的回退；显式用户会话选择是严格的。
  </Step>
  <Step title="Try the current provider">
    尝试使用认证配置文件轮换/冷却规则的当前提供商。
  </Step>
  <Step title="Advance on failover-worthy errors">
    如果该提供商因发生值得故障转移的错误而疲惫不堪，则转向下一个候选模型。
  </Step>
  <Step title="Persist fallback override">
    在重试开始之前保留所选的回退覆盖，以便其他会话读者看到运行程序将要使用的相同提供商/模型。持久模型覆盖标记为 `modelOverrideSource: "auto"`。
  </Step>
  <Step title="Roll back narrowly on failure">
    如果回退候选者失败，则仅回滚回退拥有的会话覆盖字段（当它们仍然与失败的候选者匹配时）。
  </Step>
  <Step title="Throw FallbackSummaryError if exhausted">
    如果每个候选人都失败了，请抛出一个 `FallbackSummaryError` ，其中包含每次尝试的详细信息以及已知的最快冷却时间。
  </Step>
</Steps>

这故意比“保存和恢复整个会话”更窄。回复运行器仅保留其拥有的模型选择字段以供后备：

- `providerOverride`
- `modelOverride`
- `modelOverrideSource`
- `authProfileOverride`
- `authProfileOverrideSource`
- `authProfileOverrideCompactionCount`

这可以防止失败的回退重试覆盖较新的不相关会话突变，例如尝试运行时发生的手动 `/model` 更改或会话轮换更新。

## 选择来源策略

OpenClaw 将所选提供商/模型与其选择原因分开。该源控制是否允许后备链：

- **配置默认值**：`agents.defaults.model.primary` 使用 `agents.defaults.model.fallbacks`。
- **智能体主**：`agents.list[].model` 是严格的，除非该智能体模型对象包含其自己的 `fallbacks`。使用 `fallbacks: []` 使严格行为明确，或提供非空列表以选择该智能体进入模型回退。
- **自动回退覆盖**：运行时回退在重试之前写入 `providerOverride`、`modelOverride` 和 `modelOverrideSource: "auto"`。该自动覆盖可以继续遍历配置的后备链，并由 `/new`、`/reset` 和 `sessions.reset` 清除。
- **用户会话覆盖**：`/model`、模型选择器、`session_status(model=...)` 和 `sessions.patch` 写入 `modelOverrideSource: "user"`。这是一个精确的会话选择。如果选定的提供商/模型在生成回复之前失败，OpenClaw 会报告失败，而不是从不相关的配置回退进行应答。
- **旧会话覆盖**：旧会话条目可能有 `modelOverride`，但没有 `modelOverrideSource`。 OpenClaw 将这些视为用户覆盖，因此显式旧选择不会默默地转换为后备行为。
- **Cron 负载模型**：cron 作业 `payload.model` / `--model` 是主要作业，而不是用户会话覆盖。它使用配置的后备，除非作业提供 `payload.fallbacks`； `payload.fallbacks: []` 使 cron 严格运行。

## 认证存储（密钥 + OAuth）

OpenClaw 对 API 密钥和 OAuth token使用**认证配置文件**。

- 秘密存在于 `~/.openclaw/agents/<agentId>/agent/auth-profiles.json` （旧版本：`~/.openclaw/agent/auth-profiles.json`）。
- 运行时认证路由状态位于 `~/.openclaw/agents/<agentId>/agent/auth-state.json` 中。
- 配置 `auth.profiles` / `auth.order` 是 **仅元数据 + 路由**（无秘密）。
- 旧版仅导入 OAuth 文件：`~/.openclaw/credentials/oauth.json`（首次使用时导入到 `auth-profiles.json`）。

更多详细信息：[OAuth](/concepts/oauth)

凭证类型：

- `type: "api_key"` → `{ provider, key }`
- `type: "oauth"` → `{ provider, access, refresh, expires, email? }` （+ `projectId`/`enterpriseUrl` 对于某些提供商）

## 配置文件 ID

OAuth 登录创建不同的配置文件，以便多个帐户可以共存。

- 默认值：`provider:default`（当没有可用电子邮件时）。
- 带有电子邮件的 OAuth：`provider:<email>`（例如 `google-antigravity:user@gmail.com`）。

配置文件位于 `~/.openclaw/agents/<agentId>/agent/auth-profiles.json` 下的 `profiles` 中。

## 轮换顺序

当提供商有多个配置文件时，OpenClaw 选择如下顺序：

<Steps>
  <Step title="Explicit config">
    `auth.order[provider]`（如果设置）。
  </Step>
  <Step title="Configured profiles">
    `auth.profiles` 由提供商过滤。
  </Step>
  <Step title="Stored profiles">
    提供商的 `auth-profiles.json` 中的条目。
  </Step>
</Steps>

如果未配置显式顺序，则 OpenClaw 使用循环顺序：

- **主键：**配置文件类型（**OAuth 在 API 键之前**）。
- **辅助键：** `usageStats.lastUsed`（每种类型中，最旧的在前）。
- **冷却/禁用配置文件**移至末尾，按最早到期时间排序。

### 会话粘性（缓存友好）

OpenClaw **固定每个会话所选的认证配置文件**以保持提供商缓存的温暖。它**不会**根据每个请求轮换。固定的配置文件将被重复使用，直到：

- 会话被重置 (`/new` / `/reset`)
- 压缩完成（压缩计数增量）
- 个人资料处于冷却/禁用状态

通过 `/model …@<profileId>` 手动选择为该会话设置 **用户覆盖**，并且在新会话开始之前不会自动轮换。

<Note>
自动固定配置文件（由会话路由器选择）被视为**首选项**：首先尝试它们，但 OpenClaw 可能会在速率限制/超时时轮换到另一个配置文件。用户固定的个人资料保持锁定到该个人资料；如果失败并且配置了模型回退，则 OpenClaw 移动到下一个模型而不是切换配置文件。
</Note>

### 为什么 OAuth 会“看起来迷失”

如果你同时拥有同一提供商的 OAuth 配置文件和 API 密钥配置文件，则循环可以跨消息在它们之间进行切换，除非已固定。强制使用单个配置文件：

- 用 `auth.order[provider] = ["provider:profileId"]` 固定，或
- 通过 `/model …` 使用每会话覆盖和配置文件覆盖（当你的 UI/聊天界面支持时）。

## 冷却时间

当配置文件由于认证/速率限制错误（或看起来像速率限制的超时）而失败时，OpenClaw 将其标记为冷却状态并移至下一个配置文件。

<AccordionGroup>
  <Accordion title="What lands in the rate-limit / timeout bucket">
    该速率限制桶比普通的 `429` 更广泛：它还包括提供商消息，例如 `Too many concurrent requests`、`ThrottlingException`、`concurrency limit reached`、`workers_ai ... quota limit exceeded`、`throttled`、 `resource exhausted`，以及定期使用窗口限制，例如 `weekly/monthly limit reached`。

    格式/无效请求错误（例如 Cloud Code Assist 工具调用 ID 验证失败）被视为值得进行故障转移并使用相同的冷却时间。 OpenAI 兼容的停止原因错误（例如 `Unhandled stop reason: error`、`stop reason: error` 和 `reason: error`）被归类为超时/故障转移信号。

    当源与已知的瞬态模式匹配时，通用服务器文本也可以落在该超时桶中。例如，裸露的 pi-ai 流包装消息 `An unknown error occurred` 被视为对于每个提供商都具有故障转移价值，因为当提供商流以 `stopReason: "aborted"` 或 `stopReason: "error"` 结尾而没有具体细节时，pi-ai 会发出该消息。具有瞬态服务器文本的 JSON `api_error` 有效负载（例如 `internal server error`、`unknown error, 520`、`upstream error` 或 `backend error`）也被视为值得故障转移的超时。

    仅当提供商上下文实际上是 OpenRouter 时，OpenRouter 特定的通用上游文本（例如裸 `Provider returned error`）才会被视为超时。通用内部后备文本（例如 `LLM request failed with an unknown error.`）保持保守，不会自行触发故障转移。

  </Accordion>
  <Accordion title="SDK retry-after caps">
    否则，某些提供商 SDK 可能会在将控制权返回到 OpenClaw 之前休眠较长的 `Retry-After` 窗口。对于基于不锈钢的 SDK，例如 Anthropic 和 OpenAI，OpenClaw caps SDK-internal `retry-after-ms` / `retry-after` 默认情况下等待 60 秒并显示立即发出更长的可重试响应，以便可以运行此故障转移路径。使用 `OPENCLAW_SDK_RETRY_MAX_WAIT_SECONDS` 调整或禁用上限；请参阅[重试行为](/concepts/retry)。
  </Accordion>
  <Accordion title="Model-scoped cooldowns">
    速率限制冷却时间也可以是模型范围的：

    - 当失败的模型 ID 已知时，OpenClaw 记录 `cooldownModel` 用于速率限制失败。
    - 当冷却时间范围为不同模型时，仍然可以尝试同一提供商上的同级模型。
    - 计费/禁用窗口仍然阻止跨模型的整个配置文件。

  </Accordion>
</AccordionGroup>

冷却时间使用指数退避：

- 1 分钟
- 5分钟
- 25 分钟
- 1 小时（上限）

状态存储在 `auth-state.json` 下的 `usageStats` 中：

```json
{
  "usageStats": {
    "provider:profile": {
      "lastUsed": 1736160000000,
      "cooldownUntil": 1736160600000,
      "errorCount": 2
    }
  }
}
```

## 计费禁用

计费/信用失败（例如“信用不足”/“信用余额太低”）被视为值得进行故障转移，但它们通常不是暂时的。 OpenClaw 不是短暂的冷却时间，而是将配置文件标记为**禁用**（具有较长的退避时间）并轮换到下一个配置文件/提供商。

<Note>
并非每个帐单形状的响应都是 `402`，也不是每个 HTTP `402` 都会到达这里。即使提供商返回 `401` 或 `403`，OpenClaw 也会在计费通道中保留显式计费文本，但特定于提供商的匹配器的范围仍限于拥有它们的提供商（例如 OpenRouter `403 Key limit exceeded`）。

同时，当消息看起来可重试时，临时 `402` 使用窗口和组织/工作区支出限制错误被分类为 `rate_limit`（例如 `weekly usage limit exhausted`、`daily limit reached, resets tomorrow` 或 `organization spending limit exceeded`）。它们停留在较短的冷却/故障转移路径上，而不是较长的计费禁用路径上。
</Note>

状态存储在 `auth-state.json` 中：

```json
{
  "usageStats": {
    "provider:profile": {
      "disabledUntil": 1736178000000,
      "disabledReason": "billing"
    }
  }
}
```

默认值：

- 计费退避从**5 小时**开始，每次计费失败加倍，上限为**24 小时**。
- 如果配置文件在 **24 小时** 内没有失败（可配置），则退避计数器重置。
- 重载重试允许在模型回退之前**1 次相同提供商配置文件轮换**。
- 重载重试默认使用 **0 毫秒退避**。

## 模型回退

如果提供商的所有配置文件均失败，则 OpenClaw 会移至 `agents.defaults.model.fallbacks` 中的下一个模型。这适用于认证失败、速率限制和耗尽配置文件轮换的超时（其他错误不会推进回退）。未公开足够详细信息的提供商错误仍会在后备状态中精确标记：`empty_response` 表示提供商未返回可用的消息或状态，`no_error_details` 表示提供商显式返回 `Unknown error (no error details in response)`，`unclassified` 表示 OpenClaw 保留原始预览，但还没有分类器匹配它。

超载和速率限制错误的处理比计费冷却更积极。默认情况下，OpenClaw 允许同一提供商的认证配置文件重试，然后切换到下一个配置的模型后备，无需等待。诸如 `ModelNotReadyException` 之类的提供商繁忙信号落在该超载的桶中。使用 `auth.cooldowns.overloadedProfileRotations`、`auth.cooldowns.overloadedBackoffMs` 和 `auth.cooldowns.rateLimitedProfileRotations` 进行调整。

当运行从配置的默认主数据库、cron 作业主数据库、具有显式回退的智能体主数据库或自动选择的回退覆盖开始时，OpenClaw 可以遍历匹配的配置回退链。没有显式后备和显式用户选择的智能体主选（例如 `/model ollama/qwen3.5:27b`、模型选择器、`sessions.patch` 或一次性 CLI 提供商/模型覆盖）是严格的：如果该提供商/模型在生成回复之前无法访问或失败，则 OpenClaw 会报告失败从不相关的后备中回答。

### 候选链规则

OpenClaw 从当前请求的 `provider/model` 加上配置的后备构建候选列表。

<AccordionGroup>
  <Accordion title="Rules">
    - 所请求的模型始终是第一位的。
    - 显式配置的后备会进行重复数据删除，但不会被模型白名单过滤。它们被视为明确的操作员意图。
    - 如果当前运行已在同一提供商系列中配置的后备上，则 OpenClaw 继续使用完整配置的链。
    - 如果当前运行在与配置不同的提供商上，并且当前模型还不是配置的后备链的一部分，则 OpenClaw 不会附加来自另一个提供商的不相关的配置后备。
    - 当没有明确的后备覆盖提供给后备运行器时，配置的主要会附加在末尾，以便一旦较早的候选者耗尽，链就可以恢复到正常默认值。
    - 当调用者提供 `fallbacksOverride` 时，运行程序将完全使用请求的模型加上覆盖列表。空列表会禁用模型回退，并防止将配置的主数据库附加为隐藏的重试目标。

  </Accordion>
</AccordionGroup>

### 哪些错误会提前回退

<Tabs>
  <Tab title="Continues on">
    - 认证失败
    - 速率限制和冷却耗尽
    - 过载/提供商繁忙错误
    - 超时型故障转移错误
    - 计费禁用
    - `LiveSessionModelSwitchError`，它被标准化为故障转移路径，因此过时的持久模型不会创建外部重试循环
    - 仍有剩余候选人时的其他无法识别的错误

  </Tab>
  <Tab title="Does not continue on">
    - 不是超时/故障转移形状的显式中止
    - 应保留在压缩/重试逻辑内的上下文溢出错误（例如 `request_too_large`、`INVALID_ARGUMENT: input exceeds the maximum number of tokens`、`input token count exceeds the maximum number of input tokens`、`The input is too long for the model` 或 `ollama error: context length exceeded`）
    - 当没有候选人留下时，最后的未知错误

  </Tab>
</Tabs>

### 冷却跳过与探测行为

当提供商的每个认证配置文件已处于冷却状态时，OpenClaw 不会自动永远跳过该提供商。它针对每个候选人做出决定：

<AccordionGroup>
  <Accordion title="Per-candidate decisions">
    - 持续的认证失败会立即跳过整个提供商。
    - 计费禁用通常会跳过，但仍然可以在节流阀上探测主要候选者，因此无需重新启动即可恢复。
    - 主要候选者可能会在冷却时间到期时被探测，并按提供商进行限制。
    - 当故障看起来是暂时的（`rate_limit`、`overloaded` 或未知）时，尽管有冷却时间，仍可以尝试相同提供商的后备同级。当速率限制是模型范围内的并且同级模型仍可能立即恢复时，这一点尤其重要。
    - 瞬态冷却探针仅限于每个提供商每次回退运行一个，因此单个提供商不会阻止跨提供商回退。

  </Accordion>
</AccordionGroup>

## 会话覆盖和实时模型切换

会话模型的更改是共享状态。活动运行程序、`/model` 命令、压缩/会话更新和实时会话协调所有读取或写入同一会话条目的部分。

这意味着回退重试必须与实时模型切换协调：

- 只有明确的用户驱动的模型更改才会标记待定的实时切换。其中包括 `/model`、`session_status(model=...)` 和 `sessions.patch`。
- 系统驱动的模型更改（例如回退旋转、心跳覆盖或压缩）永远不会自行标记待处理的实时切换。
- 用户驱动的模型覆盖被视为后备策略的精确选择，因此无法访问的选定提供商会显示为失败，而不是被 `agents.defaults.model.fallbacks` 掩盖。
- 在回退重试开始之前，回复运行程序会将选定的回退覆盖字段保留到会话条目中。
- 自动回退覆盖在后续回合中保持选中状态，因此 OpenClaw 不会在每条消息上探测已知的错误主节点。 `/new`、`/reset` 和 `sessions.reset` 清除自动源覆盖并将会话返回到配置的默认值。
- `/status` 显示所选模型，并且当回退状态不同时，显示活动回退模型和原因。
- 实时会话协调更喜欢持久会话覆盖过时的运行时模型字段。
- 如果实时切换错误指向活动后备链中较晚的候选者，OpenClaw 会直接跳转到该选定的模型，而不是首先遍历不相关的候选者。
- 如果回退尝试失败，则运行程序仅回滚其写入的覆盖字段，并且仅当它们仍然与失败的候选字段匹配时。

这可以防止经典的竞赛：

<Steps>
  <Step title="Primary fails">
    所选的主要模型失败。
  </Step>
  <Step title="Fallback chosen in memory">
    在内存中选择后备候选者。
  </Step>
  <Step title="Session store still says old primary">
    会话存储仍然反映旧的主存储。
  </Step>
  <Step title="Live reconciliation reads stale state">
    实时会话协调读取过时的会话状态。
  </Step>
  <Step title="Retry snapped back">
    在回退尝试开始之前，重试会恢复到旧模型。
  </Step>
</Steps>

持久回退覆盖会关闭该窗口，而窄回滚会保持较新的手动或运行时会话更改完好无损。

## 可观察性和失败总结

`runWithModelFallback(...)` 记录每次尝试的详细信息，以提供日志和面向用户的冷却消息：

- 提供商/模型尝试
- 原因（`rate_limit`、`overloaded`、`billing`、`auth`、`model_not_found` 和类似的故障转移原因）
- 可选状态/代码
- 人类可读的错误摘要

当候选失败、被跳过或稍后回退成功时，结构化 `model_fallback_decision` 日志还包含平面 `fallbackStep*` 字段。这些字段使尝试的转换变得明确（`fallbackStepFromModel`、`fallbackStepToModel`、`fallbackStepFromFailureReason`、`fallbackStepFromFailureDetail`、`fallbackStepFinalOutcome`），因此即使终端回退也失败，日志和诊断导出程序也可以重建主要故障。

当每个候选者失败时，OpenClaw 抛出 `FallbackSummaryError`。外部回复运行器可以使用它来构建更具体的消息，例如“所有模型都暂时受到速率限制”，并包括已知的最快冷却到期时间。

该冷却摘要是模型感知的：

- 对于尝试的提供商/模型链，忽略不相关的模型范围的速率限制
- 如果剩余的块是匹配的模型范围的速率限制，则 OpenClaw 报告仍阻止该模型的最后一个匹配到期时间

## 相关配置

请参阅 [Gateway 配置](/gateway/configuration) 了解：

- `auth.profiles` / `auth.order`
- `auth.cooldowns.billingBackoffHours` / `auth.cooldowns.billingBackoffHoursByProvider`
- `auth.cooldowns.billingMaxHours` / `auth.cooldowns.failureWindowHours`
- `auth.cooldowns.overloadedProfileRotations` / `auth.cooldowns.overloadedBackoffMs`
- `auth.cooldowns.rateLimitedProfileRotations`
- `agents.defaults.model.primary` / `agents.defaults.model.fallbacks`
- `agents.defaults.imageModel` 路由

有关更广泛的模型选择和后备概述，请参阅[模型](/concepts/models)。
