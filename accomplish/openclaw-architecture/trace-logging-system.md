# OpenClaw 全链路追踪日志系统

> 建立时间：2026-05-06  
> 适用版本：当前 main 分支  
> 目的：在不接入 APM 的情况下，通过 `console.log` 在关键执行节点埋点，实现完整的请求生命周期观测、异常分支覆盖和性能耗时采集。

---

## 一、设计原则

| 原则           | 说明                                                                              |
| -------------- | --------------------------------------------------------------------------------- |
| **全分支覆盖** | `if/else`、`try/catch`、所有异常路径均有日志                                      |
| **安全截断**   | 超长字段统一用 `.substring(0, 100) + "..."` 截断，禁用复杂正则                    |
| **堆栈保护**   | catch 块内只提取 `err.message`、`err.code`、`err.status`，禁止打印整个 error 对象 |
| **耗时对齐**   | 所有成功返回节点和 finally 块必须携带 `elapsedMs`（P99 延迟监控基础）             |
| **格式统一**   | 正常分支用 `[TRACE]`，异常分支用 `[ERROR]`，序号格式为 `[节点N.M:层名-动作]`      |

---

## 二、节点序号体系

序号按数据流顺序递增，子系统用字母前缀区分。

```
主链路（7 层顺序流转）
──────────────────────────────────────────────────
1.0   入口层
2.0   路由层
2.5   注入层
3.0   执行层（主循环入口）
3.1   执行层（模型选定）
3.2   执行层（ContextToken 预算）
3.3   执行层（Compaction 超时注册）
3.4   执行层（Compaction 超时触发）[ERROR]
4.0   推理层（LLM 推理入口）
4.1~4.5  推理层（降级决策 5 种）
5.0   工具层（执行前）
5.1   工具层（执行后）
5.E1  工具层（veto 拦截）[ERROR]
5.E2  工具层（执行异常）[ERROR]
6.0   推理层（LLM 推理出口）
6.E0~E8  推理层（异常分支 9 种）
7.0   合成层（最终响应）

子系统（按需触发）
──────────────────────────────────────────────────
C1 / C2 / C.E   压缩层
M1              记忆层
```

---

## 三、完整节点清单

### 主链路节点

| 序号                                       | 类型  | 所在文件                                              | 作用                                                          | 关键字段                                                                                                                    |
| ------------------------------------------ | ----- | ----------------------------------------------------- | ------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------- |
| `节点1.0:入口层-请求入口`                  | TRACE | `gateway/server-methods/chat.ts`                      | 网关接收用户原始 Query                                        | sessionKey, rawQuery(截300)                                                                                                 |
| `节点2.0:路由层-技能路由`                  | TRACE | `auto-reply/reply/get-reply-inline-actions.ts`        | 判断是否命中 `/skill` 命令（if/else 全覆盖）                  | skillName 或 commandBodyNormalized, 可用Skills数                                                                            |
| `节点2.5:注入层-Skill提示注入`             | TRACE | `agents/pi-embedded-runner/run/attempt.ts`            | 将 Skill 内容注入 System Prompt（if/else 全覆盖）             | skillsPrompt长度, 内容预览(截400)                                                                                           |
| `节点3.0:执行层-主循环入口`                | TRACE | `auto-reply/reply/agent-runner-execution.ts`          | Web UI 主执行循环每次迭代的入口（iteration>1 说明发生了重试） | runId, sessionId, iteration, provider, model                                                                                |
| `节点3.1:执行层-模型选定`                  | TRACE | `auto-reply/reply/agent-runner-execution.ts`          | Fallback 链路完成模型选定，进入本轮 LLM 执行                  | runId, sessionId, provider, model                                                                                           |
| `节点3.2:执行层-ContextToken预算`          | TRACE | `agents/pi-embedded-runner/run/attempt.ts`            | Token 上下文预算和工具结果截断阈值计算完毕                    | runId, sessionId, contextTokenBudget, toolResultMaxChars                                                                    |
| `节点3.3:执行层-Compaction超时注册`        | TRACE | `agents/pi-embedded-runner/run/attempt.ts`            | 初始超时定时器注册，compactionTimeoutMs 为压缩宽限延长量      | runId, sessionId, timeoutMs, compactionTimeoutMs                                                                            |
| `节点3.4:执行层-Compaction超时触发`        | ERROR | `agents/pi-embedded-runner/run/attempt.ts`            | 定时器到期，强制 abort 当前 Agent 执行                        | runId, sessionId, reason, timedOutDuringCompaction                                                                          |
| `节点4.0:推理层-LLM推理入口`               | TRACE | `agents/pi-embedded-runner/run/attempt.ts`            | `activeSession.prompt()` 调用前，LLM 请求即将发出             | runId, provider, model, contextMessages, tools数, prompt(截200)                                                             |
| `节点4.1:推理层-降级-空闲超时重试`         | TRACE | `agents/pi-embedded-runner/run/assistant-failover.ts` | LLM 长时间无输出，触发同模型重试                              | provider, model, elapsedMs                                                                                                  |
| `节点4.2:推理层-降级-Profile轮换`          | TRACE | `agents/pi-embedded-runner/run/assistant-failover.ts` | Auth Profile 轮换成功，准备重试                               | provider, model, failoverReason, overloadRotations, elapsedMs                                                               |
| `节点4.3:推理层-降级-Overload升级Fallback` | ERROR | `agents/pi-embedded-runner/run/assistant-failover.ts` | Profile 轮换次数超上限，升级为模型级 Fallback                 | provider, model, rotations, limit, status, elapsedMs                                                                        |
| `节点4.4:推理层-降级-限流`                 | ERROR | `agents/pi-embedded-runner/run/assistant-failover.ts` | 触发 rate_limit，进入 Profile 级 Fallback 升级流程            | provider, model, failoverReason, elapsedMs                                                                                  |
| `节点4.5:推理层-降级-正常continue`         | TRACE | `agents/pi-embedded-runner/run/assistant-failover.ts` | 无需降级，正常继续后续处理                                    | provider, model, elapsedMs                                                                                                  |
| `节点5.0:工具层-执行前`                    | TRACE | `agents/pi-tool-definition-adapter.ts`                | 工具即将执行，记录入参                                        | tool, callId, params(截500)                                                                                                 |
| `节点5.1:工具层-执行后`                    | TRACE | `agents/pi-tool-definition-adapter.ts`                | 工具执行完毕，记录结果                                        | tool, elapsedMs, rawResult(截500)                                                                                           |
| `节点5.E1:工具层-veto拦截`                 | ERROR | `agents/pi-tool-definition-adapter.ts`                | before_tool_call hook 拦截，工具不会实际执行                  | tool, callId, reason(截100)                                                                                                 |
| `节点5.E2:工具层-执行异常`                 | ERROR | `agents/pi-tool-definition-adapter.ts`                | 工具执行抛出异常，返回错误结果（不中断 Agent 主流程）         | tool, callId, errMsg(截100), errCode, errStatus                                                                             |
| `节点6.0:推理层-LLM推理出口`               | TRACE | `agents/pi-embedded-runner/run/attempt.ts`            | `activeSession.prompt()` 返回，多轮推理结束                   | runId, totalMessages, elapsedMs                                                                                             |
| `节点6.E0:推理层-异常分类`                 | TRACE | `auto-reply/reply/agent-runner-execution.ts`          | 捕获到异常，打印所有 isXxx 分类布尔值（一行覆盖所有分支）     | runId, sessionId, msg(截100), isBilling, isContextOverflow, isCompaction, isSessionCorruption, isRoleOrder, isTransientHttp |
| `节点6.E1:推理层-异常-ModelSwitch超重试`   | ERROR | `auto-reply/reply/agent-runner-execution.ts`          | 模型实时切换重试次数超上限，放弃并返回错误                    | runId, provider, model, retries, maxRetries                                                                                 |
| `节点6.E2:推理层-异常-Context溢出`         | ERROR | `auto-reply/reply/agent-runner-execution.ts`          | prompt 超出模型上下文窗口                                     | runId, sessionId, msg(截100)                                                                                                |
| `节点6.E3:推理层-异常-计费错误`            | ERROR | `auto-reply/reply/agent-runner-execution.ts`          | 账户余额/计费类错误                                           | runId, sessionId, isFallbackSummary                                                                                         |
| `节点6.E4:推理层-异常-限流过载`            | ERROR | `auto-reply/reply/agent-runner-execution.ts`          | 限流或服务过载，进入用户提示分支                              | runId, sessionId, isRateLimit, isPureTransient                                                                              |
| `节点6.E5:推理层-异常-Compaction失败`      | ERROR | `auto-reply/reply/agent-runner-execution.ts`          | 上下文压缩失败，触发会话重置                                  | runId, sessionId, msg(截100)                                                                                                |
| `节点6.E6:推理层-异常-会话历史污染`        | ERROR | `auto-reply/reply/agent-runner-execution.ts`          | Gemini function call 顺序错误，触发会话重置                   | runId, sessionKey, corruptedSessionId                                                                                       |
| `节点6.E7:推理层-异常-角色顺序错误`        | ERROR | `auto-reply/reply/agent-runner-execution.ts`          | assistant/user 消息顺序非法                                   | runId, sessionKey, msg(截100)                                                                                               |
| `节点6.E8:推理层-异常-瞬时HTTP重试`        | TRACE | `auto-reply/reply/agent-runner-execution.ts`          | 502/521 等瞬时 HTTP 错误，延迟后重试全链路                    | runId, msg(截100), retryDelayMs                                                                                             |
| `节点7.0:合成层-最终响应`                  | TRACE | `auto-reply/reply/agent-runner.ts`                    | replyPayloads 组装完成，准备发送给用户                        | payloads数, finalText(截300)                                                                                                |

### 子系统节点

| 序号                            | 类型  | 所在文件                               | 作用                          | 关键字段                                                                                      |
| ------------------------------- | ----- | -------------------------------------- | ----------------------------- | --------------------------------------------------------------------------------------------- |
| `节点C1:压缩层-Compaction开始`  | TRACE | `agents/pi-embedded-runner/compact.ts` | 上下文压缩正式启动            | runId, sessionId, trigger, provider/model, messageCount, estTokens                            |
| `节点C2:压缩层-Compaction完成`  | TRACE | `agents/pi-embedded-runner/compact.ts` | 压缩成功                      | runId, sessionId, tokensBefore, tokensAfter, compactedCount, messageCountAfter, **elapsedMs** |
| `节点C.E:压缩层-Compaction失败` | ERROR | `agents/pi-embedded-runner/compact.ts` | 压缩过程出错，返回失败结果    | runId, sessionId, reason(截100), **elapsedMs**                                                |
| `节点M1:记忆层-Memory检索配置`  | TRACE | `agents/memory-search.ts`              | 向量+文本混合检索配置解析完毕 | agentId, vectorEnabled, vectorWeight, sources数, provider, **elapsedMs**                      |

---

## 四、数据流可视化

```
用户消息
    │
    ▼
[1.0 入口层] chat.ts
    │  sessionKey + rawQuery
    ▼
[2.0 路由层] get-reply-inline-actions.ts
    ├─ 命中 /skill → 打印 skillName
    └─ 未命中 → 打印 commandBody，直通 LLM
    │
    ▼
[2.5 注入层] attempt.ts
    ├─ 有 skillsPrompt → 注入 System Prompt
    └─ 无 skillsPrompt → 跳过
    │
    ▼
[3.0 执行层] agent-runner-execution.ts  ← while(true) 循环
    │  iteration=N（>1 说明发生重试）
    ▼
[3.1 执行层] 模型/Fallback 选定
    │
    ▼
[3.2 执行层] ContextToken 预算计算
    │
    ▼
[3.3 执行层] Compaction 超时注册
    │         （异步）[3.4 ERROR] 超时触发时 abort
    ▼
[4.0 推理层] LLM 推理入口
    │  activeSession.prompt() 开始
    │
    │  ┌──────────────────────────────┐
    │  │ LLM 推理过程中（多轮）        │
    │  │                              │
    │  │  [5.0] 工具执行前             │
    │  │  [5.1] 工具执行后             │
    │  │  [5.E1 ERROR] veto 拦截      │
    │  │  [5.E2 ERROR] 工具异常       │
    │  │                              │
    │  │  LLM 调用失败时：            │
    │  │  [4.1] 空闲超时重试          │
    │  │  [4.2] Profile 轮换          │
    │  │  [4.3 ERROR] Overload 升级   │
    │  │  [4.4 ERROR] 限流            │
    │  │  [4.5] 正常 continue         │
    │  └──────────────────────────────┘
    │
    ▼
[6.0 推理层] LLM 推理出口
    │  activeSession.prompt() 返回
    │
    ├─ 正常 ──────────────────────────────────▶
    │
    └─ 异常 → [6.E0] 异常分类
                  ├─ [6.E1] ModelSwitch 超重试
                  ├─ [6.E2] Context 溢出
                  ├─ [6.E3] 计费错误
                  ├─ [6.E4] 限流/过载
                  ├─ [6.E5] Compaction 失败
                  ├─ [6.E6] 会话历史污染
                  ├─ [6.E7] 角色顺序错误
                  └─ [6.E8] 瞬时 HTTP → 重试回 3.0
    │
    ▼
[7.0 合成层] agent-runner.ts
    │  构建 replyPayloads，发送给用户
    ▼
  响应输出

子系统（独立触发）
  [C1→C2] 压缩流程：Compaction开始 → 完成（含 tokensBefore/After）
  [C.E]   压缩失败
  [M1]    记忆检索配置（每次 Agent 启动时解析）
```

---

## 五、日志格式规范

```typescript
// 正常分支
console.log(
  `[TRACE][节点N.M:层名-动作] key1="val1" key2=${num} elapsedMs=${Date.now() - startedAt}`,
);

// 异常分支
console.log(
  `[ERROR][节点N.M:层名-动作] key1="val1" errMsg="${err.message.substring(0, 100)}..." errCode="${err?.code ?? "none"}" errStatus="${err?.status ?? "none"}"`,
);
```

**字段命名约定**

| 字段         | 说明                                              |
| ------------ | ------------------------------------------------- |
| `runId`      | 每次 Agent 执行的唯一 ID，并发时用于串联请求      |
| `sessionId`  | 会话 ID（对应 transcript 文件）                   |
| `sessionKey` | 用户侧会话标识（Web UI 显示的那个）               |
| `provider`   | LLM 提供商（如 anthropic、openai）                |
| `model`      | 模型 ID（如 claude-sonnet-4-6）                   |
| `elapsedMs`  | 当前节点到计时起点的耗时（ms），用于 P99 监控     |
| `msg(截100)` | 错误信息截断为 100 字，防止超大 HTTP 响应体被打印 |

---

## 六、已修改文件清单

| 文件                                                  | 修改内容                          |
| ----------------------------------------------------- | --------------------------------- |
| `gateway/server-methods/chat.ts`                      | 节点 1.0                          |
| `auto-reply/reply/get-reply-inline-actions.ts`        | 节点 2.0（if/else 全覆盖）        |
| `agents/pi-embedded-runner/run/attempt.ts`            | 节点 2.5、3.2、3.3、3.4、4.0、6.0 |
| `auto-reply/reply/agent-runner-execution.ts`          | 节点 3.0、3.1、6.E0~E8            |
| `agents/pi-tool-definition-adapter.ts`                | 节点 5.0、5.1、5.E1、5.E2         |
| `agents/pi-embedded-runner/run/assistant-failover.ts` | 节点 4.1~4.5                      |
| `auto-reply/reply/agent-runner.ts`                    | 节点 7.0                          |
| `agents/pi-embedded-runner/compact.ts`                | 节点 C1、C2、C.E                  |
| `agents/memory-search.ts`                             | 节点 M1                           |

---

## 七、grep 快速检索

```bash
# 查看某次请求的完整链路（用 runId 串联）
node scripts/run-node.mjs logs --follow | grep 'runId="abc-123"'

# 只看异常节点
node scripts/run-node.mjs logs --follow | grep '\[ERROR\]'

# 只看工具执行
node scripts/run-node.mjs logs --follow | grep '节点5\.'

# 只看降级决策
node scripts/run-node.mjs logs --follow | grep '节点4\.[1-5]'

# 只看压缩子系统
node scripts/run-node.mjs logs --follow | grep '节点C'

# 统计某段时间内的异常分布
node scripts/run-node.mjs logs | grep '\[ERROR\]' | grep -oP '节点[^\]]+' | sort | uniq -c | sort -rn
```
