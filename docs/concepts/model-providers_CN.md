---
summary: "Model provider overview with example configs + CLI flows"
read_when:
  - You need a provider-by-provider model setup reference
  - You want example configs or CLI onboarding commands for model providers
title: "Model providers"
sidebarTitle: "Model providers"
---

**LLM/模型提供商**的参考（不是像 WhatsApp/Telegram 这样的聊天频道）。模型选择规则请参见[模型](/concepts/models)。

## 快速规则

<AccordionGroup>
  <Accordion title="Model refs and CLI helpers">
    - 模型引用使用 `provider/model` （示例：`opencode/claude-opus-4-6`）。
    - `agents.defaults.models` 设置后充当白名单。
    - CLI 帮助程序：`openclaw onboard`、`openclaw models list`、`openclaw models set <provider/model>`。
    - `models.providers.*.contextWindow` / `contextTokens` / `maxTokens` 设置提供商级别默认值； `models.providers.*.models[].contextWindow` / `contextTokens` / `maxTokens` 每个模型覆盖它们。
    - 回退规则、冷却探针和会话覆盖持久性：[模型故障转移](/concepts/model-failover)。

  </Accordion>
  <Accordion title="OpenAI provider/runtime split">
    OpenAI-系列路由是特定于前缀的：

    - `openai/<model>` 在 PI 中使用直接 OpenAI API 密钥提供商。
    - `openai-codex/<model>` 在 PI 中使用 Codex OAuth。
    - `openai/<model>` 加上 `agents.defaults.agentRuntime.id: "codex"` 使用本机 Codex 应用服务器线束。

    请参阅 [OpenAI](/providers/openai) 和 [Codex 线束](/plugins/codex-harness)。如果提供商/运行时拆分令人困惑，请首先阅读 [智能体运行时](/concepts/agent-runtimes)。

    Plugin 自动启用遵循相同的边界：`openai-codex/<model>` 属于 OpenAI 插件，而 Codex 插件由 `agentRuntime.id: "codex"` 或旧版 `codex/<model>` 引用启用。

    GPT-5.5 可通过 `openai/gpt-5.5` 获取直接 API 键流量，通过 PI 中的 `openai-codex/gpt-5.5` 获取 Codex OAuth，以及本机 Codex 应用服务器工具当设置 `agentRuntime.id: "codex"` 时。

  </Accordion>
  <Accordion title="CLI runtimes">
    CLI 运行时使用相同的分割：选择规范模型引用，例如 `anthropic/claude-*`、`google/gemini-*` 或 `openai/gpt-*`，然后将 `agents.defaults.agentRuntime.id` 设置为 `claude-cli`， `google-gemini-cli` 或 `codex-cli` 当你需要本地 CLI 后端时。

    旧版 `claude-cli/*`、`google-gemini-cli/*` 和 `codex-cli/*` 引用迁移回规范提供商引用，并单独记录运行时。

  </Accordion>
</AccordionGroup>

## Plugin 拥有的提供商行为

大多数特定于提供商的逻辑位于提供商插件 (`registerProvider(...)`) 中，而 OpenClaw 保留通用推理循环。 Plugins 自己的入门、模型目录、认证环境变量映射、传输/配置规范化、工具架构清理、故障转移分类、OAuth 刷新、使用情况报告、思考/推理配置文件等。

提供商-SDK 挂钩和捆绑插件示例的完整列表位于 [提供商插件](/plugins/sdk-provider-plugins) 中。需要完全自定义请求执行器的提供商是一个单独的、更深的扩展表面。

<Note>
提供商拥有的运行器行为依赖于显式的提供商挂钩，例如重放策略、工具模式规范化、流包装和传输/请求帮助程序。旧版 `ProviderPlugin.capabilities` 静态包仅具有兼容性，并且不再由共享运行程序逻辑读取。
</Note>

## API 密钥轮换

<AccordionGroup>
  <Accordion title="Key sources and priority">
    通过以下方式配置多个密钥：

    - `OPENCLAW_LIVE_<PROVIDER>_KEY`（单个实时覆盖，最高优先级）
    - `<PROVIDER>_API_KEYS`（逗号或分号列表）
    - `<PROVIDER>_API_KEY`（主键）
    - `<PROVIDER>_API_KEY_*`（编号列表，e.g。`<PROVIDER>_API_KEY_1`）

    对于 Google 提供商，还包含 `GOOGLE_API_KEY` 作为后备。键选择顺序保留优先级并消除重复值。

  </Accordion>
  <Accordion title="When rotation kicks in">
    - 仅在速率限制响应时使用下一个键重试请求（例如 `429`、`rate_limit`、`quota`、`resource exhausted`、`Too many concurrent requests`、`ThrottlingException`、 `concurrency limit reached`、`workers_ai ... quota limit exceeded` 或定期使用限制消息）。
    - 非速率限制故障立即失败；不尝试进行密钥轮换。
    - 当所有候选键失败时，从最后一次尝试返回最终错误。

  </Accordion>
</AccordionGroup>

## 内置提供商（pi-ai 目录）

OpenClaw 随 pi‑ai 目录一起提供。这些提供商不需要\*\* `models.providers` 配置；只需设置认证+选择一个模型。

### OpenAI

- 提供商：`openai`
- 授权：`OPENAI_API_KEY`
- 可选旋转：`OPENAI_API_KEYS`、`OPENAI_API_KEY_1`、`OPENAI_API_KEY_2`，加上 `OPENCLAW_LIVE_OPENAI_KEY`（单次覆盖）
- 示例模型：`openai/gpt-5.5`、`openai/gpt-5.4-mini`
- 如果特定安装或 API 密钥表现不同，请使用 `openclaw models list --provider openai` 验证帐户/模型可用性。
- CLI：`openclaw onboard --auth-choice openai-api-key`
- 默认传输为 `auto` （WebSocket-first，SSE 后备）
- 通过 `agents.defaults.models["openai/<model>"].params.transport`（`"sse"`、`"websocket"` 或 `"auto"`）覆盖每个模型
- OpenAI 响应 WebSocket 预热默认通过 `params.openaiWsWarmup` (`true`/`false`) 启用
- OpenAI 优先级处理可以通过 `agents.defaults.models["openai/<model>"].params.serviceTier` 启用
- `/fast` 和 `params.fastMode` 直接映射 `openai/*` 在 `api.openai.com` 上响应对 `service_tier=priority` 的请求
- 当你想要显式层而不是共享 `/fast` 切换时，请使用 `params.serviceTier`
- 隐藏 OpenClaw 归因标头（`originator`、`version`、`User-Agent`）仅适用于到 `api.openai.com` 的本机 OpenAI 流量，而不是通用的OpenAI 兼容智能体
- 本机 OpenAI 路由还保留响应 `store`、提示缓存提示和 OpenAI 推理兼容负载整形；智能体路由不
- `openai/gpt-5.3-codex-spark` 在 OpenClaw 中被故意抑制，因为实时 OpenAI API 请求拒绝它，并且当前 Codex 目录不会公开它

```json5
{
  agents: { defaults: { model: { primary: "openai/gpt-5.5" } } },
}
```

### Anthropic

- 提供商：`anthropic`
- 授权：`ANTHROPIC_API_KEY`
- 可选旋转：`ANTHROPIC_API_KEYS`、`ANTHROPIC_API_KEY_1`、`ANTHROPIC_API_KEY_2`，加上 `OPENCLAW_LIVE_ANTHROPIC_KEY`（单次覆盖）
- 模型示例：`anthropic/claude-opus-4-6`
- CLI：`openclaw onboard --auth-choice apiKey`
- 直接公共 Anthropic 请求支持共享 `/fast` 切换和 `params.fastMode`，包括 API-key 和发送到 `api.anthropic.com` 的 OAuth 认证流量； OpenClaw 将其映射到 Anthropic `service_tier` （`auto` 与 `standard_only`）
- 首选 Claude CLI 配置保持模型引用规范并选择 CLI
  分别后端： `anthropic/claude-opus-4-7` 与
  `agents.defaults.agentRuntime.id: "claude-cli"`。遗产
  `claude-cli/claude-opus-4-7` 引用仍然适用于兼容性。

<Note>
Anthropic 工作人员告诉我们 OpenClaw 风格 Claude CLI 再次被允许使用，因此 OpenClaw 对待 Claude除非 Anthropic 发布新政策，否则 CLI 重用和 `claude -p` 用法将受到此集成的认可。 Anthropic setup-token 仍可作为受支持的 OpenClaw token路径使用，但 OpenClaw 现在更喜欢 Claude CLI 重用和 `claude -p`（如果可用）。
</Note>

```json5
{
  agents: { defaults: { model: { primary: "anthropic/claude-opus-4-6" } } },
}
```

### OpenAI Codex OAuth

- 提供商：`openai-codex`
- 认证：OAuth (ChatGPT)
- PI 模型参考：`openai-codex/gpt-5.5`
- 本机 Codex 应用服务器线束参考：`openai/gpt-5.5` 和 `agents.defaults.agentRuntime.id: "codex"`
- 本机Codex应用服务器线束文档：[Codex线束](/plugins/codex-harness)
- 旧模型参考：`codex/gpt-*`
- Plugin 边界：`openai-codex/*` 加载 OpenAI 插件；本机 Codex 应用服务器插件仅由 Codex 线束运行时或旧版 `codex/*` 引用选择。
- CLI：`openclaw onboard --auth-choice openai-codex` 或 `openclaw models auth login --provider openai-codex`
- 默认传输是 `auto` （WebSocket-first，SSE 后备）
- 通过 `agents.defaults.models["openai-codex/<model>"].params.transport`（`"sse"`、`"websocket"` 或 `"auto"`）覆盖每个 PI 模型
- `params.serviceTier` 也会在本机 Codex 响应请求上转发 (`chatgpt.com/backend-api`)
- 隐藏的 OpenClaw 归因标头（`originator`、`version`、`User-Agent`）仅附加到本机 Codex 流量到 `chatgpt.com/backend-api`，而不是通用的OpenAI 兼容智能体
- 与直接 `openai/*` 共享相同的 `/fast` 切换和 `params.fastMode` 配置； OpenClaw 将其映射到 `service_tier=priority`
- `openai-codex/gpt-5.5` 使用 Codex 目录本机 `contextWindow = 400000` 和默认运行时 `contextTokens = 272000`；使用 `models.providers.openai-codex.models[].contextTokens` 覆盖运行时间上限
- 政策说明：OpenAI Codex OAuth 明确支持 OpenClaw 等外部工具/工作流程。
- 当你需要 Codex OAuth/订阅路由时，请使用 `openai-codex/gpt-5.5` ；当你的 API 键设置和本地目录公开公共 API 路由时，请使用 `openai/gpt-5.5` 。

```json5
{
  agents: { defaults: { model: { primary: "openai-codex/gpt-5.5" } } },
}
```

```json5
{
  models: {
    providers: {
      "openai-codex": {
        models: [{ id: "gpt-5.5", contextTokens: 160000 }],
      },
    },
  },
}
```

### 其他订阅式托管选项

<CardGroup cols={3}>
  <Card title="GLM models" href="/providers/glm">
    Z.AI 编码计划或通用 API 端点。
  </Card>
  <Card title="MiniMax" href="/providers/minimax">
    MiniMax 编码计划 OAuth 或 API 密钥访问。
  </Card>
  <Card title="Qwen Cloud" href="/providers/qwen">
    Qwen Cloud 提供商表面加上阿里巴巴 DashScope 和 Coding Plan 端点映射。
  </Card>
</CardGroup>

### 开放代码

- 授权：`OPENCODE_API_KEY`（或`OPENCODE_ZEN_API_KEY`）
- Zen 运行时提供商：`opencode`
- Go 运行时提供商：`opencode-go`
- 示例模型：`opencode/claude-opus-4-6`、`opencode-go/kimi-k2.6`
- CLI：`openclaw onboard --auth-choice opencode-zen` 或 `openclaw onboard --auth-choice opencode-go`

```json5
{
  agents: { defaults: { model: { primary: "opencode/claude-opus-4-6" } } },
}
```

### Google Gemini （API 键）

- 提供商：`google`
- 授权：`GEMINI_API_KEY`
- 可选旋转：`GEMINI_API_KEYS`、`GEMINI_API_KEY_1`、`GEMINI_API_KEY_2`、`GOOGLE_API_KEY` 回退和 `OPENCLAW_LIVE_GEMINI_KEY`（单次覆盖）
- 示例模型：`google/gemini-3.1-pro-preview`、`google/gemini-3-flash-preview`
- 兼容性：使用 `google/gemini-3.1-flash-preview` 的旧版 OpenClaw 配置被标准化为 `google/gemini-3-flash-preview`
- 别名：`google/gemini-3.1-pro` 被接受并标准化为 Google 的实时 Gemini API id、`google/gemini-3.1-pro-preview`
- CLI：`openclaw onboard --auth-choice gemini-api-key`
- 思维：`/think adaptive` 使用 Google 动态思维。 Gemini 3/3.1 省略固定的`thinkingLevel`； Gemini 2.5 发送 `thinkingBudget: -1`。
- 直接 Gemini 运行还接受 `agents.defaults.models["google/<model>"].params.cachedContent` （或旧版 `cached_content`）以转发提供商本机 `cachedContents/...` 句柄； Gemini 缓存命中表面为 OpenClaw `cacheRead`

### Google Vertex 和 Gemini CLI

- 提供商：`google-vertex`、`google-gemini-cli`
- 验证：Vertex 使用 gcloud ADC； Gemini CLI 使用其 OAuth 流程

<Warning>
Gemini CLI OpenClaw 中的 OAuth 是非官方集成。一些用户报告在使用第三方客户端后 Google 帐户受到限制。如果你选择继续，请查看 Google 条款并使用非关键帐户。
</Warning>

Gemini CLI OAuth 作为捆绑的 `google` 插件的一部分提供。

<Steps>
  <Step title="Install Gemini CLI">
    <Tabs>
      <Tab title="brew">
        ```bash
        brew install gemini-cli
        ```
      </Tab>
      <Tab title="npm">
        ```bash
        npm install -g @google/gemini-cli
        ```
      </Tab>
    </Tabs>
  </Step>
  <Step title="Enable plugin">
    ```bash
    openclaw plugins enable google
    ```
  </Step>
  <Step title="Login">
    ```bash
    openclaw models auth login --provider google-gemini-cli --set-default
    ```

    默认模型：`google-gemini-cli/gemini-3-flash-preview`。你**不**将客户端 ID 或机密粘贴到 `openclaw.json` 中。 CLI 登录流程将token存储在网关主机上的认证配置文件中。

  </Step>
  <Step title="Set project (if needed)">
    如果登录后请求失败，请在网关主机上设置`GOOGLE_CLOUD_PROJECT`或`GOOGLE_CLOUD_PROJECT_ID`。
  </Step>
</Steps>

Gemini CLI JSON 回复从 `response` 解析；用法回落到 `stats`，其中 `stats.cached` 标准化为 OpenClaw `cacheRead`。

### Z.AI (GLM)

- 提供商：`zai`
- 授权：`ZAI_API_KEY`
- 模型示例：`zai/glm-5.1`
- CLI：`openclaw onboard --auth-choice zai-api-key`
  - 别名：`z.ai/*` 和 `z-ai/*` 标准化为 `zai/*`
  - `zai-api-key` 自动检测匹配的 Z.AI 端点； `zai-coding-global`、`zai-coding-cn`、`zai-global` 和 `zai-cn` 强制指定表面

### Vercel AI Gateway

- 提供商：`vercel-ai-gateway`
- 授权：`AI_GATEWAY_API_KEY`
- 示例模型：`vercel-ai-gateway/anthropic/claude-opus-4.6`、`vercel-ai-gateway/moonshotai/kimi-k2.6`
- CLI：`openclaw onboard --auth-choice ai-gateway-api-key`

### 公斤 Gateway

- 提供商：`kilocode`
- 授权：`KILOCODE_API_KEY`
- 模型示例：`kilocode/kilo/auto`
- CLI：`openclaw onboard --auth-choice kilocode-api-key`
- 基础URL：`https://api.kilo.ai/api/gateway/`
- 静态后备目录包含 `kilocode/kilo/auto`；实时 `https://api.kilo.ai/api/gateway/models` 发现可以进一步扩展运行时目录。
- `kilocode/kilo/auto` 后面的确切上游路由由 Kilo Gateway 所有，而不是硬编码在 OpenClaw 中。

有关设置详细信息，请参阅 [/providers/kilocode](/providers/kilocode)。

### 其他捆绑的提供商插件

| 供应商                | 身份证                           | 验证环境                                                     | 示例模型                                      |
| --------------------- | -------------------------------- | ------------------------------------------------------------ | --------------------------------------------- |
| 字节加                | `byteplus` / `byteplus-plan`     | `BYTEPLUS_API_KEY`                                           | `byteplus-plan/ark-code-latest`               |
| 大脑                  | `cerebras`                       | `CEREBRAS_API_KEY`                                           | `cerebras/zai-glm-4.7`                        |
| Cloudflare AI Gateway | `cloudflare-ai-gateway`          | `CLOUDFLARE_AI_GATEWAY_API_KEY`                              | —                                             |
| 深基础设施            | `deepinfra`                      | `DEEPINFRA_API_KEY`                                          | `deepinfra/deepseek-ai/DeepSeek-V3.2`         |
| 深度搜索              | `deepseek`                       | `DEEPSEEK_API_KEY`                                           | `deepseek/deepseek-v4-flash`                  |
| GitHub 副驾驶         | `github-copilot`                 | `COPILOT_GITHUB_TOKEN` / `GH_TOKEN` / `GITHUB_TOKEN`         | —                                             |
| 格罗克                | `groq`                           | `GROQ_API_KEY`                                               | —                                             |
| 拥抱脸推理            | `huggingface`                    | `HUGGINGFACE_HUB_TOKEN` 或 `HF_TOKEN`                        | `huggingface/deepseek-ai/DeepSeek-R1`         |
| 基洛 Gateway          | `kilocode`                       | `KILOCODE_API_KEY`                                           | `kilocode/kilo/auto`                          |
| 基米编码              | `kimi`                           | `KIMI_API_KEY` 或 `KIMICODE_API_KEY`                         | `kimi/kimi-code`                              |
| 最小最大              | `minimax` / `minimax-portal`     | `MINIMAX_API_KEY` / `MINIMAX_OAUTH_TOKEN`                    | `minimax/MiniMax-M2.7`                        |
| 米斯特拉尔            | `mistral`                        | `MISTRAL_API_KEY`                                            | `mistral/mistral-large-latest`                |
| 登月计划              | `moonshot`                       | `MOONSHOT_API_KEY`                                           | `moonshot/kimi-k2.6`                          |
| NVIDIA                | `nvidia`                         | `NVIDIA_API_KEY`                                             | `nvidia/nvidia/nemotron-3-super-120b-a12b`    |
| OpenRouter            | `openrouter`                     | `OPENROUTER_API_KEY`                                         | `openrouter/auto`                             |
| 千帆                  | `qianfan`                        | `QIANFAN_API_KEY`                                            | `qianfan/deepseek-v3.2`                       |
| 启文云                | `qwen`                           | `QWEN_API_KEY` / `MODELSTUDIO_API_KEY` / `DASHSCOPE_API_KEY` | `qwen/qwen3.5-plus`                           |
| 步趣                  | `stepfun` / `stepfun-plan`       | `STEPFUN_API_KEY`                                            | `stepfun/step-3.5-flash`                      |
| 一起                  | `together`                       | `TOGETHER_API_KEY`                                           | `together/moonshotai/Kimi-K2.5`               |
| 威尼斯                | `venice`                         | `VENICE_API_KEY`                                             | —                                             |
| Vercel AI Gateway     | `vercel-ai-gateway`              | `AI_GATEWAY_API_KEY`                                         | `vercel-ai-gateway/anthropic/claude-opus-4.6` |
| 火山引擎（豆宝）      | `volcengine` / `volcengine-plan` | `VOLCANO_ENGINE_API_KEY`                                     | `volcengine-plan/ark-code-latest`             |
| xAI                   | `xai`                            | `XAI_API_KEY`                                                | `xai/grok-4`                                  |
| 小米                  | `xiaomi`                         | `XIAOMI_API_KEY`                                             | `xiaomi/mimo-v2-flash`                        |

#### 值得了解的怪癖

<AccordionGroup>
  <Accordion title="OpenRouter">
    仅在经过验证的 `openrouter.ai` 路由上应用其应用属性标头和 Anthropic `cache_control` 标记。 DeepSeek、Moonshot 和 ZAI 引用是符合 OpenRouter 管理的提示缓存资格的缓存 TTL ，但不接收 Anthropic 缓存标记。作为智能体样式 OpenAI 兼容路径，它会跳过本机 OpenAI 专用整形（`serviceTier`、响应 `store`、提示缓存提示、OpenAI 推理兼容）。 Gemini 支持的引用仅保留智能体 Gemini 思想签名卫生。
  </Accordion>
  <Accordion title="Kilo Gateway">
    Gemini 支持的引用遵循相同的智能体-Gemini 卫生路径； `kilocode/kilo/auto` 和其他不支持智能体推理的引用跳过智能体推理注入。
  </Accordion>
  <Accordion title="MiniMax">
    API-key onboarding 写入明确的纯文本 M2.7 聊天模型定义；图像理解保留在插件拥有的 `MiniMax-VL-01` 媒体提供商上。
  </Accordion>
  <Accordion title="NVIDIA">
    模型 ID 使用 `nvidia/<vendor>/<model>` 命名空间（例如 `nvidia/nvidia/nemotron-...` 和 `nvidia/moonshotai/kimi-k2.5`）；选择器保留文字 `<provider>/<model-id>` 组合，而发送到 API 的规范密钥保持单前缀。
  </Accordion>
  <Accordion title="xAI">
    使用 xAI 响应路径。 `/fast` 或 `params.fastMode: true` 将 `grok-3`、`grok-3-mini`、`grok-4` 和 `grok-4-0709` 重写为其 `*-fast` 变体。 `tool_stream` 默认打开；通过 `agents.defaults.models["xai/<model>"].params.tool_stream=false` 禁用。
  </Accordion>
  <Accordion title="Cerebras">
    作为捆绑的 `cerebras` 提供商插件提供。 GLM 使用 `zai-glm-4.7`； OpenAI 兼容基 URL 是 `https://api.cerebras.ai/v1`.
  </Accordion>
</AccordionGroup>

## 通过 `models.providers` 提供商（自定义/基础 URL）

使用 `models.providers` （或 `models.json`）添加 **自定义** 提供商或 OpenAI/Anthropic 兼容智能体。

下面的许多捆绑提供商插件已经发布了默认目录。仅当你想要覆盖默认基本 URL、标头或模型列表时，才使用显式 `models.providers.<id>` 条目。

Gateway 模型功能检查还会读取显式 `models.providers.<id>.models[]` 元数据。如果自定义或智能体模型接受图像，请在该模型上设置 `input: ["text", "image"]` ，以便 WebChat 和节点源附件路径将图像作为本机模型输入而不是纯文本媒体引用传递。

### 登月人工智能（Kimi）

Moonshot 作为捆绑的提供商插件提供。默认情况下使用内置提供商，仅当你需要覆盖基本 URL 或模型元数据时才添加显式 `models.providers.moonshot` 条目：

- 提供商：`moonshot`
- 授权：`MOONSHOT_API_KEY`
- 模型示例：`moonshot/kimi-k2.6`
- CLI：`openclaw onboard --auth-choice moonshot-api-key` 或 `openclaw onboard --auth-choice moonshot-api-key-cn`

Kimi K2 模型 ID：

[//]：# "moonshot-kimi-k2-model-refs:start"

- `moonshot/kimi-k2.6`
- `moonshot/kimi-k2.5`
- `moonshot/kimi-k2-thinking`
- `moonshot/kimi-k2-thinking-turbo`
- `moonshot/kimi-k2-turbo`

[//]：# "moonshot-kimi-k2-model-refs:end"

```json5
{
  agents: {
    defaults: { model: { primary: "moonshot/kimi-k2.6" } },
  },
  models: {
    mode: "merge",
    providers: {
      moonshot: {
        baseUrl: "https://api.moonshot.ai/v1",
        apiKey: "${MOONSHOT_API_KEY}",
        api: "openai-completions",
        models: [{ id: "kimi-k2.6", name: "Kimi K2.6" }],
      },
    },
  },
}
```

### 基米编码

Kimi Coding 使用 Moonshot AI 的 Anthropic 兼容端点：

- 提供商：`kimi`
- 授权：`KIMI_API_KEY`
- 模型示例：`kimi/kimi-code`

```json5
{
  env: { KIMI_API_KEY: "sk-..." },
  agents: {
    defaults: { model: { primary: "kimi/kimi-code" } },
  },
}
```

旧版 `kimi/k2p5` 仍被接受为兼容性模型 ID。

### 火山引擎（豆宝）

火山引擎（Volcano Engine）提供豆宝和中国其他模型的访问。

- 提供商：`volcengine`（编码：`volcengine-plan`）
- 授权：`VOLCANO_ENGINE_API_KEY`
- 模型示例：`volcengine-plan/ark-code-latest`
- CLI：`openclaw onboard --auth-choice volcengine-api-key`

```json5
{
  agents: {
    defaults: { model: { primary: "volcengine-plan/ark-code-latest" } },
  },
}
```

Onboarding默认为编码表面，但同时注册通用`volcengine/*`目录。

在载入/配置模型选择器中，Volcengine 认证选择更喜欢 `volcengine/*` 和 `volcengine-plan/*` 行。如果这些模型尚未加载，OpenClaw 会回退到未过滤的目录，而不是显示空的提供商范围选择器。

<Tabs>
  <Tab title="Standard models">
    - `volcengine/doubao-seed-1-8-251228`（豆宝种子1.8）
    - `volcengine/doubao-seed-code-preview-251028`
    - `volcengine/kimi-k2-5-260127` (基米 K2.5)
    - `volcengine/glm-4-7-251222` (GLM 4.7)
    - `volcengine/deepseek-v3-2-251201` (DeepSeek V3.2 128K)

  </Tab>
  <Tab title="Coding models (volcengine-plan)">
    - `volcengine-plan/ark-code-latest`
    - `volcengine-plan/doubao-seed-code`
    - `volcengine-plan/kimi-k2.5`
    - `volcengine-plan/kimi-k2-thinking`
    - `volcengine-plan/glm-4.7`

  </Tab>
</Tabs>

### BytePlus（国际）

BytePlus ARK 为国际用户提供与 Volcano Engine 相同模型的访问。

- 提供商：`byteplus`（编码：`byteplus-plan`）
- 授权：`BYTEPLUS_API_KEY`
- 模型示例：`byteplus-plan/ark-code-latest`
- CLI：`openclaw onboard --auth-choice byteplus-api-key`

```json5
{
  agents: {
    defaults: { model: { primary: "byteplus-plan/ark-code-latest" } },
  },
}
```

Onboarding默认为编码表面，但同时注册通用`byteplus/*`目录。

在载入/配置模型选择器中，BytePlus 认证选择更喜欢 `byteplus/*` 和 `byteplus-plan/*` 行。如果这些模型尚未加载，OpenClaw 会回退到未过滤的目录，而不是显示空的提供商范围选择器。

<Tabs>
  <Tab title="Standard models">
    - `byteplus/seed-1-8-251228`（种子 1.8）
    - `byteplus/kimi-k2-5-260127` (基米 K2.5)
    - `byteplus/glm-4-7-251222` (GLM 4.7)

  </Tab>
  <Tab title="Coding models (byteplus-plan)">
    - `byteplus-plan/ark-code-latest`
    - `byteplus-plan/doubao-seed-code`
    - `byteplus-plan/kimi-k2.5`
    - `byteplus-plan/kimi-k2-thinking`
    - `byteplus-plan/glm-4.7`

  </Tab>
</Tabs>

### 合成

Synthetic 在 `synthetic` 提供商背后提供 Anthropic 兼容模型：

- 提供商：`synthetic`
- 授权：`SYNTHETIC_API_KEY`
- 模型示例：`synthetic/hf:MiniMaxAI/MiniMax-M2.5`
- CLI：`openclaw onboard --auth-choice synthetic-api-key`

```json5
{
  agents: {
    defaults: { model: { primary: "synthetic/hf:MiniMaxAI/MiniMax-M2.5" } },
  },
  models: {
    mode: "merge",
    providers: {
      synthetic: {
        baseUrl: "https://api.synthetic.new/anthropic",
        apiKey: "${SYNTHETIC_API_KEY}",
        api: "anthropic-messages",
        models: [{ id: "hf:MiniMaxAI/MiniMax-M2.5", name: "MiniMax M2.5" }],
      },
    },
  },
}
```

### 最小最大

MiniMax 通过 `models.providers` 配置，因为它使用自定义端点：

- MiniMax OAuth（全球）：`--auth-choice minimax-global-oauth`
- MiniMax OAuth（中国）：`--auth-choice minimax-cn-oauth`
- MiniMax API 键（全局）：`--auth-choice minimax-global-api`
- MiniMax API 键（中国）：`--auth-choice minimax-cn-api`
- 授权：`MINIMAX_API_KEY` 对应 `minimax`； `MINIMAX_OAUTH_TOKEN` 或 `MINIMAX_API_KEY` 对于 `minimax-portal`

有关设置详细信息、模型选项和配置片段，请参阅 [/providers/minimax](/providers/minimax)。

<Note>
在 MiniMax 的 Anthropic 兼容流路径上，OpenClaw 默认禁用思考，除非你显式设置它，并且 `/fast on` 将 `MiniMax-M2.7` 重写为 `MiniMax-M2.7-highspeed`。
</Note>

Plugin 拥有的能力分割：

- 文本/聊天默认保留在 `minimax/MiniMax-M2.7`
- 图像生成为 `minimax/image-01` 或 `minimax-portal/image-01`
- 图像理解是两个 MiniMax 认证路径上插件拥有的 `MiniMax-VL-01`
- 网络搜索保留在提供商 ID `minimax` 上

### LM工作室

LM Studio 作为捆绑的提供商插件提供，它使用本机 API：

- 提供商：`lmstudio`
- 授权：`LM_API_TOKEN`
- 默认推理基 URL: `http://localhost:1234/v1`

然后设置一个模型（替换为 `http://localhost:1234/api/v1/models` 返回的 ID 之一）：

```json5
{
  agents: {
    defaults: { model: { primary: "lmstudio/openai/gpt-oss-20b" } },
  },
}
```

OpenClaw 使用 LM Studio 的原生 `/api/v1/models` 和 `/api/v1/models/load` 进行发现+自动加载，默认情况下使用 `/v1/chat/completions` 进行推理。有关设置和故障排除，请参阅 [/providers/lmstudio](/providers/lmstudio)。

### Ollama

Ollama 作为捆绑提供商插件提供，并使用 Ollama 的本机 API：

- 提供商：`ollama`
- 认证：不需要（本地服务器）
- 模型示例：`ollama/llama3.3`
- 安装：[https://ollama.com/download](https://ollama.com/download)

```bash
# Install Ollama, then pull a model:
ollama pull llama3.3
```

```json5
{
  agents: {
    defaults: { model: { primary: "ollama/llama3.3" } },
  },
}
```

当你选择使用 `OLLAMA_API_KEY` 时，会在 `http://127.0.0.1:11434` 本地检测到 Ollama，并且捆绑的提供商插件将 Ollama 直接添加到 `openclaw onboard` 和模型选择器。请参阅 [/providers/ollama](/providers/ollama) 了解入门、云/本地模式和自定义配置。

### 法学硕士

vLLM 作为本地/自托管 OpenAI 兼容服务器的捆绑提供商插件提供：

- 提供商：`vllm`
- Auth：可选（取决于你的服务器）
- 默认基址 URL: `http://127.0.0.1:8000/v1`

要选择在本地自动发现（如果你的服务器不强制执行认证，则任何值都有效）：

```bash
export VLLM_API_KEY="vllm-local"
```

然后设置一个模型（替换为 `/v1/models` 返回的 ID 之一）：

```json5
{
  agents: {
    defaults: { model: { primary: "vllm/your-model-id" } },
  },
}
```

有关详细信息，请参阅 [/providers/vllm](/providers/vllm)。

### SGLang

SGLang 作为快速自托管 OpenAI 兼容服务器的捆绑提供商插件提供：

- 提供商：`sglang`
- Auth：可选（取决于你的服务器）
- 默认基址 URL: `http://127.0.0.1:30000/v1`

要选择在本地自动发现（如果你的服务器不强制执行认证，则任何值都有效）：

```bash
export SGLANG_API_KEY="sglang-local"
```

然后设置一个模型（替换为 `/v1/models` 返回的 ID 之一）：

```json5
{
  agents: {
    defaults: { model: { primary: "sglang/your-model-id" } },
  },
}
```

有关详细信息，请参阅 [/providers/sglang](/providers/sglang)。

### 本地智能体（LM Studio、vLLM、LiteLLM 等）

示例（OpenAI 兼容）：

```json5
{
  agents: {
    defaults: {
      model: { primary: "lmstudio/my-local-model" },
      models: { "lmstudio/my-local-model": { alias: "Local" } },
    },
  },
  models: {
    providers: {
      lmstudio: {
        baseUrl: "http://localhost:1234/v1",
        apiKey: "${LM_API_TOKEN}",
        api: "openai-completions",
        timeoutSeconds: 300,
        models: [
          {
            id: "my-local-model",
            name: "Local Model",
            reasoning: false,
            input: ["text"],
            cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
            contextWindow: 200000,
            maxTokens: 8192,
          },
        ],
      },
    },
  },
}
```

<AccordionGroup>
  <Accordion title="Default optional fields">
    对于自定义提供商，`reasoning`、`input`、`cost`、`contextWindow` 和 `maxTokens` 是可选的。省略时，OpenClaw 默认为：

    - `reasoning: false`
    - `input: ["text"]`
    - `cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 }`
    - `contextWindow: 200000`
    - `maxTokens: 8192`

    建议：设置与你的智能体/模型限制相匹配的显式值。

  </Accordion>
  <Accordion title="Proxy-route shaping rules">
    - 对于非本机端点上的 `api: "openai-completions"`（主机不是 `api.openai.com` 的任何非空 `baseUrl`），OpenClaw 强制 `compat.supportsDeveloperRole: false` 以避免因不受支持而出现提供商 400 错误`developer` 角色。
    - 智能体样式 OpenAI 兼容的路由也会跳过本机 OpenAI-only 请求整形：无 `service_tier`，无响应 `store`，无完成 `store`，无提示缓存提示，无OpenAI 推理兼容有效负载整形，并且没有隐藏的 OpenClaw 属性标头。
    - 对于需要特定于供应商字段的 OpenAI 兼容完成智能体，设置 `agents.defaults.models["provider/model"].params.extra_body` （或 `extraBody`）以将额外的 JSON 合并到出站请求正文中。
    - 对于 vLLM 聊天模板控件，设置 `agents.defaults.models["provider/model"].params.chat_template_kwargs`。当会话思考级别关闭时，捆绑的 vLLM 插件会自动发送 `enable_thinking: false` 和 `vllm/nemotron-3-*` 的 `force_nonempty_content: true` 。
    - 对于慢速本地模型或远程 LAN/tailnet 主机，设置 `models.providers.<id>.timeoutSeconds`。这扩展了提供商模型 HTTP 请求处理，包括连接、标头、正文流和总受保护的获取中止，而不会增加整个智能体运行时超时。
    - 如果 `baseUrl` 为空/省略，则 OpenClaw 保留默认的 OpenAI 行为（解析为 `api.openai.com`）。
    - 为了安全起见，显式 `compat.supportsDeveloperRole: true` 仍会在非本机 `openai-completions` 端点上被覆盖。
    - 对于非直接端点上的 `api: "anthropic-messages"`（除规范 `anthropic` 之外的任何提供商，或主机不是公共 `api.anthropic.com` 端点的自定义 `models.providers.anthropic.baseUrl` ）， OpenClaw 抑制隐式Anthropic beta 标头，例如 `claude-code-20250219`、`interleaved-thinking-2025-05-14` 和 OAuth 标记，因此自定义 Anthropic 兼容智能体不会拒绝不支持的 beta 标志。如果你的智能体需要特定的测试版功能，请显式设置 `models.providers.<id>.headers["anthropic-beta"]` 。

  </Accordion>
</AccordionGroup>

## CLI 示例

```bash
openclaw onboard --auth-choice opencode-zen
openclaw models set opencode/claude-opus-4-6
openclaw models list
```

另请参阅：[配置](/gateway/configuration) 了解完整配置示例。

## 相关

- [配置参考](/gateway/config-agents#agent-defaults) — 模型配置键
- [模型故障转移](/concepts/model-failover) — 后备链和重试行为
- [Models](/concepts/models) — 模型配置和别名
- [Providers](/providers) — 每个提供商的设置指南
