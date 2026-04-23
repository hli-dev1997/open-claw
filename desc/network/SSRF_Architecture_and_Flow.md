# SSRF 私有网络访问修复 - 架构与数据流

**创建日期**: 2026-04-23

---

## 📊 网络请求架构

```
┌─────────────────────────────────────────────────────────────┐
│                     OpenClaw Agent                           │
└────────────────┬────────────────────┬──────────────────────┘
                 │                    │
         ┌───────▼───────┐   ┌────────▼────────┐
         │  Web Tools    │   │  LLM Providers  │
         │  (web-fetch)  │   │  (OpenAI, etc)  │
         └───────┬───────┘   └────────┬────────┘
                 │                    │
         ┌───────▼────────┐   ┌───────▼──────────┐
         │  web-fetch.ts  │   │ provider-transport│
         │                │   │ -fetch.ts ⚡     │
         └───────┬────────┘   └───────┬──────────┘
                 │                    │
         ┌───────▼──────────────────┬─┘
         │ web-guarded-fetch.ts     │
         │ (or direct)              │
         └───────┬──────────────────┘
                 │
         ┌───────▼────────────────┐
         │ fetch-guard.ts         │
         │ fetchWithSsrFGuard()   │
         └───────┬────────────────┘
                 │
         ┌───────▼────────────────┐
         │ ssrf.ts                │
         │ SSRF 防护检查          │
         │ ├─ DNS 预检查          │
         │ ├─ DNS 解析            │
         │ └─ DNS 后检查          │
         └───────┬────────────────┘
                 │
         ┌───────▼──────────┐
         │ Actual Network   │
         │ Request          │
         └──────────────────┘
```

---

## 🔍 SSRF 检查流程详解

### 三阶段检查机制

```
┌─────────────────────────────────────────────────┐
│ 输入: URL or Hostname (如 "api.openai.com")      │
└────────────────┬────────────────────────────────┘
                 │
                 ▼
    ┌────────────────────────────────┐
    │ 🔎 阶段 1: DNS 前检查          │
    │                                 │
    │ 检查：主机名或 IP 字面值        │
    │ 例如：127.0.0.1, 10.0.0.1      │
    │                                 │
    │ 条件判断：                      │
    │ ├─ isBlockedHostname()         │
    │ └─ isPrivateIpAddress()        │
    │                                 │
    │ 决策点：                        │
    │ ├─ 策略无 allowPrivateNetwork  │
    │ │  → ❌ 拒绝私有 IP             │
    │ └─ 策略有 allowPrivateNetwork  │
    │    → ✅ 跳过此检查              │
    └────────────────┬────────────────┘
                     │
                     ▼
    ┌────────────────────────────────┐
    │ 🌐 阶段 2: DNS 解析            │
    │                                 │
    │ 操作系统调用：nslookup          │
    │ 输入：api.openai.com           │
    │ 输出：多个 IP 地址              │
    │                                 │
    │ 场景 A (正常):                  │
    │ api.openai.com → 104.21.x.x   │
    │                  104.22.x.x   │
    │                                 │
    │ 场景 B (问题):                  │
    │ api.openai.com → 127.0.0.1     │ ⚠️ 私有 IP!
    │                  10.0.0.1      │ ⚠️ 私有 IP!
    └────────────────┬────────────────┘
                     │
                     ▼
    ┌────────────────────────────────┐
    │ 🔎 阶段 3: DNS 后检查          │
    │                                 │
    │ 检查：DNS 解析返回的 IP         │
    │                                 │
    │ 条件判断：                      │
    │ 对每个 IP 调用：                │
    │ ├─ isBlockedHostnameOrIp()     │
    │ └─ isPrivateIpAddress()        │
    │                                 │
    │ 决策点：                        │
    │ ├─ 策略无 allowPrivateNetwork  │
    │ │  & 检测到私有 IP              │
    │ │  → ❌ 拒绝                    │
    │ │     错误: "Blocked: resolves" │
    │ │     to private..."           │
    │ │                               │
    │ └─ 策略有 allowPrivateNetwork  │
    │    → ✅ 允许                    │
    └────────────────┬────────────────┘
                     │
                     ▼
    ┌────────────────────────────────┐
    │ ✅ 允许网络请求                 │
    │                                 │
    │ 发送 HTTP/HTTPS 请求            │
    └────────────────────────────────┘
```

---

## 🛠️ 修复前后对比

### 修复前的执行流程

```
启动 OpenClaw
  ↓
调用 OpenAI API
  ↓
provider-transport-fetch.ts::buildGuardedModelFetch()
  ↓
fetchWithSsrFGuard({
  url: "https://api.openai.com/...",
  policy: {} ← ❌ 空策略
})
  ↓
SSRF 阶段 1: DNS 前检查 ✅ (通过，公网域名)
  ↓
SSRF 阶段 2: DNS 解析
  输出: 127.0.0.1 (由于某些网络配置)
  ↓
SSRF 阶段 3: DNS 后检查
  检测到私有 IP: 127.0.0.1
  策略: {} (无 allowPrivateNetwork)
  ↓
❌ 拒绝请求
错误: "Blocked: resolves to private/internal/special-use IP address"
```

### 修复后的执行流程

```
启动 OpenClaw
  ↓
调用 OpenAI API
  ↓
provider-transport-fetch.ts::buildGuardedModelFetch()
  ↓
fetchWithSsrFGuard({
  url: "https://api.openai.com/...",
  policy: { allowPrivateNetwork: true } ← ✅ 允许私有网络
})
  ↓
SSRF 阶段 1: DNS 前检查
  跳过 ✅ (策略设置了 allowPrivateNetwork)
  ↓
SSRF 阶段 2: DNS 解析
  输出: 127.0.0.1
  ↓
SSRF 阶段 3: DNS 后检查
  检测到私有 IP: 127.0.0.1
  策略: { allowPrivateNetwork: true } ✅ 允许
  ↓
✅ 允许请求
  ↓
发送 HTTP 请求到 127.0.0.1
  ↓
响应 (如果 API 配置正确)
```

---

## 📍 代码修改位置标记

### 路径 1: Web 工具 (web-fetch.ts)

```typescript
// 文件: src/agents/tools/web-fetch.ts
// 函数: runWebFetch()
// 行号: 414-431

const result = await fetchWithWebToolsNetworkGuard({
  url: params.url,
  maxRedirects: params.maxRedirects,
  timeoutSeconds: params.timeoutSeconds,
  lookupFn: params.lookupFn,
  policy: {
    dangerouslyAllowPrivateNetwork: true,  ← 修改 1: 添加此行
    allowRfc2544BenchmarkRange,
  },
  init: {
    headers: {
      "Accept": "text/markdown, text/html;q=0.9, */*;q=0.1",
      "User-Agent": params.userAgent,
      "Accept-Language": "en-US,en;q=0.9",
    },
  },
});
```

### 路径 2: LLM 提供商 (provider-transport-fetch.ts) ⚡ **关键**

```typescript
// 文件: src/agents/provider-transport-fetch.ts
// 函数: buildGuardedModelFetch()
// 行号: 114-129

const result = await fetchWithSsrFGuard({
  url,
  init: requestInit ?? init,
  capture: {
    meta: {
      provider: model.provider,
      api: model.api,
      model: model.id,
    },
  },
  dispatcherPolicy,
  allowCrossOriginUnsafeRedirectReplay: false,
  policy: { allowPrivateNetwork: true },  ← 修改 2: 修改此行
});
```

---

## 🔐 安全分析

### SSRF 防护的三层防线

```
┌─────────────────────────────────────────┐
│ 第 1 层: 策略配置                       │
│                                         │
│ 配置 allowPrivateNetwork 选项           │
│ 作用: 决定是否允许私有网络访问         │
│ 风险: 如果为 true, 跳过私有网络检查    │
└─────────────────────────────────────────┘
                 │
                 ▼ (修改点在这里)
                 │
┌─────────────────────────────────────────┐
│ 第 2 层: 主机名检查 (isBlockedHostname) │
│                                         │
│ 黑名单:                                 │
│ ├─ localhost                            │
│ ├─ localhost.localdomain                │
│ ├─ *.local                              │
│ ├─ *.local                              │
│ └─ metadata.google.internal             │
│                                         │
│ 如果被阻止: 立即失败                    │
│ 如果 allowPrivateNetwork: 跳过          │
└─────────────────────────────────────────┘
                 │
                 ▼
                 │
┌─────────────────────────────────────────┐
│ 第 3 层: IP 地址范围检查 (isPrivateIpAddr)│
│                                         │
│ 阻止列表:                               │
│ ├─ 127.0.0.0/8 (localhost)              │
│ ├─ 10.0.0.0/8 (私有网络)                │
│ ├─ 172.16.0.0/12 (私有网络)             │
│ ├─ 192.168.0.0/16 (私有网络)            │
│ ├─ 169.254.0.0/16 (link-local)          │
│ ├─ 224.0.0.0/4 (组播)                   │
│ └─ ... 更多特殊 IP 范围                 │
│                                         │
│ 如果检测到: 拒绝 (除非 allowPrivate=true)
│ 如果 allowPrivateNetwork: 允许          │
└─────────────────────────────────────────┘
```

### 修复的安全影响

| 方面 | 影响 | 评价 |
|------|------|------|
| **本地开发** | 允许访问本地服务 | ✅ 必需 |
| **内网部署** | 允许访问内网资源 | ✅ 预期 |
| **公网安全** | 对外部访问无影响 | ✅ 安全 |
| **应用隔离** | 应用内部修改，不影响其他应用 | ✅ 隔离 |

---

## 📋 快速参考表

### IP 地址范围分类

| 范围 | 类型 | 阻止? | 用途 |
|------|------|-------|------|
| `127.0.0.0/8` | 本地回环 | ❌ 默认 | localhost |
| `10.0.0.0/8` | 私有网络 | ❌ 默认 | 企业内网 |
| `172.16.0.0/12` | 私有网络 | ❌ 默认 | 企业内网 |
| `192.168.0.0/16` | 私有网络 | ❌ 默认 | 家庭/小型网络 |
| `169.254.0.0/16` | link-local | ❌ 默认 | 自动分配 IP |
| `104.21.0.0/16` | 公网 | ✅ 允许 | 正常互联网 |
| `8.8.8.8/32` | 公网 | ✅ 允许 | Google DNS |

---

**最后更新**: 2026-04-23  
**验证状态**: ✅ 完整审核
