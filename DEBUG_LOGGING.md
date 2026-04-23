# OpenClaw 调试日志指南

## 概述

为了帮助诊断 OpenAI 和 Anthropic API 密钥以及基础 URL 配置问题，已在关键位置添加了详细的调试日志。

## 添加的日志位置

### 1. **CLI 启动日志** (`src/cli/run-main.ts`)
**位置**: `runCli()` 函数开始
**输出内容**: 打印所有相关的环境变量（已掩码）
```
[DEBUG] ========== OpenClaw Environment Variables ==========
[DEBUG] ANTHROPIC_API_KEY: sk-AiVfM...q7GqeYopL0YrLDJPltl4x_k
[DEBUG] ANTHROPIC_BASE_URL: [not set]
[DEBUG] ANTHROPIC_OAUTH_TOKEN: [not set]
[DEBUG] OPENAI_API_KEY: sk-AiVfM...q7GqeYopL0YrLDJPltl4x_k
[DEBUG] OPENAI_BASE_URL: https://api.uniapi.io/v1
[DEBUG] OPENCLAW_DEFAULT_MODEL: openai/gpt-5.4-nano
[DEBUG] ========================================================
```

### 2. **API 密钥解析日志** (`src/agents/model-auth-env.ts`)
**位置**: `resolveEnvApiKey()` 函数
**输出内容**:
```
[DEBUG] resolveEnvApiKey called for provider: openai (normalized: openai)
[DEBUG]   candidates for openai: ["OPENAI_API_KEY"]
[DEBUG]   OPENAI_API_KEY: found (source: env: OPENAI_API_KEY, value: sk-AiVfM...q7GqeYopL0YrLDJPltl4x_k)
[DEBUG]   ✓ Using env: OPENAI_API_KEY for openai
```

### 3. **高级 API 密钥解析日志** (`src/agents/model-auth.ts`)
**位置**: `resolveApiKeyForProvider()` 函数
**输出内容**:
```
[DEBUG] resolveApiKeyForProvider called: {
  provider: "openai",
  profileId: undefined,
  preferredProfile: undefined,
  lockedProfile: undefined,
  credentialPrecedence: undefined
}
[DEBUG] ✓ Resolved API key for openai from env: OPENAI_API_KEY (mode: api-key, key: sk-AiVfM...q7GqeYopL0YrLDJPltl4x_k)
```

### 4. **OpenAI 基础 URL 验证日志** (`extensions/openai/base-url.ts`)
**位置**: `isOpenAIApiBaseUrl()` 函数
**输出内容**:
```
[DEBUG] isOpenAIApiBaseUrl: https://api.uniapi.io/v1 => false
[DEBUG] isOpenAIApiBaseUrl: https://api.openai.com/v1 => true
```

### 5. **OpenAI 传输选择日志** (`extensions/openai/openai-provider.ts`)
**位置**: `shouldUseOpenAIResponsesTransport()` 和 `normalizeOpenAITransport()` 函数
**输出内容**:
```
[DEBUG] shouldUseOpenAIResponsesTransport: {
  provider: "openai",
  isOwnerProvider: true,
  api: "openai-completions",
  baseUrl: "https://api.uniapi.io/v1",
  result: false
}
[DEBUG] OpenAI Transport Normalization: {
  modelId: "gpt-5.4-nano",
  baseUrl: "https://api.uniapi.io/v1",
  api: "openai-completions",
  useResponsesTransport: false
}
[DEBUG]   Using original transport for gpt-5.4-nano
```

## 在 IDEA 中运行和查看日志

### 步骤 1: 修改环境变量配置

在 IDEA 的 **Run/Debug Configurations** 中，设置以下环境变量：

```
ANTHROPIC_API_KEY=sk-...
ANTHROPIC_BASE_URL=https://api.uniapi.io
OPENAI_API_KEY=sk-...
OPENAI_BASE_URL=https://api.uniapi.io/v1
OPENCLAW_DEFAULT_MODEL=openai/gpt-5.4-nano
```

**注意**: 不要使用 `ANTHROPIC_AUTH_TOKEN`，应该用 `ANTHROPIC_API_KEY` 或 `ANTHROPIC_OAUTH_TOKEN`。

### 步骤 2: 启动 Debug

点击 IDEA 中的 Debug 按钮启动项目。

### 步骤 3: 查看日志

在 IDEA 的 **Debug Console** 或 **Run Console** 中，查找 `[DEBUG]` 标记的日志：

```
[DEBUG] ========== OpenClaw Environment Variables ==========
[DEBUG] ANTHROPIC_API_KEY: sk-AiVfM...q7GqeYopL0YrLDJPltl4x_k
...
```

## 日志掩码策略

为了安全起见，所有 API 密钥都被部分掩码：
- 格式: `sk-AiVfM...q7GqeYopL0YrLDJPltl4x_k`
- 显示: 前 10 个字符 + "..." + 后 5 个字符
- 隐藏: 中间的所有字符

## 调试步骤

### 问题: API 密钥没有被识别

1. 检查 **CLI 启动日志**，看环境变量是否被设置
2. 如果是 `[not set]`，检查 IDEA 的环境变量配置是否正确
3. 检查变量名是否正确（区分大小写）

### 问题: 使用了错误的 baseUrl

1. 检查 **OpenAI 基础 URL 验证日志**，看 `isOpenAIApiBaseUrl()` 的结果
2. 如果是 `false`，说明你的自定义 URL 被正确识别为非官方 URL
3. 检查 **OpenAI 传输选择日志**，看 `shouldUseOpenAIResponsesTransport()` 的结果

### 问题: API 密钥来源不对

1. 检查 **高级 API 密钥解析日志**，看 `resolveApiKeyForProvider()` 返回的 `source` 字段
2. 可能的值: `env: OPENAI_API_KEY`, `profile:xxx`, `config` 等

## 禁用日志

如果日志输出过多，可以注释掉 `console.log()` 调用，或在生产环境中移除这些日志。

## 日志位置汇总

| 文件 | 函数 | 描述 |
|------|------|------|
| `src/cli/run-main.ts` | `runCli()` | 环境变量初始化日志 |
| `src/agents/model-auth-env.ts` | `resolveEnvApiKey()` | 环境变量解析日志 |
| `src/agents/model-auth.ts` | `resolveApiKeyForProvider()` | API 密钥解析日志 |
| `extensions/openai/base-url.ts` | `isOpenAIApiBaseUrl()` | URL 验证日志 |
| `extensions/openai/openai-provider.ts` | `shouldUseOpenAIResponsesTransport()` / `normalizeOpenAITransport()` | 传输选择日志 |

---

**创建日期**: 2026-04-23
**目的**: 诊断 OpenAI/Anthropic 配置问题
