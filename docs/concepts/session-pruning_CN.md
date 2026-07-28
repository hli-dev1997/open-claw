---
summary: "Trimming old tool results to keep context lean and caching efficient"
title: "Session pruning"
read_when:
  - You want to reduce context growth from tool outputs
  - You want to understand Anthropic prompt cache optimization
---

会话修剪会从每个 LLM 之前的上下文中修剪**旧工具结果**
打电话。它减少了累积工具输出（执行结果、文件
读取、搜索结果），无需重写正常的对话文本。

<Info>
修剪仅在内存中进行——它不会修改磁盘上的会话记录。
你的完整历史记录始终被保留。
</Info>

## 为什么这很重要

长时间的会话会累积工具输出，从而扩大上下文窗口。这个
增加成本并可以强制 [compaction](/concepts/compaction) 早于
必要的。

修剪对于 **Anthropic 提示缓存**特别有价值。缓存后
TTL 过期，下一个请求重新缓存完整提示。修剪可减少
缓存写入大小，直接降低成本。

## 它是如何工作的

1.等待缓存TTL过期（默认5分钟）。2. 查找旧工具结果进行正常修剪（对话文本保留）。3. **软修剪**超大结果——保留头部和尾部，插入`...`。4. **硬清除**其余部分——用占位符替换。5. 重置 TTL 以便后续请求重用新的缓存。

## 旧图像清理

OpenClaw 还为以下会话构建了一个单独的幂等重播视图：
将原始图像块或即时水合媒体标记保留在历史中。

- 它逐字节保留 **3 个最近完成的回合**，因此提示
  最近后续的缓存前缀保持稳定。
- 在重放视图中，来自 `user` 的较旧的已处理图像块或
  `toolResult` 历史记录可以替换为
  `[image data removed - already processed by model]`。
- 较旧的文本媒体参考，例如 `[media attached: ...]`，
  `[Image: source: ...]` 和 `media://inbound/...` 可以替换为
  `[media reference removed - already processed by model]`。电流匝数
  附着标记保持完整，因此视觉模型仍然可以保持新鲜
  图像。
- 原始会话记录不会被重写，因此历史记录查看者仍然可以
  渲染原始消息条目及其图像。
- 这与普通缓存-TTL 修剪是分开的。它的存在是为了停止重复
  图像有效负载或陈旧的媒体引用来自稍后的提示缓存。

## 智能默认值

OpenClaw 自动启用 Anthropic 配置文件的修剪：

| 型材类型                                          | 修剪已启用 | 心跳    |
| ------------------------------------------------- | ---------- | ------- |
| Anthropic OAuth/token认证（包括 Claude CLI 重用） | 是的       | 1小时   |
| API 键                                            | 是的       | 30 分钟 |

如果你设置显式值，OpenClaw 不会覆盖它们。

## 启用或禁用

对于非 Anthropic 提供商，修剪默认处于关闭状态。启用：

```json5
{
  agents: {
    defaults: {
      contextPruning: { mode: "cache-ttl", ttl: "5m" },
    },
  },
}
```

要禁用：设置 `mode: "off"`。

## 修剪与压缩

|              | 修剪           | 压实               |
| ------------ | -------------- | ------------------ |
| **什么**     | 修剪工具结果   | 总结对话           |
| **已保存？** | 否（每个请求） | 是（在文字记录中） |
| **范围**     | 仅工具结果     | 整个对话           |

它们相辅相成——修剪使工具输出保持精简
压实循环。

## 进一步阅读

- [Compaction](/concepts/compaction) -- 基于摘要的上下文缩减
- [Gateway Configuration](/gateway/configuration) -- 所有修剪配置旋钮
  (`contextPruning.*`)

## 相关

- [会话管理](/concepts/session)
- [会话工具](/concepts/session-tool)
- [上下文引擎](/concepts/context-engine)
