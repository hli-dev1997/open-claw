# OpenAI BaseURL 与 API Key 配置覆盖问题修复笔记

## 问题现象

启动网关时，调试日志显示：

```
[DEBUG] OPENAI_API_KEY: sk-FBQLlfJ...NM7_4   ← 旧密钥
[DEBUG] OPENAI_BASE_URL: https://ap...io/v1

[DEBUG] OpenAI Transport Normalization: {
  modelId: 'gpt-5.4-nano',
  baseUrl: 'https://api.openai.com/v1',       ← 错误！使用了默认地址
  ...
}
```

即使 `.env` 文件已经写入了正确的 URL 和密钥，实际使用的仍然是旧的系统环境变量值，模型请求也发往错误的端点。

---

## 根本原因分析

### 原因一：`.env` 文件优先级低于进程环境变量

根据 `.env.example` 中的说明，各配置来源的优先级从高到低为：

```
进程环境变量 > ./.env > ~/.openclaw/.env > openclaw.json env 块
```

用户的 Windows 系统中已通过其他方式（如系统环境变量）设置了旧的 `OPENAI_API_KEY`，导致 `.env` 文件中写入新值也不生效。

### 原因二：BaseURL 通过配置文件读取，而非直接读取环境变量

`resolveConfiguredOpenAIBaseUrl` 函数（`extensions/openai/shared.ts:40`）读取的是 `openclaw.json` 配置文件中的值，而不是 `OPENAI_BASE_URL` 环境变量：

```typescript
export function resolveConfiguredOpenAIBaseUrl(cfg: OpenClawConfig | undefined): string {
  return normalizeOptionalString(cfg?.models?.providers?.openai?.baseUrl) ?? OPENAI_API_BASE_URL;
}
```

由于 `~/.openclaw/openclaw.json` 中没有配置 `models.providers.openai.baseUrl`，函数回退到默认值 `https://api.openai.com/v1`，这就是为什么即使环境变量设置正确，传输层仍使用默认地址。

### 原因三：API Key 需要特定条件才能走配置文件优先路径

`resolveApiKeyForProvider` 函数（`src/agents/model-auth.ts:430`）只有在满足以下条件时，才会让配置文件中的 API Key 优先于环境变量：

```typescript
if (shouldPreferExplicitConfigApiKeyAuth(cfg, provider)) {
  // 使用配置文件中的 apiKey，优先于环境变量
}
```

`shouldPreferExplicitConfigApiKeyAuth` 返回 `true` 需要同时满足：
1. `models.providers.openai.auth` 设置为 `"api-key"`
2. `models.providers.openai.apiKey` 已设置

---

## 解决方案

**修改文件：** `C:\Users\lihao\.openclaw\openclaw.json`

在配置文件中新增 `models.providers.openai` 节点：

```json
{
  "models": {
    "providers": {
      "openai": {
        "baseUrl": "https://api.uniapi.io/v1",
        "apiKey": "sk-AiVfMpbtnJi9fFQ_Pk-rDX2LeVMoTxn8ryrgq7GqeYopL0YrLDJPltl4x_k",
        "auth": "api-key",
        "models": []
      }
    }
  }
}
```

**注意：** `"models": []` 是必填字段，缺少时配置验证会报错：
```
models.providers.openai.models: Invalid input: expected array, received undefined
```

---

## 为什么这样能解决问题

| 配置字段 | 作用 | 对应代码路径 |
|---|---|---|
| `baseUrl` | 被 `resolveConfiguredOpenAIBaseUrl(cfg)` 直接读取，用于 gpt-5.4-nano 等动态模型的传输层端点 | `extensions/openai/shared.ts:41` |
| `apiKey` | 提供配置文件中的密钥值 | `src/agents/model-auth.ts:98` |
| `auth: "api-key"` | 触发 `shouldPreferExplicitConfigApiKeyAuth` 返回 `true`，使配置文件密钥优先于系统环境变量 | `src/agents/model-auth.ts:206` |
| `models: []` | 满足 JSON Schema 校验要求 | 配置验证层 |

### BaseURL 生效路径

```
openclaw.json
  └─> resolveConfiguredOpenAIBaseUrl(cfg)        [shared.ts:40]
        └─> resolveOpenAIGpt54ForwardCompatModel() [openai-provider.ts]
              └─> model.baseUrl = "https://api.uniapi.io/v1"
                    └─> normalizeOpenAITransport()  [openai-provider.ts]
                          └─> OpenAI 客户端使用正确的端点发起请求
```

### API Key 生效路径

```
openclaw.json (auth: "api-key" + apiKey: "sk-...")
  └─> shouldPreferExplicitConfigApiKeyAuth() = true  [model-auth.ts:206]
        └─> resolveUsableCustomProviderApiKey()       [model-auth.ts:134]
              └─> 返回配置文件中的密钥（跳过环境变量检查）
```

---

## 验证方法

修复后，日志应显示：

```
[DEBUG] OpenAI Transport Normalization: {
  modelId: 'gpt-5.4-nano',
  baseUrl: 'https://api.uniapi.io/v1',   ← 正确！
  ...
}
```

---

## 日后维护

只需修改 `~/.openclaw/openclaw.json` 中对应字段，重启网关即可：

```json
"openai": {
  "baseUrl": "← 修改这里换 API 地址",
  "apiKey":  "← 修改这里换密钥",
  "auth": "api-key",
  "models": []
}
```

无需修改 `.env` 文件或系统环境变量。

---

---

# OpenAI Responses API store:false 导致 rs_xxx 404 问题修复笔记

## 问题现象

运行以下命令时，第二轮对话起持续报 HTTP 404：

```
pnpm dev agent --agent main --message "你好，请确认你的模型名称和当前的系统时间。"
```

错误信息：
```
HTTP 404: Provider API error: Item with id
'rs_0947d380ba4b82860169eaccf93f908190a3c8c3c6df77238a' not found.
Items are not persisted when 'store' is set to false.
```

`rs_xxx` 是 OpenAI Responses API 生成的推理块（reasoning block）ID，出现在使用 `o` 系列或其他支持推理的模型时。

---

## 根本原因分析（完整调用链）

### 第一步：`api.uniapi.io` 被识别为"自定义端点"

`src/agents/provider-attribution.ts` 中：

```typescript
// Line 537-540
const usesKnownNativeOpenAIEndpoint =
  endpointClass === "openai-public" ||   // api.openai.com
  endpointClass === "openai-codex" ||    // chatgpt.com
  endpointClass === "azure-openai";      // *.openai.azure.com
```

`api.uniapi.io` 不在上述列表中，被识别为 `endpointClass = "custom"`，因此 `usesKnownNativeOpenAIEndpoint = false`。

### 第二步：`allowsResponsesStore` 被设为 false

```typescript
// Line 676-681（修复前）
allowsResponsesStore:
  input.compat?.supportsStore !== false &&
  provider !== undefined &&
  isResponsesApi &&
  OPENAI_RESPONSES_PROVIDERS.has(provider) &&
  policy.usesKnownNativeOpenAIEndpoint,   // ← false，整个条件为 false
```

结果：`allowsResponsesStore = false`。

### 第三步：`createOpenAIResponsesContextManagementWrapper` 不生效

`src/agents/pi-embedded-runner/openai-stream-wrappers.ts` 中的包装器设计用于将 `store: false` 覆盖为 `store: true`，但有早返回逻辑：

```typescript
// Line 174-182
if (
  policy.explicitStore === undefined &&
  !policy.useServerCompaction &&
  ...
) {
  return underlying(...)  // ← 直接透传，不做任何覆盖
}
```

由于 `allowsResponsesStore = false` → `explicitStore = undefined`，包装器什么都不做。

### 第四步：pi-ai 库硬编码 `store: false`

`src/agents/openai-transport-stream.ts` 中，`buildOpenAIResponsesParams` 使用 `storeMode: "disable"`，最终 API 请求里 `store: false`。

### 第五步：reasoning block 无法被持久化

OpenAI Responses API 在 `store: false` 时生成的 `rs_xxx` ID 不会在服务端持久化。

### 第六步：ID 被写入 session 文件

推理块以如下形式保存到本地 session JSONL 文件中：

```json
{"type":"thinking","thinking":"...","thinkingSignature":"rs_0947d380..."}
```

### 第七步：下一轮对话发送时 404

下一轮请求将历史消息（含 `rs_xxx` ID）发给 OpenAI → 服务端找不到该 ID → 返回 404。

---

## 解决方案

### 立即修复（清空 session 文件）

清除含有无效 `rs_xxx` ID 的历史 session 文件：

```bash
# 备份原文件
cp ~/.openclaw/agents/main/sessions/5aa33968-ca9c-42cf-8757-71aee3fb3314.jsonl \
   ~/.openclaw/agents/main/sessions/5aa33968-ca9c-42cf-8757-71aee3fb3314.jsonl.bak

# 清空文件（保留文件，让 openclaw 正常识别）
truncate -s 0 ~/.openclaw/agents/main/sessions/5aa33968-ca9c-42cf-8757-71aee3fb3314.jsonl
```

此操作清除了 session 中存储的 28 个无效 `rs_xxx` ID。

### 根本修复（代码修改）

**修改文件：** `src/agents/provider-attribution.ts`

在 `allowsResponsesStore` 条件中，加入对代理端点（proxy-like endpoint）的支持：

```typescript
// 修复前（Line 676-681）
allowsResponsesStore:
  input.compat?.supportsStore !== false &&
  provider !== undefined &&
  isResponsesApi &&
  OPENAI_RESPONSES_PROVIDERS.has(provider) &&
  policy.usesKnownNativeOpenAIEndpoint,

// 修复后
allowsResponsesStore:
  input.compat?.supportsStore !== false &&
  provider !== undefined &&
  isResponsesApi &&
  OPENAI_RESPONSES_PROVIDERS.has(provider) &&
  (policy.usesKnownNativeOpenAIEndpoint || usesExplicitProxyLikeEndpoint),
```

其中 `usesExplicitProxyLikeEndpoint` 在同文件 Line 545 已定义：

```typescript
const usesExplicitProxyLikeEndpoint = usesConfiguredBaseUrl && !usesKnownNativeOpenAIEndpoint;
```

即：只要用了自定义 `baseUrl`（如 `api.uniapi.io`）且不是已知 OpenAI 原生端点，也允许 `store: true`。

---

## 修复后的生效路径

```
provider-attribution.ts
  usesExplicitProxyLikeEndpoint = true（api.uniapi.io）
  → allowsResponsesStore = true
    → openai-responses-payload-policy.ts
        explicitStore = true
      → openai-stream-wrappers.ts
          createOpenAIResponsesContextManagementWrapper 生效
          store: false → store: true（覆盖 pi-ai 的硬编码）
        → OpenAI Responses API 请求中 store: true
          → rs_xxx ID 被服务端持久化
          → 下一轮对话可正常引用，不再 404
```

---

## 受影响的配置条件

| 条件 | 修复前 | 修复后 |
|---|---|---|
| `api.openai.com`（原生） | ✅ store: true | ✅ store: true |
| `api.uniapi.io`（代理） | ❌ store: false → 404 | ✅ store: true |
| `api.anthropic.com` | 不适用（不是 Responses API） | 不适用 |
| 无 baseUrl（默认） | ✅ store: true | ✅ store: true |

---

## 日后维护

如果更换了其他代理端点（如 `api.xxx.com/v1`），只要满足以下条件即不会再触发此 404：

1. `openclaw.json` 中 `provider` 字段为 `"openai"`
2. `baseUrl` 已配置为非原生 OpenAI 地址（代理地址）
3. 代码已应用上述 `provider-attribution.ts` 修复

无需手动清理 session 文件。
