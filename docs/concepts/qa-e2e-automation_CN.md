---
summary: "QA stack overview: qa-lab, qa-channel, repo-backed scenarios, live transport lanes, transport adapters, and reporting."
read_when:
  - Understanding how the QA stack fits together
  - Extending qa-lab, qa-channel, or a transport adapter
  - Adding repo-backed QA scenarios
  - Building higher-realism QA automation around the Gateway dashboard
title: "QA overview"
---

私人 QA 堆栈旨在以更现实的方式运用 OpenClaw ，
通道形的方式比单个单元测试可以。

当前作品：

- `extensions/qa-channel`：具有 DM、通道、线程的合成消息通道，
  反应、编辑和删除曲面。
- `extensions/qa-lab`：调试器 UI 和用于观察记录的 QA 总线，
  注入入站消息，并导出 Markdown 报告。
- `extensions/qa-matrix`，未来的运行器插件：实时传输适配器
  在子 QA 网关内驱动真实通道。
- `qa/`：用于启动任务和基线 QA 的回购支持种子资产
  场景。

## 命令界面

每个 QA 流程都在 `pnpm openclaw qa <subcommand>` 下运行。许多有 `pnpm qa:*`
脚本别名；两种形式均受支持。

| 命令                                                | 目的                                                                                                                                                |
| --------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------- |
| `qa run`                                            | 捆绑式QA自检；写入 Markdown 报告。                                                                                                                  |
| `qa suite`                                          | 针对 QA 网关通道运行存储库支持的场景。别名：一次性 Linux VM 的 `pnpm openclaw qa suite --runner multipass`。                                        |
| `qa coverage`                                       | 打印降价场景覆盖清单（`--json` 用于机器输出）。                                                                                                     |
| `qa parity-report`                                  | 比较两个 `qa-suite-summary.json` 文件并写入智能体奇偶校验门报告。                                                                                   |
| `qa character-eval`                                 | 使用判断报告在多个实时模型上运行角色 QA 场景。请参阅[报告](#reporting)。                                                                            |
| `qa manual`                                         | 针对选定的提供商/模型通道运行一次性提示。                                                                                                           |
| `qa ui`                                             | 启动 QA 调试器 UI 和本地 QA 总线（别名：`pnpm qa:lab:ui`）。                                                                                        |
| `qa docker-build-image`                             | 构建预烘焙的 QA Docker 映像。                                                                                                                       |
| `qa docker-scaffold`                                | 为 QA 仪表板 + 网关通道编写一个 docker-compose 脚手架。                                                                                             |
| `qa up`                                             | 构建 QA 站点，启动 Docker 支持的堆栈，打印 URL （别名：`pnpm qa:lab:up`；`:fast` 变体添加 `--use-prebuilt-image --bind-ui-dist --skip-ui-build`）。 |
| `qa aimock`                                         | 仅启动 AIMock 提供商服务器。                                                                                                                        |
| `qa mock-openai`                                    | 仅启动场景感知 `mock-openai` 提供商服务器。                                                                                                         |
| `qa credentials doctor` / `add` / `list` / `remove` | 管理共享凸凭证池。                                                                                                                                  |
| `qa matrix`                                         | 针对一次性 Tuwunel 家庭服务器的实时传输通道。请参阅 [Matrix QA](/concepts/qa-matrix)。                                                              |
| `qa telegram`                                       | 针对真正的私人 Telegram 团体的实时运输通道。                                                                                                        |
| `qa discord`                                        | 针对真正的私人 Discord 公会频道的实时传输通道。                                                                                                     |

## 操作流程

当前的 QA 操作员流程是一个两面板 QA 站点：

- 左：Gateway 仪表板 (Control UI) 与智能体。
- 右：QA 实验室，显示 Slack-ish 成绩单和情景计划。

运行它：

```bash
pnpm qa:lab:up
```

这会构建 QA 站点，启动 Docker 支持的网关通道，并公开
QA 实验室页面，操作员或自动化循环可以在其中为智能体提供 QA
任务，观察真实的渠道行为，并记录哪些有效、哪些失败或
一直被封锁。

为了更快地进行 QA 实验室 UI 迭代，而无需每次都重建 Docker 图像，
使用绑定安装的 QA Lab 包启动堆栈：

```bash
pnpm openclaw qa docker-build-image
pnpm qa:lab:build
pnpm qa:lab:up:fast
pnpm qa:lab:watch
```

`qa:lab:up:fast` 将 Docker 服务保留在预构建的映像上并绑定安装
`extensions/qa-lab/web/dist` 进入 `qa-lab` 容器。 `qa:lab:watch`
在更改时重建该捆绑包，并且当 QA 实验室检查时浏览器会自动重新加载
资产哈希变化。

对于本地 OpenTelemetry 跟踪烟雾，请运行：

```bash
pnpm qa:otel:smoke
```

该脚本启动本地 OTLP/HTTP 跟踪接收器，运行
启用 `diagnostics-otel` 插件的 `otel-trace-smoke` QA 场景，然后
解码导出的 protobuf span 并断言发布关键形状：
`openclaw.run`、`openclaw.harness.run`、`openclaw.model.call`、
`openclaw.context.assembled` 和 `openclaw.message.delivery` 必须存在；
成功转弯时模型调用不得导出 `StreamAbandoned` ；原始诊断 ID 和
`openclaw.content.*` 属性必须远离跟踪。它写道
`otel-smoke-summary.json` 位于 QA 套件工件旁边。

可观察性 QA 仅保留源代码检查。 npm tarball 故意省略
QA 实验室，因此包 Docker 发布通道不会运行 `qa` 命令。使用
更改诊断时从内置源检出 `pnpm qa:otel:smoke`
仪器仪表。

对于真正的传输 Matrix 烟雾通道，请运行：

```bash
pnpm openclaw qa matrix --profile fast --fail-fast
```

此通道的完整 CLI 参考、配置文件/场景目录、环境变量和工件布局位于 [Matrix QA](/concepts/qa-matrix) 中。乍一看：它在 Docker 中提供一次性 Tuwunel 主服务器，注册临时驱动程序/SUT/观察者用户，在作用于该传输的子 QA 网关内运行真正的 Matrix 插件（无 `qa-channel`），然后写入Markdown 报告、JSON 摘要、观察到的事件工件以及 `.artifacts/qa-e2e/matrix-<timestamp>/` 下的组合输出日志。

对于真实运输 Telegram 和 Discord 烟雾通道：

```bash
pnpm openclaw qa telegram
pnpm openclaw qa discord
```

两者都针对具有两个机器人（驱动程序 + SUT）的预先存在的真实通道。所需的环境变量、场景列表、输出工件和凸凭证池记录在下面的 [Telegram 和 Discord QA 参考](#telegram-and-discord-qa-reference) 中。

在使用池化实时凭据之前，请运行：

```bash
pnpm openclaw qa credentials doctor
```

当维护者秘密存在时，医生检查 Convex 智能体环境，验证端点设置，并验证管理/列表的可达性。它仅报告机密的设置/丢失状态。

## 实时交通报道

实时传输通道共享一份合同，而不是每个通道都发明自己的场景列表形状。 `qa-channel` 是广泛的综合产品行为套件，不是实时传输覆盖矩阵的一部分。

|车道 |金丝雀|提及门控 |机器人对机器人 |允许列表块 |顶级回复 |重启简历 |话题跟进 |线程隔离|反应观察|帮助命令 |原生命令注册 |
| -------- | ------ | -------------- | ---------- | ---------------- | ---------------- | -------------- | ---------------- | ---------------- | -------------------- | ------------ | ------------------------ | |
| Matrix | x| x| x| x| x| x| x| x| x| | |
| Telegram | x| x| x| | | | | | | x| |
| Discord | x| x| x| | | | | | | | x|

这使得 `qa-channel` 保持为广泛的产品行为套件，而 Matrix，
Telegram，并且未来的实时传输共享一份显式传输合同
清单。

对于不将 Docker 引入 QA 路径的一次性 Linux VM 通道，请运行：

```bash
pnpm openclaw qa suite --runner multipass --scenario channel-chat-baseline
```

这将启动一个新的 Multipass 来宾，安装依赖项，构建 OpenClaw
在来宾内部，运行 `qa suite`，然后复制正常的 QA 报告并
摘要返回到主机上的 `.artifacts/qa-e2e/...` 中。
它在主机上重用与 `qa suite` 相同的场景选择行为。
主机和多通道套件运行并行执行多个选定的场景
默认情况下与隔离的网关工作人员一起。 `qa-channel` 默认为并发
4、受所选场景计数限制。使用 `--concurrency <count>` 进行调整
工作线程计数，或 `--concurrency 1` 用于串行执行。
当任何场景失败时，该命令将以非零值退出。使用 `--allow-failures` 时
你想要没有失败退出代码的工件。
Live 向前运行支持的 QA 验证输入，这些输入对于
guest：基于 env 的提供商密钥、QA 实时提供商配置路径，以及
`CODEX_HOME` 当存在时。将 `--output-dir` 保留在存储库根目录下，以便来宾
可以通过挂载的工作区写回。

## Telegram 和 Discord 质量检查参考

Matrix 有一个[专用页面](/concepts/qa-matrix)，因为它的场景计数和 Docker 支持的家庭服务器配置。 Telegram 和 Discord 较小——每个场景都有一些场景，没有配置文件系统，针对预先存在的真实通道——所以它们的参考就在这里。

### 共享 CLI 标志

两个通道都通过 `extensions/qa-lab/src/live-transports/shared/live-transport-cli.ts` 注册并接受相同的标志：

| 旗帜                                  | 默认                                                      | 描述                                                                              |
| ------------------------------------- | --------------------------------------------------------- | --------------------------------------------------------------------------------- |
| `--scenario <id>`                     | —                                                         | 仅运行此场景。可重复。                                                            |
| `--output-dir <path>`                 | `<repo>/.artifacts/qa-e2e/{telegram,discord}-<timestamp>` | 报告/摘要/观察到的消息和输出日志的写入位置。相对路径针对 `--repo-root` 进行解析。 |
| `--repo-root <path>`                  | `process.cwd()`                                           | 从中性 cwd 调用时的存储库根。                                                     |
| `--sut-account <id>`                  | `sut`                                                     | QA 网关配置中的临时帐户 ID。                                                      |
| `--provider-mode <mode>`              | `live-frontier`                                           | `mock-openai` 或 `live-frontier` （旧版 `live-openai` 仍然有效）。                |
| `--model <ref>` / `--alt-model <ref>` | 提供商默认                                                | 主要/备用模型参考。                                                               |
| `--fast`                              | 关闭                                                      | 在支持的情况下提供快速模式。                                                      |
| `--credential-source <env\|convex>`   | `env`                                                     | 请参阅[凸凭证池](#convex-credential-pool)。                                       |
| `--credential-role <maintainer\|ci>`  | CI 中为 `ci`，否则为 `maintainer`                         | `--credential-source convex` 时使用的角色。                                       |

在任何失败的情况下，两者都以非零值退出。 `--allow-failures` 写入工件而不设置失败的退出代码。

### Telegram 质量检查

```bash
pnpm openclaw qa telegram
```

针对一个真正的私有 Telegram 组，该组具有两个不同的机器人（驱动程序 + SUT）。 SUT 机器人必须具有 Telegram 用户名；当两个机器人都在 `@BotFather` 中启用 **机器人对机器人通信模式** 时，机器人对机器人观察效果最佳。

`--credential-source env` 时所需的环境：

- `OPENCLAW_QA_TELEGRAM_GROUP_ID` — 数字聊天 ID（字符串）。
- `OPENCLAW_QA_TELEGRAM_DRIVER_BOT_TOKEN`
- `OPENCLAW_QA_TELEGRAM_SUT_BOT_TOKEN`

可选：

- `OPENCLAW_QA_TELEGRAM_CAPTURE_CONTENT=1` 将消息正文保留在观察到的消息工件中（默认编辑）。

场景 (`extensions/qa-lab/src/live-transports/telegram/telegram-live.runtime.ts:44`)：

- `telegram-canary`
- `telegram-mention-gating`
- `telegram-mentioned-message-reply`
- `telegram-help-command`
- `telegram-commands-command`
- `telegram-tools-compact-command`
- `telegram-whoami-command`
- `telegram-context-command`

输出工件：

- `telegram-qa-report.md`
- `telegram-qa-summary.json` — 包括从金丝雀开始的每个回复 RTT （驱动程序发送 → 观察到的 SUT 回复）。
- `telegram-qa-observed-messages.json` — 正文经过编辑，除非 `OPENCLAW_QA_TELEGRAM_CAPTURE_CONTENT=1`。

### Discord 质量检查

```bash
pnpm openclaw qa discord
```

目标是一个真正的私有 Discord 公会通道，其中包含两个机器人：一个由线束控制的驱动程序机器人和一个由子 OpenClaw 网关通过捆绑的 Discord 插件启动的 SUT 机器人。验证通道提及处理以及 SUT 机器人是否已使用 Discord 注册本机 `/help` 命令。

`--credential-source env` 时所需的环境：

- `OPENCLAW_QA_DISCORD_GUILD_ID`
- `OPENCLAW_QA_DISCORD_CHANNEL_ID`
- `OPENCLAW_QA_DISCORD_DRIVER_BOT_TOKEN`
- `OPENCLAW_QA_DISCORD_SUT_BOT_TOKEN`
- `OPENCLAW_QA_DISCORD_SUT_APPLICATION_ID` — 必须与 Discord 返回的 SUT 机器人用户 ID 匹配（否则通道会快速失败）。

可选：

- `OPENCLAW_QA_DISCORD_CAPTURE_CONTENT=1` 将消息正文保留在观察到的消息工件中。

场景 (`extensions/qa-lab/src/live-transports/discord/discord-live.runtime.ts:36`)：

- `discord-canary`
- `discord-mention-gating`
- `discord-native-help-command-registration`

输出工件：

- `discord-qa-report.md`
- `discord-qa-summary.json`
- `discord-qa-observed-messages.json` — 正文经过编辑，除非 `OPENCLAW_QA_DISCORD_CAPTURE_CONTENT=1`。

### 凸凭证池

Telegram 和 Discord 通道都可以从共享凸池租用凭证，而不是读取上面的环境变量。传递`--credential-source convex`（或设置`OPENCLAW_QA_CREDENTIAL_SOURCE=convex`）； QA 实验室获取独占租约，在运行期间对其进行检测，并在关闭时释放它。池类型为 `"telegram"` 和 `"discord"`。

智能体在 `admin/add` 上验证的有效负载形状：

- Telegram (`kind: "telegram"`): `{ groupId: string, driverToken: string, sutToken: string }` — `groupId` 必须是数字聊天 ID 字符串。
- Discord (`kind: "discord"`): `{ guildId: string, channelId: string, driverBotToken: string, sutBotToken: string, sutApplicationId: string }`。

操作环境变量和 Convex 智能体端点合约位于 [测试 → 通过 Convex 共享 Telegram 凭证](/help/testing#shared-telegram-credentials-via-convex-v1)（部分名称早于 Discord 支持；两种类型的智能体语义相同）。

## 回购支持种子

种子资产位于 `qa/`：

- `qa/scenarios/index.md`
- `qa/scenarios/<theme>/*.md`

这些是有意放在 git 中的，因此 QA 计划对人类和其他人来说都是可见的
智能体。

`qa-lab` 应该保持通用的降价运行程序。每个场景 Markdown 文件是
一次测试运行的真实来源，应定义：

- 场景元数据
- 可选类别、能力、通道和风险元数据
- 文档和代码参考
- 可选插件要求
- 可选网关配置补丁
- 可执行文件`qa-flow`

支持 `qa-flow` 的可重用运行时表面允许保持通用
和横切。例如markdown场景可以结合传输端
具有浏览器端帮助程序的帮助程序，通过驱动嵌入式 Control UI
Gateway `browser.request` 接缝，无需添加特殊情况的流道。

场景文件应按产品功能而不是源树分组
文件夹。文件移动时保持场景ID稳定；使用 `docsRefs` 和 `codeRefs`
用于实现可追溯性。

基线列表应足够广泛以涵盖：

- DM 和频道聊天
- 线程行为
- 消息动作生命周期
- cron 回调
- 记忆回忆
- 模型切换
- 子智能体切换
- 回购阅读和文档阅读
- 一项小型构建任务，例如龙虾入侵者

## 提供商模拟车道

`qa suite` 有两个本地提供商模拟通道：

- `mock-openai` 是场景感知的 OpenClaw 模拟。它仍然是默认的
  用于回购支持的 QA 和奇偶校验门的确定性模拟通道。
- `aimock` 启动一个 AIMock 支持的提供商服务器用于实验协议，
  赛程、记录/重播和混乱报道。它是添加剂，不
  替换 `mock-openai` 场景调度程序。

提供商通道实施位于 `extensions/qa-lab/src/providers/` 下。
每个提供商都拥有其默认值、本地服务器启动、网关模型配置、
认证配置文件暂存需求以及实时/模拟功能标志。共用套房和
网关代码应该通过提供商注册表进行路由，而不是分支
提供商名称。

## 传输适配器

`qa-lab` 拥有用于 Markdown QA 场景的通用传输接缝。 `qa-channel` 是该接缝上的第一个适配器，但设计目标更广泛：未来的真实或合成通道应插入同一套件运行器，而不是添加特定于传输的 QA 运行器。

在架构层面，划分是：

- `qa-lab` 拥有通用场景执行、工作并发、工件写入和报告。
- 传输适配器拥有网关配置、准备情况、入站和出站观察、传输操作和标准化传输状态。
- `qa/scenarios/` 下的 Markdown 场景文件定义测试运行； `qa-lab` 提供执行它们的可重用运行时表面。

### 添加频道

向 Markdown QA 系统添加通道需要满足两件事：

1. 通道的传输适配器。
2. 执行渠道合约的场景包。

当共享 `qa-lab` 主机可以拥有该流时，请勿添加新的顶级 QA 命令根。

`qa-lab` 拥有共享主机机制：

- `openclaw qa` 命令根
- 套件启动和拆卸
- 工人并发
- 神器书写
- 报告生成
- 场景执行
- 较旧的 `qa-channel` 场景的兼容性别名

Runner 插件拥有传输合约：

- `openclaw qa <runner>` 如何安装在共享 `qa` 根目录下
- 如何为该传输配置网关
- 如何检查准备情况
- 如何注入入站事件
- 如何观察出站消息
- 转录本和标准化传输状态如何公开
- 如何执行传输支持的操作
- 如何处理特定于传输的重置或清理

新渠道的最低采用门槛：

1. 将 `qa-lab` 保留为共享 `qa` 根的所有者。
2. 在共享 `qa-lab` 主机接缝上实现传输运行程序。
3. 将特定于传输的机制保留在运行器插件或通道线束内。
4. 将运行程序安装为 `openclaw qa <runner>`，而不是注册竞争根命令。运行器插件应在 `openclaw.plugin.json` 中声明 `qaRunners` 并从 `runtime-api.ts` 导出匹配的 `qaRunnerCliRegistrations` 数组。保持 `runtime-api.ts` 轻便；惰性 CLI 和运行程序执行应保留在单独的入口点后面。
5. 在主题 `qa/scenarios/` 目录下创作或改编 Markdown 场景。
6. 将通用场景助手用于新场景。
7. 保持现有兼容性别名正常工作，除非存储库正在进行有意迁移。

决策规则是严格的：

- 如果行为可以在 `qa-lab` 中表达一次，则将其放入 `qa-lab` 中。
- 如果行为取决于一个通道传输，请将其保留在运行器插件或插件线束中。
- 如果场景需要多个通道可以使用的新功能，请在 `suite.ts` 中添加通用帮助程序，而不是特定于通道的分支。
- 如果某个行为仅对一种传输有意义，请保持场景特定于传输并在场景契约中明确说明。

### 场景助手名称

新场景的首选通用助手：

- `waitForTransportReady`
- `waitForChannelReady`
- `injectInboundMessage`
- `injectOutboundMessage`
- `waitForTransportOutboundMessage`
- `waitForChannelOutboundMessage`
- `waitForNoTransportOutbound`
- `getTransportSnapshot`
- `readTransportMessage`
- `readTransportTranscript`
- `formatTransportTranscript`
- `resetTransport`

兼容性别名仍然可用于现有场景 — `waitForQaChannelReady`、`waitForOutboundMessage`、`waitForNoOutbound`、`formatConversationTranscript`、`resetBus` — 但新场景创作应使用通用名称。别名的存在是为了避免国旗日迁移，而不是作为未来的模型。

## 报告

`qa-lab` 从观察到的总线时间线导出 Markdown 协议报告。
报告应回答：

- 什么有效
- 什么失败了
- 哪些内容被阻止
- 哪些后续场景值得补充

对于可用场景的清单（在确定后续工作大小或连接新传输时很有用），请运行 `pnpm openclaw qa coverage` （添加 `--json` 以获取机器可读的输出）。

对于字符和风格检查，在多个实时模型中运行相同的场景
参考文献并写出一份判断的 Markdown 报告：

```bash
pnpm openclaw qa character-eval \
  --model openai/gpt-5.5,thinking=medium,fast \
  --model openai/gpt-5.2,thinking=xhigh \
  --model openai/gpt-5,thinking=xhigh \
  --model anthropic/claude-opus-4-6,thinking=high \
  --model anthropic/claude-sonnet-4-6,thinking=high \
  --model zai/glm-5.1,thinking=high \
  --model moonshot/kimi-k2.5,thinking=high \
  --model google/gemini-3.1-pro-preview,thinking=high \
  --judge-model openai/gpt-5.5,thinking=xhigh,fast \
  --judge-model anthropic/claude-opus-4-6,thinking=high \
  --blind-judge-models \
  --concurrency 16 \
  --judge-concurrency 16
```

该命令运行本地 QA 网关子进程，而不是 Docker。人物评价
场景应该通过`SOUL.md`设置角色，然后运行普通用户轮流
例如聊天、工作区帮助和小文件任务。候选模型应该
不知道它正在被评估。该命令保留每个完整的
成绩单，记录基本的跑步统计数据，然后向裁判询问快速模式下的模型
`xhigh` 支持推理，按自然性、氛围和幽默对运行进行排名。
比较提供商时使用`--blind-judge-models`：判断提示仍然出现
每个成绩单和运行状态，但候选裁判被替换为中性
诸如 `candidate-01` 之类的标签；该报告将排名映射回真实裁判之后
解析。
候选运行默认为 `high` 思维，`medium` 为 GPT-5.5 和 `xhigh`
对于支持它的旧 OpenAI eval 参考。覆盖内联的特定候选者
`--model provider/model,thinking=<level>`。 `--thinking <level>` 仍然设置
全局后备，旧的 `--model-thinking <provider/model=level>` 形式是
保留兼容性。
OpenAI 候选引用默认为快速模式，因此在以下位置使用优先处理
提供商支持它。添加 `,fast`、`,no-fast` 或 `,fast=false` inline
单个候选人或法官需要优先考虑。仅当你想要时才传递 `--fast`
为每个候选模型强制启用快速模式。候选人和法官的持续时间是
记录在报告中进行基准分析，但法官提示明确说
不以速度排名。
候选人和法官模型运行时都默认并发数为 16。 较低
当提供商限制或本地网关时，`--concurrency` 或 `--judge-concurrency`
压力使运行噪音太大。
当没有候选 `--model` 被传递时，字符 eval 默认为
`openai/gpt-5.5`、`openai/gpt-5.2`、`openai/gpt-5`、`anthropic/claude-opus-4-6`、
`anthropic/claude-sonnet-4-6`、`zai/glm-5.1`、
`moonshot/kimi-k2.5`，以及
`google/gemini-3.1-pro-preview` 当没有传递 `--model` 时。
当没有通过 `--judge-model` 时，评委默认为
`openai/gpt-5.5,thinking=xhigh,fast` 和
`anthropic/claude-opus-4-6,thinking=high`。

## 相关文档

- [Matrix 质量检查](/concepts/qa-matrix)
- [质量保证频道](/channels/qa-channel)
- [测试](/help/testing)
- [仪表板](/web/dashboard)
