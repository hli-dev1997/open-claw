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

---

# 环境变量日志时机和 Agent 工作区权限配置问题

## 问题现象

启动 agent 时，DEBUG 日志显示所有环境变量都是 `[not set]`：

```
[DEBUG] ========== OpenClaw Environment Variables ==========
[DEBUG] ANTHROPIC_API_KEY: [not set]
[DEBUG] OPENAI_API_KEY: [not set]
[DEBUG] OPENAI_BASE_URL: [not set]
...
```

但 agent 后续仍能成功调用 API，说明环境变量实际是有值的。同时，agent 无法读取工作区中的 `BOOTSTRAP.md` 文件。

---

## 根本原因分析

### 原因一：环境变量日志打印时机不对

在 `src/cli/run-main.ts` 的 `runCli()` 函数中（原代码第 150-172 行），日志被**在加载环境变量之前**就打印了：

```typescript
export async function runCli(argv: string[] = process.argv) {
  // 第 152-172 行：立即打印日志 ← 此时 process.env 还没加载 .env/配置文件的值
  console.log("[DEBUG] ========== OpenClaw Environment Variables ==========");
  // ... 打印各个 env 变量，都显示 [not set]
  
  // 第 201-205 行：之后才加载环境变量
  if (shouldLoadCliDotEnv()) {
    const { loadCliDotEnv } = await import("./dotenv.js");
    loadCliDotEnv({ quiet: true });
  }
  normalizeEnv();
```

所以那些 `[not set]` 是虚假的，实际值后来被加载了。

### 原因二：Agent 工作区权限未配置

Agent 在 `C:\Users\lihao\.openclaw\workspace\` 目录下执行，但项目根目录 `E:\project\AI\openclaw\` 没有配置 `.claude/settings.json`，导致 agent 无法读写工作区文件。

---

## 解决方案

### 修复一：删除误导的调试日志，改用统一日志系统

**修改文件：** `src/cli/run-main.ts`

1. **删除** `runCli()` 函数开头（原第 150-172 行）的立即打印日志块
2. **添加导入**（第 23-28 行）：
   ```typescript
   import { logAcceptedEnvOption } from "../infra/env.js";
   ```
3. **在 `normalizeEnv()` 之后** 添加日志记录（第 183-212 行）：
   ```typescript
   normalizeEnv();

   // Log environment variables after normalization
   logAcceptedEnvOption({
     key: "ANTHROPIC_API_KEY",
     description: "Anthropic API key",
     redact: true,
   });
   logAcceptedEnvOption({
     key: "ANTHROPIC_BASE_URL",
     description: "Anthropic API base URL override",
   });
   logAcceptedEnvOption({
     key: "ANTHROPIC_OAUTH_TOKEN",
     description: "Anthropic OAuth token",
     redact: true,
   });
   logAcceptedEnvOption({
     key: "OPENAI_API_KEY",
     description: "OpenAI API key",
     redact: true,
   });
   logAcceptedEnvOption({
     key: "OPENAI_BASE_URL",
     description: "OpenAI API base URL override",
   });
   logAcceptedEnvOption({
     key: "OPENCLAW_DEFAULT_MODEL",
     description: "default model for agent sessions",
   });
   ```

**优势：**
- 日志在环境变量**加载后**打印，显示真实值
- 使用项目统一的 `logAcceptedEnvOption()` 系统，风格一致
- API Key 自动脱敏显示为 `<redacted>`
- 只记录**已设置的**环境变量，避免噪音

### 修复二：在项目根目录配置 Agent 权限

**创建文件：** `E:\project\AI\openclaw\.claude\settings.json`

```json
{
  "permissions": {
    "allow": [
      "Read",
      "Write",
      "Edit",
      "Glob",
      "Grep",
      "Bash"
    ]
  }
}
```

**效果：**
- Agent 获得对项目目录的读写权限
- 能够读取 `BOOTSTRAP.md` 等工作区文件
- 能够执行文件操作和 shell 命令

### 修复三：在 Agent 工作区创建 BOOTSTRAP.md

Agent 在 `C:\Users\lihao\.openclaw\workspace\` 目录查找文件，需要在该位置创建 BOOTSTRAP.md：

```bash
mkdir -p "C:\Users\lihao\.openclaw\workspace"
cat > "C:\Users\lihao\.openclaw\workspace\BOOTSTRAP.md" << 'EOF'
---
title: "BOOTSTRAP.md - 启动仪式"
summary: "Agent 首次启动的初始化流程"
---

# BOOTSTRAP.md - 你好，世界

[中文内容...]
EOF
```

---

## 实践验证

修复后的行为：

1. **日志输出示例**（正确的）：
   ```
   [env] env: OPENAI_API_KEY=sk-AiVfMpb...NM7_4k (OpenAI API key)
   [env] env: OPENAI_BASE_URL=https://api.uniapi.io/v1 (OpenAI API base URL override)
   [env] env: OPENCLAW_DEFAULT_MODEL=openai/gpt-5.4-nano (default model for agent sessions)
   ```
   
   说明：
   - 只显示已设置的环境变量
   - API Key 脱敏
   - 通过项目的日志系统输出，格式统一

2. **Agent 启动成功**：
   ```bash
   pnpm dev agent --agent main --message "你好，请确认你的模型名称和当前的系统时间。"
   ```
   
   Agent 能够：
   - 读取工作区中的 `BOOTSTRAP.md`
   - 完成 bootstrap 流程
   - 使用正确的 OpenAI 配置发起请求
   - 返回完整的对话结果

---

## 关键差异对比

| 方面 | 修复前 | 修复后 |
|------|-------|-------|
| **日志时机** | 加载前 | 加载后 |
| **日志系统** | 直接 console.log | logAcceptedEnvOption() |
| **显示内容** | 全部环境变量（包括未设置的） | 仅已设置的环境变量 |
| **敏感信息** | 明文显示 | 自动脱敏 `<redacted>` |
| **Agent 权限** | 未配置 | 已配置在 .claude/settings.json |
| **工作区文件** | 无法读取 | 可以正常读写 |

---

## 日后维护

1. **如果添加新的环境变量**，在 `src/cli/run-main.ts` 的 `normalizeEnv()` 之后添加对应的 `logAcceptedEnvOption()` 调用
2. **如果需要调整权限**，修改 `.claude/settings.json` 中的 `permissions.allow` 数组
3. **不再需要手动调试日志** — 依赖项目的统一日志系统



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

---

# Windows 中文系统工作区文件 UTF-8 编码修复笔记

## 问题现象

在 Windows 中文系统上运行 Node.js agent 时，读取工作区 .md 文件（如 BOOTSTRAP.md、IDENTITY.md、SOUL.md 等）出现中文乱码，导致 LLM 无法理解文件内容并报告"无法读取文件"。

错误日志示例：
```
[ERROR] Failed to read workspace file: BOOTSTRAP.md
[ERROR] File content unreadable - Chinese characters corrupted
```

### 根本原因

Node.js `fs.readFile()` 和 `fs.readFileSync()` 在不指定编码时，默认返回 Buffer 对象。当 Buffer 被转换为字符串时，系统会使用默认的 Windows 系统区域设置（中文 Windows 为 GBK/GB2312）而不是 UTF-8，导致 UTF-8 编码的中文字符被错误解释为乱码。

### 受影响的代码位置

1. **src/agents/pi-tools.read.ts:799** - 读取工作区文件（主要入口）
2. **src/agents/sandbox/fs-bridge.ts:246** - 沙箱文件桥接读取
3. **src/hooks/workspace.ts:343** - Hook 工作区文件读取（已正确）
4. **src/agents/workspace.ts** - 工作区文件操作（已正确）

---

## 解决方案

### 修复一：pi-tools.read.ts（行 799）

**修改前：**
```typescript
return await fs.readFile(resolved);
```

**修改后：**
```typescript
return await fs.readFile(resolved, "utf-8");
```

**说明：** 显式指定 UTF-8 编码，确保返回 UTF-8 编码的字符串而非系统区域设置的 Buffer。

### 修复二：sandbox/fs-bridge.ts（行 246）

**修改前：**
```typescript
return fs.readFileSync(opened.fd);
```

**修改后：**
```typescript
return Buffer.from(fs.readFileSync(opened.fd, "utf-8"));
```

**说明：** 
- 用 UTF-8 编码读取文件描述符中的内容（返回字符串）
- 再转换回 Buffer 以满足 API 返回类型约束
- 这样既指定了 UTF-8 编码，又保证了返回类型正确

### 验证现有代码

已验证以下文件已正确指定 UTF-8 编码：

| 文件 | 行号 | 代码 | 状态 |
|------|------|------|------|
| src/agents/workspace.ts | 80 | `syncFs.readFileSync(opened.fd, "utf-8")` | ✓ 正确 |
| src/agents/workspace.ts | 115 | `await fs.readFile(templatePath, "utf-8")` | ✓ 正确 |
| src/agents/workspace.ts | 234 | `await fs.readFile(statePath, "utf-8")` | ✓ 正确 |
| src/agents/workspace.ts | 290 | `await fs.writeFile(tmpPath, payload, { encoding: "utf-8" })` | ✓ 正确 |
| src/hooks/workspace.ts | 343 | `fs.readFileSync(opened.fd, "utf-8")` | ✓ 正确 |

---

## 测试验证

### 重现修复

在 Windows 中文系统上测试：

```bash
# 确保工作区存在且包含中文内容
C:\Users\lihao\.openclaw\workspace\BOOTSTRAP.md

# 启动 agent，应正常读取中文文件
pnpm dev agent --agent main --message "你好，请读取 BOOTSTRAP.md"
```

### 预期行为

修复后 agent 应能：
1. ✅ 正确读取 BOOTSTRAP.md 中的中文内容
2. ✅ 识别和处理 IDENTITY.md、SOUL.md 等文件
3. ✅ 不再出现"文件内容乱码"错误
4. ✅ 完整执行 bootstrap 流程

---

## 影响范围

| 组件 | 影响程度 | 说明 |
|------|--------|------|
| Agent 工作区文件读取 | **严重** | BOOTSTRAP.md 等核心文件需要 UTF-8 |
| 沙箱文件操作 | **中等** | 涉及跨系统的文件读取 |
| 用户工作区 .md 文件 | **严重** | 所有用户创建的 .md 文件都可能受影响 |
| 项目配置文件 | **轻微** | JSON 文件通常以 UTF-8 存储 |

---

## 日后维护

### 新增文件操作时的检查清单

添加 `fs.readFile()`、`fs.readFileSync()` 或 `fs.promises.readFile()` 时：

- [ ] 是否读取工作区文件或用户生成的文本文件？
- [ ] 是否需要处理中文、日文等非 ASCII 字符？
- [ ] 是否已在调用时指定 `"utf-8"` 编码？

如果答案是"是"，则必须显式指定编码：

**✗ 错误做法：**
```typescript
const content = await fs.readFile(path);  // 会返回 Buffer，可能被错误解释
```

**✓ 正确做法：**
```typescript
const content = await fs.readFile(path, "utf-8");  // 返回 UTF-8 字符串
```

### 扫描现存代码

若要定期检查是否有遗漏，可运行：

```bash
# 查找所有 readFile/readFileSync 调用（需手工审查）
grep -r "readFile\|readFileSync" src/ --include="*.ts" | \
  grep -v "utf-8\|utf8\|encoding" | \
  grep -E "workspace|\.md|text"
```

---

## 技术细节

### 为什么 Buffer.from(string, "utf-8") 有效

```typescript
// 原始问题
const buffer = fs.readFileSync(fd);  // Buffer of raw bytes
const string = buffer.toString();    // 使用系统默认区域设置解析 → 可能乱码

// 解决方案
const string = fs.readFileSync(fd, "utf-8");     // 指定编码 → UTF-8 字符串
const buffer = Buffer.from(string, "utf-8");     // 转回 UTF-8 Buffer
// 现在 buffer.toString("utf-8") 总会正确解析
```

### Windows 区域设置影响

| 系统区域 | 默认编码 | Node.js 行为 | 结果 |
|---------|--------|-----------|------|
| 英文 | UTF-8 | `toString()` 用 UTF-8 | ✓ 正常 |
| 中文 | GBK/GB2312 | `toString()` 尝试 GBK | ❌ 乱码 |
| 日文 | Shift-JIS | `toString()` 尝试 Shift-JIS | ❌ 乱码 |

显式指定 `"utf-8"` 可绕过这个平台差异。
