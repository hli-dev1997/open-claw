---
summary: "Models CLI: list, set, aliases, fallbacks, scan, status"
read_when:
  - Adding or modifying models CLI (models list/set/scan/aliases/fallbacks)
  - Changing model fallback behavior or selection UX
  - Updating model scan probes (tools/images)
title: "Models CLI"
sidebarTitle: "Models CLI"
---

<CardGroup cols={2}>
  <Card title="Model failover" href="/concepts/model-failover">
    认证配置文件轮换、冷却时间以及其与后备的交互方式。
  </Card>
  <Card title="Model providers" href="/concepts/model-providers">
    快速提供商概述和示例。
  </Card>
  <Card title="Agent runtimes" href="/concepts/agent-runtimes">
    PI、Codex 和其他智能体循环运行时。
  </Card>
  <Card title="Configuration reference" href="/gateway/config-agents#agent-defaults">
    模型配置键。
  </Card>
</CardGroup>

模型裁判选择提供商和模型。他们通常不会选择低级智能体运行时。例如，`openai/gpt-5.5` 可以通过正常的 OpenAI 提供商路径或通过 Codex 应用服务器运行时运行，具体取决于 `agents.defaults.agentRuntime.id`。请参阅[智能体运行时](/concepts/agent-runtimes)。

## 模型选择的工作原理

OpenClaw 按以下顺序选择模型：

<Steps>
  <Step title="Primary model">
    `agents.defaults.model.primary`（或`agents.defaults.model`）。
  </Step>
  <Step title="Fallbacks">
    `agents.defaults.model.fallbacks`（按顺序）。
  </Step>
  <Step title="Provider auth failover">
    在转移到下一个模型之前，认证故障转移发生在提供商内部。
  </Step>
</Steps>

<AccordionGroup>
  <Accordion title="Related model surfaces">
    - `agents.defaults.models` 是 OpenClaw 可以使用的模型的允许列表/目录（加上别名）。
    - **仅当**主模型无法接受图像时才使用 `agents.defaults.imageModel`。
    - `agents.defaults.pdfModel` 由 `pdf` 工具使用。如果省略，该工具将回退到 `agents.defaults.imageModel`，然后是解析的会话/默认模型。
    - `agents.defaults.imageGenerationModel` 由共享图像生成功能使用。如果省略，`image_generate` 仍然可以推断出支持认证的提供商默认值。它首先尝试当前的默认提供商，然后按照提供商 ID 的顺序尝试其余已注册的图像生成提供商。如果你设置特定的提供商/模型，还需配置该提供商的 auth/API 密钥。
    - `agents.defaults.musicGenerationModel` 由共享音乐生成功能使用。如果省略，`music_generate` 仍然可以推断出支持认证的提供商默认值。它首先尝试当前的默认提供商，然后按照提供商 ID 的顺序尝试其余已注册的音乐生成提供商。如果你设置特定的提供商/模型，还需配置该提供商的 auth/API 密钥。
    - `agents.defaults.videoGenerationModel` 由共享视频生成功能使用。如果省略，`video_generate` 仍然可以推断出支持认证的提供商默认值。它首先尝试当前的默认提供商，然后按照提供商 ID 的顺序尝试其余已注册的视频生成提供商。如果你设置特定的提供商/模型，还需配置该提供商的 auth/API 密钥。
    - 每个智能体默认值可以通过 `agents.list[].model` 加上绑定覆盖 `agents.defaults.model` （请参阅[多智能体路由](/concepts/multi-agent)）。

  </Accordion>
</AccordionGroup>

## 选择源和后备行为

相同的 `provider/model` 可能意味着不同的含义，具体取决于它的来源：

- 配置的默认值（`agents.defaults.model.primary` 和特定于智能体的主色）是正常起点并使用 `agents.defaults.model.fallbacks`。
- 自动回退选择是临时恢复状态。它们与 `modelOverrideSource: "auto"` 一起存储，因此后面的回合可以继续使用后备链，而无需首先探测已知的错误主链。
- 用户会话选择是准确的。 `/model`，模型选择器，`session_status(model=...)`，和`sessions.patch`存储`modelOverrideSource: "user"`；如果所选的提供商/模型无法访问，则 OpenClaw 会明显失败，而不是转到另一个配置的模型。
- Cron `--model` / Payload `model` 是每个作业的主要任务。它仍然使用配置的后备，除非作业提供显式负载 `fallbacks` （使用 `fallbacks: []` 进行严格的 cron 运行）。
- CLI 默认模型和白名单选择器通过列出显式 `models.providers.*.models` 而不是加载完整的内置目录来尊重 `models.mode: "replace"`。
- Control UI 模型选择器向 Gateway 询问其配置的模型视图：`agents.defaults.models`（如果存在），否则显式 `models.providers.*.models` 加上具有可用认证的提供商。完整的内置目录保留用于显式浏览视图，例如 `models.list` 和 `view: "all"` 或 `openclaw models list --all`。

## 快速模型策略

- 将你的主要模型设置为你可用的最强的最新一代模型。
- 对成本/延迟敏感的任务和风险较低的聊天使用后备。
- 对于支持工具的智能体或不受信任的输入，请避免使用较旧/较弱的模型层。

## 入门（推荐）

如果你不想手动编辑配置，请运行 onboarding：

```bash
openclaw onboard
```

它可以为常见的提供商设置模型+认证，包括**OpenAI代码（Codex）订阅**（OAuth）和**Anthropic**（API密钥或Claude CLI)。

## 配置键（概述）

- `agents.defaults.model.primary` 和 `agents.defaults.model.fallbacks`
- `agents.defaults.imageModel.primary` 和 `agents.defaults.imageModel.fallbacks`
- `agents.defaults.pdfModel.primary` 和 `agents.defaults.pdfModel.fallbacks`
- `agents.defaults.imageGenerationModel.primary` 和 `agents.defaults.imageGenerationModel.fallbacks`
- `agents.defaults.videoGenerationModel.primary` 和 `agents.defaults.videoGenerationModel.fallbacks`
- `agents.defaults.models`（白名单+别名+提供商参数）
- `models.providers`（写入 `models.json` 的自定义提供商）

<Note>
模型引用标准化为小写。诸如 `z.ai/*` 之类的提供商别名标准化为 `zai/*`。

提供商配置示例（包括 OpenCode）位于 [OpenCode](/providers/opencode) 中。
</Note>

### 安全许可名单编辑

手动更新 `agents.defaults.models` 时使用附加写入：

```bash
openclaw config set agents.defaults.models '{"openai/gpt-5.4":{}}' --strict-json --merge
```

<AccordionGroup>
  <Accordion title="Clobber protection rules">
    `openclaw config set` 保护模型/提供商映射免受意外破坏。当删除现有条目时，对 `agents.defaults.models`、`models.providers` 或 `models.providers.<id>.models` 的普通对象分配将被拒绝。使用 `--merge` 进行附加更改；仅当提供的值应成为完整的目标值时才使用 `--replace`。

    交互式提供商设置和 `openclaw configure --section model` 还会将提供商范围内的选择合并到现有允许列表中，因此添加 Codex、Ollama 或其他提供商不会删除不相关的模型条目。重新应用提供商认证时，配置会保留现有的 `agents.defaults.model.primary`。显式默认设置命令（例如 `openclaw models auth login --provider <id> --set-default` 和 `openclaw models set <model>` ）仍会替换 `agents.defaults.model.primary`。

  </Accordion>
</AccordionGroup>

##“不允许使用模型”（以及为什么回复停止）

如果设置了 `agents.defaults.models`，它将成为 `/model` 和会话覆盖的 **允许列表**。当用户选择不在该允许列表中的模型时，OpenClaw 返回：

```
Model "provider/model" is not allowed. Use /model to list available models.
```

<Warning>
这种情况发生在生成正常回复之前**，因此该消息可能会让人感觉“没有响应”。解决方法是：

- 将模型添加到 `agents.defaults.models`，或者
- 清除允许列表（删除 `agents.defaults.models`），或者
- 从 `/model list` 中选择一个模型。

</Warning>

对于 local/GGUF 模型，将完整的提供商前缀引用存储在白名单中，
例如 `ollama/gemma4:26b`、`lmstudio/Gemma4-26b-a4-it-gguf` 或
`openclaw models list --provider <provider>` 显示的确切提供商/模型。
当允许列表存在时，仅本地文件名或显示名称是不够的
活跃。

允许名单配置示例：

```json5
{
  agent: {
    model: { primary: "anthropic/claude-sonnet-4-6" },
    models: {
      "anthropic/claude-sonnet-4-6": { alias: "Sonnet" },
      "anthropic/claude-opus-4-6": { alias: "Opus" },
    },
  },
}
```

## 在聊天中切换模型 (`/model`)

你可以切换当前会话的模型而无需重新启动：

```
/model
/model list
/model 3
/model openai/gpt-5.4
/model status
```

<AccordionGroup>
  <Accordion title="Picker behavior">
    - `/model`（和 `/model list`）是一个紧凑的编号选择器（模型系列+可用的提供商）。
    - 在 Discord、`/model` 和 `/models` 上打开一个交互式选择器，其中包含提供商和模型下拉列表以及提交步骤。
    - `/models add` 已弃用，现在返回弃用消息，而不是从聊天中注册模型。
    - `/model <#>` 从该选择器中选择。

  </Accordion>
  <Accordion title="Persistence and live switching">
    - `/model` 立即保留新的会话选择。
    - 如果智能体空闲，下一次运行将立即使用新模型。
    - 如果运行已处于活动状态，OpenClaw 将实时切换标记为待处理，并且仅在干净的重试点重新启动到新模型。
    - 如果工具活动或回复输出已经开始，待处理的切换可以保持排队状态，直到稍后重试机会或下一个用户轮到。
    - 用户选择的 `/model` 引用对于该会话是严格的：如果所选提供商/模型无法访问，则回复明显失败，而不是从 `agents.defaults.model.fallbacks` 默默回复。这与配置的默认值和 cron 作业主要不同，后者仍然可以使用后备链。
    - `/model status` 是详细视图（认证候选者以及配置后的提供商端点 `baseUrl` + `api` 模式）。

  </Accordion>
  <Accordion title="Ref parsing">
    - 通过在**第一个** `/` 上拆分来解析模型引用。键入 `/model <ref>` 时使用 `provider/model`。
    - 如果模型 ID 本身包含 `/`（OpenRouter 样式），则必须包含提供商前缀（例如：`/model openrouter/moonshotai/kimi-k2`）。
    - 如果省略提供商，OpenClaw 将按以下顺序解析输入：
      1.别名匹配
      2. 与确切的无前缀模型 ID 匹配的唯一配置提供商
      3. 已弃用回退到配置的默认提供商 - 如果该提供商不再公开配置的默认模型，则 OpenClaw 会回退到第一个配置的提供商/模型，以避免出现陈旧的已删除提供商默认值。
  </Accordion>
</AccordionGroup>

完整命令行为/配置：[斜杠命令](/tools/slash-commands)。

## CLI 命令

```bash
openclaw models list
openclaw models status
openclaw models set <provider/model>
openclaw models set-image <provider/model>

openclaw models aliases list
openclaw models aliases add <alias> <provider/model>
openclaw models aliases remove <alias>

openclaw models fallbacks list
openclaw models fallbacks add <provider/model>
openclaw models fallbacks remove <provider/model>
openclaw models fallbacks clear

openclaw models image-fallbacks list
openclaw models image-fallbacks add <provider/model>
openclaw models image-fallbacks remove <provider/model>
openclaw models image-fallbacks clear
```

`openclaw models`（无子命令）是 `models status` 的快捷方式。

### `models list`

默认显示已配置/验证可用的模型。有用的标志：

<ParamField path="--all" type="boolean">
  完整目录。在配置认证之前包括捆绑的提供商拥有的静态目录行，因此仅发现视图可以显示在你添加匹配的提供商凭据之前不可用的模型。
</ParamField>
<ParamField path="--local" type="boolean">
  仅限本地提供商。
</ParamField>
<ParamField path="--provider <id>" 类型 = "字符串">
  按提供商 ID 过滤，例如 `moonshot`。不接受交互式选择器的显示标签。
</ParamField>
<ParamField path="--plain" type="boolean">
  每条线一个模型。
</ParamField>
<ParamField path="--json" type="boolean">
  机器可读的输出。
</ParamField>

### `models status`

显示已解析的主要模型、后备、图像模型以及已配置提供商的认证概述。它还显示在认证存储中找到的配置文件的 OAuth 到期状态（默认情况下在 24 小时内发出警告）。 `--plain` 仅打印已解析的主模型。

<AccordionGroup>
  <Accordion title="Auth and probe behavior">
    - 始终显示 OAuth 状态（并包含在 `--json` 输出中）。如果配置的提供商没有凭据，`models status` 会打印 **Missing auth** 部分。
    - JSON 包括 `auth.oauth` （警告窗口 + 配置文件）和 `auth.providers` （每个提供商的有效认证，包括环境支持的凭据）。 `auth.oauth` 仅是认证存储配置文件运行状况；仅限 env 的提供商不会出现在那里。
    - 使用 `--check` 进行自动化（丢失/过期时退出 `1`，过期时退出 `2`）。
    - 使用 `--probe` 进行实时认证检查；探测行可以来自认证配置文件、env 凭据或 `models.json`。
    - 如果显式 `auth.order.<provider>` 省略存储的配置文件，则探测会报告 `excluded_by_auth_order` 而不是尝试它。如果认证存在，但无法解析该提供商的可探测模型，则探测报告 `status: no_model`。

  </Accordion>
</AccordionGroup>

<Note>
认证选择取决于提供商/帐户。对于永远在线的网关主机，API 键通常是最可预测的；还支持 Claude CLI 重用和现有 Anthropic OAuth/token配置文件。
</Note>

示例（Claude CLI）：

```bash
claude auth login
openclaw models status
```

## 扫描（OpenRouter 免费模型）

`openclaw models scan` 检查 OpenRouter 的**免费模型目录**，并且可以选择探测模型的工具和图像支持。

<ParamField path="--no-probe" type="boolean">
  跳过实时探测（仅限元数据）。
</ParamField>
<ParamField path="--min-params <b>" 类型 = "数字">
  最小参数大小（十亿）。
</ParamField>
<ParamField path="--max-age-days <days>" 类型 = "数字">
  跳过旧模型。
</ParamField>
<ParamField path="--provider <name>" 类型 = "字符串">
  提供商前缀过滤器。
</ParamField>
<ParamField path="--max-candidates <n>" 类型 = "数字">
  后备列表大小。
</ParamField>
<ParamField path="--set-default" type="boolean">
  将 `agents.defaults.model.primary` 设置为第一个选择。
</ParamField>
<ParamField path="--set-image" type="boolean">
  将 `agents.defaults.imageModel.primary` 设置为第一个图像选择。
</ParamField>

<Note>
OpenRouter `/models` 目录是公共的，因此仅元数据扫描可以列出没有密钥的免费候选者。探测和推理仍然需要 OpenRouter API 密钥（来自认证配置文件或 `OPENROUTER_API_KEY`）。如果没有可用的密钥，`openclaw models scan` 会回退到仅元数据输出并保持配置不变。使用 `--no-probe` 显式请求仅元数据模式。
</Note>

扫描结果排名如下：

1. 图片支持
2. 工具延迟
3. 上下文大小
4. 参数个数

输入：

- OpenRouter `/models` 列表（过滤器 `:free`）
- 实时探针需要来自认证配置文件的 OpenRouter API 密钥或 `OPENROUTER_API_KEY` （请参阅[环境变量](/help/environment)）
- 可选过滤器：`--max-age-days`、`--min-params`、`--provider`、`--max-candidates`
- 请求/探测控制：`--timeout`、`--concurrency`

当实时探针在 TTY 中运行时，你可以交互选择后备。在非交互模式下，传递 `--yes` 以接受默认值。仅元数据结果仅供参考； `--set-default` 和 `--set-image` 需要实时探针，因此 OpenClaw 不会配置不可用的无钥匙 OpenRouter 模型。

## 模型注册表 (`models.json`)

`models.providers` 中的自定义提供商将写入智能体目录下的 `models.json` （默认为 `~/.openclaw/agents/<agentId>/agent/models.json`）。默认情况下会合并此文件，除非 `models.mode` 设置为 `replace`。

<AccordionGroup>
  <Accordion title="Merge mode precedence">
    匹配提供商 ID 的合并模式优先级：

    - 智能体 `models.json` 中已存在非空 `baseUrl` 获胜。
    - 仅当该提供商在当前配置/认证配置文件上下文中不是 SecretRef 管理时，智能体 `models.json` 中的非空 `apiKey` 才会获胜。
    - SecretRef 托管提供商 `apiKey` 值从源标记刷新（`ENV_VAR_NAME` 对于环境引用，`secretref-managed` 对于文件/执行引用），而不是保留已解析的机密。
    - SecretRef 管理的提供商标头值从源标记刷新（`secretref-env:ENV_VAR_NAME` 对于环境引用，`secretref-managed` 对于文件/执行引用）。
    - 空或缺少智能体 `apiKey`/`baseUrl` 回退到配置 `models.providers`。
    - 其他提供商字段从配置和标准化目录数据中刷新。

  </Accordion>
</AccordionGroup>

<Note>
标记持久性是源权威的： OpenClaw 从活动源配置快照（预解析）写入标记，而不是从解析的运行时秘密值写入标记。每当 OpenClaw 重新生成 `models.json` 时，这都适用，包括像 `openclaw agent` 这样的命令驱动路径。
</Note>

## 相关

- [智能体运行时](/concepts/agent-runtimes) — PI、Codex 和其他智能体循环运行时
- [配置参考](/gateway/config-agents#agent-defaults) — 模型配置键
- [图像生成](/tools/image-generation) — 图像模型配置
- [模型故障转移](/concepts/model-failover) — 后备链
- [模型提供商](/concepts/model-providers) — 提供商路由和认证
- [音乐生成](/tools/music-generation) — 音乐模型配置
- [视频生成](/tools/video-generation) — 视频模型配置
