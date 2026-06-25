---
summary: "What experimental flags mean in OpenClaw and which ones are currently documented"
title: "Experimental features"
read_when:
  - You see an `.experimental` config key and want to know whether it is stable
  - You want to try preview runtime features without confusing them with normal defaults
  - You want one place to find the currently documented experimental flags
---

OpenClaw 中的实验功能是**选择加入预览表面**。他们是
在明确的标志后面，因为他们仍然需要现实世界的里程数
值得稳定的违约或长期的公共合同。

与普通配置不同地对待它们：

- 让它们**默认关闭**，除非相关文档告诉你尝试一下。
- 预计**形状和行为的变化**比稳定配置更快。
- 当稳定路径已经存在时，优先选择稳定路径。
- 如果你要广泛推广 OpenClaw，请在较小的范围内测试实验标志
  环境，然后将它们烘焙到共享基线中。

## 当前记录的标志

|表面|关键|当 | 时使用它更多 |
| ------------------------ | -------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------- |
|本地模型运行时 | `agents.defaults.experimental.localModelLean` |更小或更严格的本地后端会阻塞 OpenClaw 的完整默认工具表面 | [本地模型](/gateway/local-models) |
|内存搜索| `agents.defaults.memorySearch.experimental.sessionMemory` |你希望 `memory_search` 索引先前的会话记录并接受额外的存储/索引成本 | [内存配置参考](/reference/memory-config#session-memory-search-experimental) |
|结构化规划工具| `tools.experimental.planTool` |你希望公开结构化的 `update_plan` 工具，以便在兼容的运行时和 UI 中进行多步骤工作跟踪 | [Gateway 配置参考](/gateway/config-tools#toolsexperimental) |

## 本地模型精益模式

`agents.defaults.experimental.localModelLean: true` 是泄压阀
对于较弱的本地模型设置。它修剪了重量级默认工具，例如
`browser`、`cron` 和 `message` 因此提示形状更小且不易碎
适用于小上下文或更严格的 OpenAI 兼容后端。

这是故意的**不是**正常的路径。如果你的后端处理完整的
干净地运行时，将其关闭。

## 实验并不意味着隐藏

如果某个功能是实验性的，OpenClaw 应该在文档和文档中明确说明
配置路径本身。它**不**做的是将预览行为偷偷带入
看起来稳定的默认旋钮并假装这是正常的。就是这样配置的
表面变得凌乱。

## 相关

- [功能](/concepts/features)
- [发布渠道](/install/development-channels)
