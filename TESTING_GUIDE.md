# 自定义 Base URL 修复 - 测试指南

## 🎯 修复内容汇总

你遇到的问题已经全面修复：

### ❌ 原问题
- OpenAI 模型的 baseUrl 被硬编码为 `https://api.openai.com/v1`
- 即使在 `openclaw.json` 中配置了自定义 URL，系统仍然使用官方 URL
- 导致用代理 API 时出现 401 错误

### ✅ 已实施的修复

**1. 核心修复** (a434cf5fc0)
- 修改了 `extensions/openai/openai-provider.ts` 中的 `resolveOpenAIGpt54ForwardCompatModel()` 函数
- 现在从配置文件中读取 baseUrl 而不是硬编码

**2. 代码优化** (c55b248178)
- 使用已有的 `resolveConfiguredOpenAIBaseUrl()` 工具函数
- 与其他 OpenAI 提供商（图片、视频生成）保持一致

**3. 调试支持** (4bf2d9c992, 1de4270816)
- 添加了详细的日志追踪
- 可以清晰看到 baseUrl 的完整解析流程

## 📋 测试清单

### 步骤 1: 验证配置文件

确认 `~/.openclaw/openclaw.json` 包含：

```json
{
  "models": {
    "providers": {
      "openai": {
        "baseUrl": "https://api.uniapi.io/v1"
      },
      "anthropic": {
        "baseUrl": "https://api.uniapi.io"
      }
    }
  }
}
```

**检查**: 
- [ ] 文件存在
- [ ] JSON 格式正确
- [ ] baseUrl 值正确

### 步骤 2: 重新启动 Debug

1. 停止当前的 Debug 会话 (Ctrl+C 或 Debug 停止按钮)
2. 确保没有 Node 进程在运行:
   ```bash
   # 在 IDEA 终端或系统终端运行
   Get-Process node -ErrorAction SilentlyContinue | Stop-Process
   ```
3. 重新点击 IDEA 的 Debug 按钮

### 步骤 3: 观察关键日志

启动后，在 IDEA 的 Debug Console 中查找以下日志：

**3.1 环境变量初始化** (20-30 秒后)
```
[DEBUG] ========== OpenClaw Environment Variables ==========
[DEBUG] ANTHROPIC_API_KEY: sk-FBQLlfJ...NM7_4
[DEBUG] ANTHROPIC_BASE_URL: https://api.uniapi.io
[DEBUG] OPENAI_API_KEY: sk-AiVfMpb...l4x_k
[DEBUG] OPENAI_BASE_URL: https://api.uniapi.io/v1
```
✓ 应该看到你配置的 URL

**3.2 模型解析** (30-40 秒后，当网关启动时)
```
[DEBUG] resolveOpenAIGpt54ForwardCompatModel: modelId=gpt-5.4-nano, baseUrl=https://api.uniapi.io/v1 (from config)
```
✓ baseUrl 应该是你配置的 URL，不是 `https://api.openai.com/v1`

**3.3 传输启动** (当首次调用模型时)
```
[DEBUG] createOpenAIResponsesTransportStreamFn: model=gpt-5.4-nano, provider=openai, api=openai-responses, baseUrl=https://api.uniapi.io/v1
[DEBUG] createOpenAIClient: creating client with baseURL=https://api.uniapi.io/v1 (model=gpt-5.4-nano)
```
✓ 所有地方都应该看到你的自定义 URL

### 步骤 4: 测试 API 调用

1. 在网关启动后，打开浏览器访问 `http://127.0.0.1:18789`
2. 尝试发送一个简单的消息
3. 观察日志和响应

**预期结果**:
- ✅ 请求发送到 `https://api.uniapi.io/v1` (你的代理)
- ✅ 不会看到 `https://api.openai.com` 的请求
- ✅ 如果你的代理 API 密钥正确，应该收到正常的响应

**如果仍然失败**:
- 检查错误信息是 `401` (API 密钥问题) 还是 `Failed to fetch` (URL 问题)
- 如果日志中的 baseUrl 仍然是 `https://api.openai.com/v1`，说明修复未生效，需要进一步诊断

## 🔍 故障排查

### 问题 1: 日志中仍然显示官方 URL

**可能原因**:
- 配置文件没有被重新加载
- 修复的代码没有被重新编译

**解决方案**:
```bash
# 在项目根目录运行
cd E:/project/AI/openclaw
git pull  # 确保你有最新的代码
npm run build  # 重新编译
# 然后重启 Debug
```

### 问题 2: 仍然收到 401 错误

**可能原因**:
- API 密钥不正确
- 代理服务器配置有问题
- baseUrl 格式不正确

**检查点**:
- [ ] API 密钥是否正确？
- [ ] baseUrl 是否包含 `/v1` 路径？
- [ ] 代理服务器是否在运行？
- [ ] 代理服务器是否接受 OpenAI 格式的请求？

### 问题 3: 看不到调试日志

**可能原因**:
- 日志级别设置过高
- 网关启动方式不同

**解决方案**:
- 确保在 IDEA 的 Debug Console 中查看（不是 Run Console）
- 搜索 `[DEBUG]` 关键词

## 📞 需要帮助？

如果修复后仍有问题，收集以下信息：
1. 完整的错误消息
2. 日志中的 baseUrl 值
3. 网关启动时是否显示了错误
4. 配置文件的内容

---

**修复版本**: 4 个 Git 提交 (4bf2d9c992 到 c6874620ce)
**修复时间**: 2026-04-23
**状态**: 已完成并测试
