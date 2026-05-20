---
summary: "Context engine: pluggable context assembly, compaction, and subagent lifecycle"
read_when:
  - You want to understand how OpenClaw assembles model context
  - You are switching between the legacy engine and a plugin engine
  - You are building a context engine plugin
title: "Context engine"
sidebarTitle: "Context engine"
---

**上下文引擎**控制 OpenClaw 如何为每次运行构建模型上下文：要包含哪些消息、如何总结较旧的历史记录以及如何管理跨子智能体边界的上下文。

OpenClaw 附带内置 `legacy` 引擎并默认使用它 - 大多数用户永远不需要更改它。仅当你需要不同的组装、压缩或跨会话调用行为时，才安装并选择插件引擎。

## 快速开始

<Steps>
  <Step title="Check which engine is active">
    ```bash
    openclaw doctor
    # or inspect config directly:
    cat ~/.openclaw/openclaw.json | jq '.plugins.slots.contextEngine'
    ```
  </Step>
  <Step title="Install a plugin engine">
    上下文引擎插件的安装方式与任何其他 OpenClaw 插件一样。

    <Tabs>
      <Tab title="From npm">
        ```bash
        openclaw plugins install @martian-engineering/lossless-claw
        ```
      </Tab>
      <Tab title="From a local path">
        ```bash
        openclaw plugins install -l ./my-context-engine
        ```
      </Tab>
    </Tabs>

  </Step>
  <Step title="Enable and select the engine">
    ```json5
    // openclaw.json
    {
      plugins: {
        slots: {
          contextEngine: "lossless-claw", // must match the plugin's registered engine id
        },
        entries: {
          "lossless-claw": {
            enabled: true,
            // Plugin-specific config goes here (see the plugin's docs)
          },
        },
      },
    }
    ```

    安装并配置后重新启动网关。

  </Step>
  <Step title="Switch back to legacy (optional)">
    将 `contextEngine` 设置为 `"legacy"` （或完全删除该密钥 — `"legacy"` 是默认值）。
  </Step>
</Steps>

## 它是如何工作的

每次 OpenClaw 运行模型提示时，上下文引擎都会在四个生命周期点参与：

<AccordionGroup>
  <Accordion title="1. Ingest">
    当新消息添加到会话时调用。引擎可以在其自己的数据存储中存储或索引消息。
  </Accordion>
  <Accordion title="2. Assemble">
    在每个模型运行之前调用。引擎返回符合token预算的一组有序消息（以及可选的 `systemPromptAddition`）。
  </Accordion>
  <Accordion title="3. Compact">
    当上下文窗口已满或用户运行 `/compact` 时调用。该引擎总结了较早的历史以释放空间。
  </Accordion>
  <Accordion title="4. After turn">
    运行完成后调用。引擎可以保留状态、触发后台压缩或更新索引。
  </Accordion>
</AccordionGroup>

对于捆绑的非 ACP Codex 线束，OpenClaw 通过将组装的上下文投影到 Codex 开发人员指令和当前转弯提示中来应用相同的生命周期。 Codex 仍然拥有其本机线程历史记录和本机压缩器。

### 子智能体生命周期（可选）

OpenClaw 调用两个可选的子智能体生命周期挂钩：

<ParamField path="prepareSubagentSpawn" type="method">
  在子运行开始之前准备共享上下文状态。该挂钩接收父/子会话密钥、`contextMode`（`isolated` 或 `fork`）、可用的转录本 ID/文件以及可选的 TTL。如果它返回回滚句柄，则在准备成功后生成失败时 OpenClaw 会调用它。
</ParamField>
<ParamField path="onSubagentEnded" type="method">
  当子智能体会话完成或被清除时进行清理。
</ParamField>

###系统提示词添加

`assemble` 方法可以返回 `systemPromptAddition` 字符串。 OpenClaw 将其添加到运行的系统提示词符之前。这使得引擎可以注入动态召回指导、检索指令或上下文感知提示，而无需静态工作区文件。

## 遗留引擎

内置 `legacy` 引擎保留 OpenClaw 的原始行为：

- **摄取**：无操作（会话管理器直接处理消息持久性）。
- **组装**：传递（运行时中现有的清理→验证→限制管道处理上下文组装）。
- **紧凑**：委托内置的摘要压缩，它创建旧消息的单个摘要并保持最新消息的完整性。
- **转弯后**：无操作。

旧版引擎不注册工具或提供 `systemPromptAddition`。

当未设置 `plugins.slots.contextEngine`（或设置为 `"legacy"`）时，将自动使用该引擎。

## Plugin 引擎

插件可以使用插件 API 注册上下文引擎：

```ts
import { buildMemorySystemPromptAddition } from "openclaw/plugin-sdk/core";

export default function register(api) {
  api.registerContextEngine("my-engine", (ctx) => ({
    info: {
      id: "my-engine",
      name: "My Context Engine",
      ownsCompaction: true,
    },

    async ingest({ sessionId, message, isHeartbeat }) {
      // Store the message in your data store
      return { ingested: true };
    },

    async assemble({ sessionId, messages, tokenBudget, availableTools, citationsMode }) {
      // Return messages that fit the budget
      return {
        messages: buildContext(messages, tokenBudget),
        estimatedTokens: countTokens(messages),
        systemPromptAddition: buildMemorySystemPromptAddition({
          availableTools: availableTools ?? new Set(),
          citationsMode,
        }),
      };
    },

    async compact({ sessionId, force }) {
      // Summarize older context
      return { ok: true, compacted: true };
    },
  }));
}
```

工厂 `ctx` 包括可选的 `config`、`agentDir` 和 `workspaceDir`
值，以便插件可以在执行之前初始化每个智能体或每个工作区的状态
第一个生命周期挂钩运行。

然后在配置中启用它：

```json5
{
  plugins: {
    slots: {
      contextEngine: "my-engine",
    },
    entries: {
      "my-engine": {
        enabled: true,
      },
    },
  },
}
```

### ContextEngine 接口

所需成员：

|会员|亲切 |目的|
| ------------------ | -------- | -------------------------------------------------------------------- |
| `info` |物业 |引擎id、名称、版本以及是否拥有compaction |
| `ingest(params)` |方法|存储一条消息 |
| `assemble(params)` |方法|为模型运行构建上下文（返回 `AssembleResult`）|
| `compact(params)` |方法|总结/简化上下文 |

`assemble` 返回 `AssembleResult` ，其中：

<ParamField path="messages" type="Message[]" required>
  要发送到模型的有序消息。
</ParamField>
<ParamField path="estimatedTokens" type="number" required>
  引擎对组装上下文中总标记的估计。 OpenClaw 使用它来进行压缩阈值决策和诊断报告。
</ParamField>
<ParamField path="systemPromptAddition" type="string">
  添加到系统提示词符之前。
</ParamField>
<ParamField path="promptAuthority" type='"assembled" | "preassembly_may_overflow"'>
  控制运行程序使用哪个token估计来进行抢先溢出
  预检查。默认为 `"assembled"`，表示仅组装
  检查提示的估计 - 适用于返回
  窗口化、独立的上下文。仅设置为 `"preassembly_may_overflow"`
  当你的组装视图可以隐藏底层的溢出风险时
  成绩单；然后，跑步者取集合估计中的最大值
  以及决定时的预装配（无窗口）会话历史估计
  是否进行抢先压缩。无论哪种方式，你返回的消息都是
  仍然是模型所看到的 - `promptAuthority` 仅影响预检查。
</ParamField>

`compact` 返回 `CompactResult`。当压缩旋转活动时
成绩单、`result.sessionId` 和 `result.sessionFile` 标识继任者
下一次重试或轮次必须使用的会话。

可选成员：

|会员|亲切 |目的|
| ------------------------------------------ | ------ | ------------------------------------------------------------------------------------------------------------------------------ |
| `bootstrap(params)` |方法|初始化会话的引擎状态。当引擎第一次看到会话时调用一次（e.g.，导入历史记录）。 |
| `ingestBatch(params)` |方法|将一个完整的回合作为一个批次摄取。运行完成后调用，同时包含该回合的所有消息。     |
| `afterTurn(params)` |方法|运行后生命周期工作（保持状态、触发后台压缩）。                                         |
| `prepareSubagentSpawn(params)` |方法|在子会话开始之前设置共享状态。                                                       |
| `onSubagentEnded(params)` |方法|子智能体结束后进行清理。                                                                                 |
| `dispose()` |方法|释放资源。在网关关闭或插件重新加载期间调用 - 不是每个会话。                           |

### 拥有压缩

`ownsCompaction` 控制 Pi 的内置尝试自动压缩是否在运行时保持启用状态：

<AccordionGroup>
  <Accordion title="ownsCompaction: true">
    发动机具有压实行为。 OpenClaw 禁用 Pi 的内置自动压缩功能，引擎的 `compact()` 实现负责 `/compact`、溢出恢复压缩以及它想要在 `afterTurn()` 中执行的任何主动压缩。 OpenClaw 仍可能运行提示前溢出防护措施；当它预测完整记录将溢出时，恢复路径会在提交另一个提示之前调用活动引擎的 `compact()` 。
  </Accordion>
  <Accordion title="ownsCompaction: false or unset">
    Pi 的内置自动压缩可能仍会在提示执行期间运行，但仍会调用活动引擎的 `compact()` 方法来进行 `/compact` 和溢出恢复。
  </Accordion>
</AccordionGroup>

<Warning>
`ownsCompaction: false` **不**意味着 OpenClaw 自动回退到旧引擎的压缩路径。
</Warning>

这意味着有两种有效的插件模式：

<Tabs>
  <Tab title="Owning mode">
    实现你自己的压缩算法并设置 `ownsCompaction: true`。
  </Tab>
  <Tab title="Delegating mode">
    设置 `ownsCompaction: false` 并让 `compact()` 从 `openclaw/plugin-sdk/core` 调用 `delegateCompactionToRuntime(...)` 以使用 OpenClaw 的内置压缩行为。
  </Tab>
</Tabs>

无操作 `compact()` 对于活动的非拥有引擎来说是不安全的，因为它会禁用该引擎插槽的正常 `/compact` 和溢出恢复压缩路径。

## 配置参考

```json5
{
  plugins: {
    slots: {
      // Select the active context engine. Default: "legacy".
      // Set to a plugin id to use a plugin engine.
      contextEngine: "legacy",
    },
  },
}
```

<Note>
该槽在运行时是独占的——对于给定的运行或压缩操作，只有一个注册的上下文引擎被解析。其他启用的 `kind: "context-engine"` 插件仍然可以加载并运行其注册代码； `plugins.slots.contextEngine` 仅在需要上下文引擎时选择 OpenClaw 解析的注册引擎 id。
</Note>

<Note>
**Plugin 卸载：** 当你卸载当前选择为 `plugins.slots.contextEngine` 的插件时，OpenClaw 会将插槽重置回默认值 (`legacy`)。相同的重置行为适用于 `plugins.slots.memory`。无需手动配置编辑。
</Note>

## 与压缩和内存的关系

<AccordionGroup>
  <Accordion title="Compaction">
    压缩是上下文引擎的职责之一。旧引擎委托给 OpenClaw 的内置摘要。 Plugin 引擎可以实现任何压缩策略（DAG 摘要、向量检索等）。
  </Accordion>
  <Accordion title="Memory plugins">
    内存插件 (`plugins.slots.memory`) 与上下文引擎分开。内存插件提供搜索/检索；上下文引擎控制模型所看到的内容。它们可以一起工作——上下文引擎可能在组装期间使用内存插件数据。需要活动内存提示路径的 Plugin 引擎应该更喜欢 `openclaw/plugin-sdk/core` 中的 `buildMemorySystemPromptAddition(...)`，它将活动内存提示部分转换为准备就绪的 `systemPromptAddition`。如果引擎需要较低级别的控制，它仍然可以通过 `buildActiveMemoryPromptSection(...)` 从 `openclaw/plugin-sdk/memory-host-core` 提取原始线。
  </Accordion>
  <Accordion title="Session pruning">
    无论哪个上下文引擎处于活动状态，修剪旧工具都会导致内存中的结果仍然运行。
  </Accordion>
</AccordionGroup>

## 提示

- 使用 `openclaw doctor` 验证你的引擎是否正确加载。
- 如果切换引擎，现有会话将继续其当前历史记录。新发动机将接管未来的运行。
- 记录发动机错误并在诊断中显示。如果插件引擎注册失败或无法解析所选引擎 ID，OpenClaw 不会自动回退；运行失败，直到你修复插件或将 `plugins.slots.contextEngine` 切换回 `"legacy"`。
- 对于开发，使用 `openclaw plugins install -l ./my-engine` 链接本地插件目录，无需复制。

## 相关

- [Compaction](/concepts/compaction) — 总结长对话
- [Context](/concepts/context) — 如何为智能体轮流构建上下文
- [Plugin Architecture](/plugins/architecture) — 注册上下文引擎插件
- [Plugin 清单](/plugins/manifest) — 插件清单字段
- [Plugins](/tools/plugin) — 插件概述
