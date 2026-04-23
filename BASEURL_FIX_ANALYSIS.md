# OpenAI 自定义 Base URL 问题根因分析和修复总结

## 🔍 问题分析

### 问题现象
虽然你在 `openclaw.json` 配置中设置了：
```json
{
  "models": {
    "providers": {
      "openai": {
        "baseUrl": "https://api.uniapi.io/v1"
      }
    }
  }
}
```

但系统仍然访问的是官方 URL `https://api.openai.com/v1`，导致 API 调用失败。

### 根本原因

在 `extensions/openai/openai-provider.ts` 的 `resolveOpenAIGpt54ForwardCompatModel()` 函数中，所有 OpenAI 5.4/5.4-pro/5.4-mini/5.4-nano 模型的 baseUrl 都被**硬编码**为 `https://api.openai.com/v1`：

```typescript
// ❌ 旧代码 - 硬编码的 URL
patch = {
  api: "openai-responses",
  provider: PROVIDER_ID,
  baseUrl: "https://api.openai.com/v1",  // ← 硬编码！
  ...
};
```

这个函数在**动态模型解析**时被调用，它会创建模型对象并**覆盖**你在配置文件中设置的 baseUrl。

## 🔧 修复方案

### 修复 1: 在 resolveOpenAIGpt54ForwardCompatModel 中使用配置 URL

**文件**: `extensions/openai/openai-provider.ts`

**改变**:
```typescript
// ✅ 新代码 - 从配置中读取 URL
import { resolveConfiguredOpenAIBaseUrl } from "./shared.js";

function resolveOpenAIGpt54ForwardCompatModel(
  ctx: ProviderResolveDynamicModelContext,
): ProviderRuntimeModel | undefined {
  // ...
  const baseUrl = resolveConfiguredOpenAIBaseUrl(ctx.config);
  
  patch = {
    api: "openai-responses",
    provider: PROVIDER_ID,
    baseUrl,  // ← 使用配置的 URL
    ...
  };
}
```

这样做的好处：
- 使用已有的 `resolveConfiguredOpenAIBaseUrl()` 工具函数
- 与图片生成和视频生成提供商保持一致
- 允许从配置中覆盖 baseUrl

### 修复 2: 在 OpenAI 客户端初始化时添加日志

**文件**: `src/agents/openai-transport-stream.ts`

添加日志以追踪模型最终使用的 baseUrl：

```typescript
function createOpenAIClient(model, context, apiKey, optionHeaders, turnHeaders) {
  console.log(`[DEBUG] createOpenAIClient: creating client with baseURL=${model.baseUrl} (model=${model.id})`);
  return new OpenAI({
    apiKey,
    baseURL: model.baseUrl,  // ← 这里使用的值
    ...
  });
}
```

## 📊 配置优先级（从高到低）

1. **动态模型解析结果** (现在从配置读取) ← **优先级最高**
2. `resolveConfiguredOpenAIBaseUrl()` 返回的值
3. `openclaw.json` 中 `models.providers.openai.baseUrl`
4. 默认值 `https://api.openai.com/v1`

## 📝 调试信息流

运行项目后，观察以下日志：

```
1️⃣ CLI 启动时：
[DEBUG] OPENAI_API_KEY: sk-AiVfM...l4x_k
[DEBUG] OPENAI_BASE_URL: https://api.uniapi.io/v1

2️⃣ 模型解析时：
[DEBUG] resolveOpenAIGpt54ForwardCompatModel: modelId=gpt-5.4-nano, baseUrl=https://api.uniapi.io/v1 (from config)

3️⃣ 客户端初始化时：
[DEBUG] createOpenAIClient: creating client with baseURL=https://api.uniapi.io/v1 (model=gpt-5.4-nano)

4️⃣ 传输流启动时：
[DEBUG] createOpenAIResponsesTransportStreamFn: model=gpt-5.4-nano, provider=openai, api=openai-responses, baseUrl=https://api.uniapi.io/v1
```

## ✅ 验证步骤

1. **确保配置文件正确** (`~/.openclaw/openclaw.json`)：
```json
{
  "models": {
    "providers": {
      "openai": {
        "baseUrl": "https://api.uniapi.io/v1"
      }
    }
  }
}
```

2. **重启项目**（关闭旧的 Debug 会话，重新启动）

3. **检查日志**：
   - 查找 `createOpenAIClient: creating client with baseURL=https://api.uniapi.io/v1`
   - 如果看到这个日志且 URL 正确，说明配置已生效

4. **测试 API 调用**：
   - 应该现在能够使用你的代理 API
   - 如果仍然出现 401 错误，检查 API 密钥是否正确

## 🎯 关键代码位置

| 位置 | 文件 | 作用 |
|------|------|------|
| URL 配置 | `openclaw.json` | 用户配置自定义 baseUrl |
| URL 解析 | `extensions/openai/shared.ts` | `resolveConfiguredOpenAIBaseUrl()` |
| 模型初始化 | `extensions/openai/openai-provider.ts` | `resolveOpenAIGpt54ForwardCompatModel()` |
| 客户端创建 | `src/agents/openai-transport-stream.ts` | `createOpenAIClient()` |
| HTTP 请求 | `src/agents/openai-transport-stream.ts` | `new OpenAI()` 初始化 |

## 🔗 相关代码链接

- URL 配置函数: `resolveConfiguredOpenAIBaseUrl()` (shared.ts:40-42)
- 模型解析函数: `resolveOpenAIGpt54ForwardCompatModel()` (openai-provider.ts:118+)
- 客户端初始化: `createOpenAIClient()` (openai-transport-stream.ts:640+)
- HTTP 调用: `createOpenAIResponsesTransportStreamFn()` (openai-transport-stream.ts:652+)

---

**修复创建日期**: 2026-04-23
**提交**:
- a434cf5fc0: fix: read OpenAI baseUrl from config instead of hardcoding
- 1de4270816: feat: add debug logging for model baseUrl in transport stream
- c55b248178: refactor: use resolveConfiguredOpenAIBaseUrl utility function
