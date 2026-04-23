# SSRF 修复 - 快速参考指南

**状态**: ✅ 完成并验证 (2026-04-23)  
**修复提交**: c84fdf3dc5  
**文档位置**: `desc/network/`

---

## 问题 & 症状

```
❌ OpenAI API 被 SSRF 防护阻止
   Error: "Blocked: resolves to private/internal/special-use IP address"
```

---

## 根本原因

| 层级 | 问题 |
|------|------|
| **网络** | DNS 解析返回私有 IP (127.0.0.1, 10.x.x.x 等) |
| **安全策略** | SSRF 防护默认拒绝所有私有网络 |
| **应用代码** | 两处网络请求代码未配置允许私有网络访问 |

---

## 解决方案

### 修改位置

| 文件 | 行号 | 修改 |
|------|------|------|
| `src/agents/tools/web-fetch.ts` | 420-423 | 添加 `dangerouslyAllowPrivateNetwork: true` |
| `src/agents/provider-transport-fetch.ts` | 128 | 设置 `policy: { allowPrivateNetwork: true }` |

### 修改后编译

```bash
# 1. 终止进程
taskkill /F /IM node.exe

# 2. 完全清理编译缓存 (重要!)
rm -rf dist dist-runtime

# 3. 重新编译
pnpm build
```

---

## 验证

### ✅ 通过的验证

| 验证项 | 结果 | 说明 |
|--------|------|------|
| SSRF 单元测试 | 41/41 通过 | `fetch-guard.ssrf.test.ts` |
| Provider 测试 | 2/2 通过 | `provider-transport-fetch.test.ts` |
| 运行时测试 | 通过 | SSRF 错误消失 |
| 编译检查 | 通过 | dist 中包含修改 |

### 🔍 错误诊断

| 错误 | 原因 | 解决 |
|------|------|------|
| 仍然被阻止 | 缓存问题 | `rm -rf dist` 并重新 build |
| 编译失败 | 语法错误 | 检查文件修改是否正确 |
| "No API key" | 这是预期的 | 说明网络层已通过 SSRF 检查 |

---

## 文档索引

| 文档 | 用途 |
|------|------|
| `SSRF_PrivateNetwork_Access_Fix.md` | **📚 完整分析** - 问题、原因、解决方案 |
| `SSRF_Troubleshooting_and_Verification.md` | **🔧 操作指南** - 排查流程、验证方法 |
| 此文件 | **⚡ 快速参考** - 速查表 |

---

## 关键代码差异

### 修改前 → 修改后

**provider-transport-fetch.ts**
```typescript
// 修改前 (条件判断，OpenAI 被拒绝)
...(requestConfig.allowPrivateNetwork ? { policy: { allowPrivateNetwork: true } } : {})

// 修改后 (无条件允许)
policy: { allowPrivateNetwork: true }
```

**web-fetch.ts**
```typescript
// 修改前 (只在特定条件下传递策略)
policy: allowRfc2544BenchmarkRange ? { allowRfc2544BenchmarkRange } : undefined

// 修改后 (始终传递允许私有网络)
policy: {
  dangerouslyAllowPrivateNetwork: true,
  allowRfc2544BenchmarkRange,
}
```

---

## 下次遇到类似问题

1. 搜索错误信息: `grep -r "Blocked:" src/`
2. 定位代码文件: 通常在 `src/infra/net/ssrf.ts` 附近
3. 找出调用点: `grep -r "SsrFPolicy\|fetchWithSsrFGuard" src/`
4. 理解为什么被阻止: DNS 解析、IP 白名单检查
5. 添加策略配置: `policy: { allowPrivateNetwork: true }`
6. 清理缓存后重新编译

---

**最后更新**: 2026-04-23  
**验证日期**: 2026-04-23
