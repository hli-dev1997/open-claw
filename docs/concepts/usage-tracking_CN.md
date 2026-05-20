---
summary: "Usage tracking surfaces and credential requirements"
read_when:
  - You are wiring provider usage/quota surfaces
  - You need to explain usage tracking behavior or auth requirements
title: "Usage tracking"
---

## 它是什么

- 直接从其使用端点提取提供商的使用/配额。
- 无预计费用；仅提供商报告的窗口。
- 人类可读的状态输出被标准化为 `X% left`，即使当
  上游 API 报告消耗的配额、剩余配额或仅报告原始计数。
- 会话级别 `/status` 和 `session_status` 可以回退到最新版本
  当实时会话快照稀疏时，记录使用条目。那
  回退填充丢失的token/缓存计数器，可以恢复活动运行时
  模型标签，并且在会话时更喜欢较大的面向提示的总数
  元数据丢失或较小。现有的非零实时值仍然获胜。

## 它出现的地方

- 聊天中的`/status`：带有会话token的表情符号丰富的状态卡+估计成本（仅限API键）。当作为标准化 `X% left` 窗口提供时，提供商使用情况显示**当前模型提供商**。
- 聊天中的 `/usage off|tokens|full`：每个响应使用页脚（OAuth 仅显示token）。
- 聊天中的 `/usage cost`：从 OpenClaw 会话日志聚合的本地成本摘要。
- CLI：`openclaw status --usage` 打印每个提供商的完整细分。
- CLI：`openclaw channels list` 在提供商配置旁边打印相同的使用情况快照（使用 `--no-usage` 跳过）。
- macOS 菜单栏：上下文下的“使用”部分（仅当可用时）。

## 提供商 + 凭证

- **Anthropic (Claude)**：认证配置文件中的 OAuth token。
- **GitHub Copilot**：认证配置文件中的 OAuth token。
- **Gemini CLI**：认证配置文件中的 OAuth token。
  - JSON 用法回退到 `stats`； `stats.cached` 被标准化为
    `cacheRead`。
- **OpenAI Codex**：认证配置文件中的 OAuth token（存在时使用 accountId）。
- **MiniMax**：API 密钥或 MiniMax OAuth 认证配置文件。 OpenClaw 款待
  `minimax`、`minimax-cn` 和 `minimax-portal` 作为相同的 MiniMax 配额
  表面，首选存储的 MiniMax OAuth（如果存在），否则回退
  至 `MINIMAX_CODE_PLAN_KEY`、`MINIMAX_CODING_API_KEY` 或 `MINIMAX_API_KEY`。
  MiniMax 的原始 `usage_percent` / `usagePercent` 字段意味着 **剩余**
  配额，因此 OpenClaw 在显示之前反转它们；基于计数的字段在以下情况下获胜
  存在。
  - 编码计划窗口标签来自提供商小时/分钟字段
    存在，然后回退到 `start_time` / `end_time` 跨度。
  - 如果编码计划端点返回 `model_remains`，则 OpenClaw 更喜欢
    聊天模型条目，在明确时从时间戳导出窗口标签
    `window_hours` / `window_minutes` 字段不存在，并且包括模型
    计划标签中的名称。
- **Xiaomi MiMo**：通过 env/config/auth 存储的 API 密钥 (`XIAOMI_API_KEY`)。
- **z.ai**：通过 env/config/auth 存储的 API 密钥。

当无法解析可用的提供商使用认证时，使用情况将被隐藏。供应商
可以提供特定于插件的使用验证逻辑；否则 OpenClaw 回退到
匹配来自认证配置文件、环境变量的 OAuth/API-key 凭据，
或配置。

## 相关

- [token使用和成本](/reference/token-use)
- [API 使用和成本](/reference/api-usage-costs)
- [提示缓存](/reference/prompt-caching)
