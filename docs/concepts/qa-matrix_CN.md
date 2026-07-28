---
summary: "Maintainer reference for the Docker-backed Matrix live QA lane: CLI, profiles, env vars, scenarios, and output artifacts."
read_when:
  - Running pnpm openclaw qa matrix locally
  - Adding or selecting Matrix QA scenarios
  - Triaging Matrix QA failures, timeouts, or stuck cleanup
title: "Matrix QA"
---

Matrix QA 通道针对 Docker 中的一次性 Tuwunel 主服务器运行捆绑的 `@openclaw/matrix` 插件，并使用临时驱动程序 SUT 和观察员帐户以及种子房间。这是 Matrix 的实时传输真实报道。

这是仅供维护人员使用的工具。打包的 OpenClaw 版本故意省略 `qa-lab`，因此 `openclaw qa` 只能从源签出中获得。源签出直接加载捆绑的运行器 - 不需要插件安装步骤。

有关更广泛的 QA 框架上下文，请参阅 [QA 概述](/concepts/qa-e2e-automation)。

## 快速开始

```bash
pnpm openclaw qa matrix --profile fast --fail-fast
```

普通 `pnpm openclaw qa matrix` 运行 `--profile all` 并且不会在第一次失败时停止。使用 `--profile fast --fail-fast` 作为释放门；并行运行完整清单时，使用 `--profile transport|media|e2ee-smoke|e2ee-deep|e2ee-cli` 对目录进行分片。

## 车道的作用

1. 在 Docker 中配置一次性 Tuwunel 主服务器（默认映像 `ghcr.io/matrix-construct/tuwunel:v1.5.1`，服务器名称 `matrix-qa.test`，端口 `28008`）。
2. 注册三个临时用户 — `driver`（发送入站流量）、`sut`（被测帐户 OpenClaw Matrix）、`observer`（第三方流量捕获）。
3. 所选场景所需的种子室（主、线程、媒体、重启、辅助、白名单、E2EE、验证 DM 等）。
4. 使用作用域为 SUT 帐户的真实 Matrix 插件启动子 OpenClaw 网关； `qa-channel` 未加载到子级中。
5. 按顺序运行场景，通过驱动程序/观察者 Matrix 客户端观察事件。
6. 拆除主服务器，写入报告和摘要工件，然后退出。

## CLI

```text
pnpm openclaw qa matrix [options]
```

### 常用标志

| 旗帜                  | 默认                                          | 描述                                                                                |
| --------------------- | --------------------------------------------- | ----------------------------------------------------------------------------------- |
| `--profile <profile>` | `all`                                         | 情景简介。请参阅[配置文件](#profiles)。                                             |
| `--fail-fast`         | 关闭                                          | 在第一次失败的检查或场景后停止。                                                    |
| `--scenario <id>`     | —                                             | 仅运行此场景。可重复。请参阅[场景](#scenarios)。                                    |
| `--output-dir <path>` | `<repo>/.artifacts/qa-e2e/matrix-<timestamp>` | 报告、摘要、观察到的事件和输出日志都写入其中。相对路径针对 `--repo-root` 进行解析。 |
| `--repo-root <path>`  | `process.cwd()`                               | 从中立工作目录调用时的存储库根目录。                                                |
| `--sut-account <id>`  | `sut`                                         | QA 网关配置中的 Matrix 帐户 ID。                                                    |

### 提供商标志

该通道使用真正的 Matrix 传输，但模型提供商是可配置的：

| 旗帜                     | 默认            | 描述                                                                                                     |
| ------------------------ | --------------- | -------------------------------------------------------------------------------------------------------- |
| `--provider-mode <mode>` | `live-frontier` | `mock-openai` 用于确定性模拟调度，或 `live-frontier` 用于实时前沿提供商。旧别名 `live-openai` 仍然有效。 |
| `--model <ref>`          | 提供商默认      | 主要 `provider/model` 参考号                                                                             |
| `--alt-model <ref>`      | 提供商默认      | 场景在运行中切换的备用 `provider/model` 参考。                                                           |
| `--fast`                 | 关闭            | 在支持的情况下启用提供商快速模式。                                                                       |

Matrix QA 不接受 `--credential-source` 或 `--credential-role`。该车道在当地提供一次性用户；没有可供租赁的共享凭证池。

## 个人资料

所选的配置文件决定运行哪些场景。

| 简介          | 用它来                                                                                                                                 |
| ------------- | -------------------------------------------------------------------------------------------------------------------------------------- |
| `all`（默认） | 完整目录。缓慢但详尽。                                                                                                                 |
| `fast`        | 执行实时传输合约的发布门子集：金丝雀、提及门控、允许列表块、回复形状、重新启动恢复、线程跟进、线程隔离、反应观察和执行批准元数据传递。 |
| `transport`   | 传输级线程、DM、房间、自动加入、提及/白名单、批准和反应场景。                                                                          |
| `media`       | 图片、音频、视频、PDF、EPUB 附件覆盖范围。                                                                                             |
| `e2ee-smoke`  | 最小 E2EE 覆盖范围 — 基本加密回复、线程跟进、引导成功。                                                                                |
| `e2ee-deep`   | 详尽的 E2EE 状态丢失、备份、密钥和恢复场景。                                                                                           |
| `e2ee-cli`    | `openclaw matrix encryption setup` 和 `verify *` CLI 通过 QA 工具驱动的场景。                                                          |

确切的映射位于 `extensions/qa-matrix/src/runners/contract/scenario-catalog.ts` 中。

## 场景

完整的场景 ID 列表是 `extensions/qa-matrix/src/runners/contract/scenario-catalog.ts:15` 中的 `MatrixQaScenarioId` 联合。类别包括：

- 线程 — `matrix-thread-*`、`matrix-subagent-thread-spawn`
- 顶层/DM/房间 — `matrix-top-level-reply-shape`、`matrix-room-*`、`matrix-dm-*`
- 流媒体和工具进度 — `matrix-room-partial-streaming-preview`、`matrix-room-quiet-streaming-preview`、`matrix-room-tool-progress-*`、`matrix-room-block-streaming`
- 媒体 — `matrix-media-type-coverage`、`matrix-room-image-understanding-attachment`、`matrix-attachment-only-ignored`、`matrix-unsupported-media-safe`
- 路由 — `matrix-room-autojoin-invite`、`matrix-secondary-room-*`
- 反应 — `matrix-reaction-*`
- 批准 — `matrix-approval-*` （执行/插件元数据、分块后备、拒绝反应、线程和 `target: "both"` 路由）
- 重新启动并重播 — `matrix-restart-*`、`matrix-stale-sync-replay-dedupe`、`matrix-room-membership-loss`、`matrix-homeserver-restart-resume`、`matrix-initial-catchup-then-incremental`
- 提及门控、机器人到机器人和许可名单 — `matrix-mention-*`、`matrix-allowbots-*`、`matrix-allowlist-*`、`matrix-multi-actor-ordering`、`matrix-inbound-edit-*`、`matrix-mxid-prefixed-command-block`、 `matrix-observer-allowlist-override`
- E2EE — `matrix-e2ee-*` （基本回复、线程跟进、引导、恢复密钥生命周期、状态丢失变体、服务器备份行为、设备卫生、SAS / QR / DM 验证、重新启动、工件编辑）
- E2EE CLI — `matrix-e2ee-cli-*` （加密设置、幂等设置、引导失败、恢复密钥生命周期、多帐户、网关回复往返、自验证）

通过 `--scenario <id>` （可重复）来运行精心挑选的集合；与 `--profile all` 结合使用以忽略配置文件选通。

## 环境变量

| 变量                                    | 默认                                                 | 效果                                                                                                                               |
| --------------------------------------- | ---------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------- |
| `OPENCLAW_QA_MATRIX_TIMEOUT_MS`         | `OPENCLAW_QA_MATRIX_TIMEOUT_MS` `1800000`（30 分钟） | 整个运行的硬上限。                                                                                                                 |
| `OPENCLAW_QA_MATRIX_CANARY_TIMEOUT_MS`  | `45000`                                              | 即将收到最初的金丝雀回复。发布 CI 在共享运行器上提出了这个问题，因此在场景覆盖开始之前缓慢的第一个网关转弯不会失败。               |
| `OPENCLAW_QA_MATRIX_NO_REPLY_WINDOW_MS` | `8000`                                               | 消极无回复断言的安静窗口。限制为 `≤` 运行超时。                                                                                    |
| `OPENCLAW_QA_MATRIX_CLEANUP_TIMEOUT_MS` | `90000`                                              | 前往 Docker 拆解。故障表面包括恢复 `docker compose ... down --remove-orphans` 命令。                                               |
| `OPENCLAW_QA_MATRIX_TUWUNEL_IMAGE`      | `ghcr.io/matrix-construct/tuwunel:v1.5.1`            | 根据不同的 Tuwunel 版本进行验证时覆盖主服务器映像。                                                                                |
| `OPENCLAW_QA_MATRIX_PROGRESS`           | 上                                                   | `0` 使 stderr 上的 `[matrix-qa] ...` 进度线保持沉默。 `1` 强迫他们继续。                                                           |
| `OPENCLAW_QA_MATRIX_CAPTURE_CONTENT`    | 已编辑                                               | `1` 将消息正文和 `formatted_body` 保留在 `matrix-qa-observed-events.json` 中。默认编辑以保证 CI 工件的安全。                       |
| `OPENCLAW_QA_MATRIX_DISABLE_FORCE_EXIT` | 关闭                                                 | `1` 在工件写入后跳过确定性 `process.exit`。默认强制退出，因为 Matrix-js-sdk 的本机加密句柄可以使事件循环在工件完成后保持活动状态。 |
| `OPENCLAW_RUN_NODE_OUTPUT_LOG`          | 取消设置                                             | 当由外部启动器 (e.g.`scripts/run-node.mjs`) 设置时，Matrix QA 会重用该日志路径，而不是启动自己的 tee。                             |

## 输出工件

写入`--output-dir`：

- `matrix-qa-report.md` — Markdown 协议报告（通过、失败、跳过的内容以及原因）。
- `matrix-qa-summary.json` — 适用于 CI 解析和仪表板的结构化摘要。
- `matrix-qa-observed-events.json` — 从驱动程序和观察者客户端观察到的 Matrix 事件。正文经过编辑，除非 `OPENCLAW_QA_MATRIX_CAPTURE_CONTENT=1`；批准元数据通过选定的安全字段和截断的命令预览进行汇总。
- `matrix-qa-output.log` — 运行中的组合 stdout/stderr。如果设置了 `OPENCLAW_RUN_NODE_OUTPUT_LOG`，则将重用外部启动器的日志。

默认输出目录是 `<repo>/.artifacts/qa-e2e/matrix-<timestamp>` 因此连续运行不会相互覆盖。

## 分诊提示

- **运行接近尾声时挂起：** `matrix-js-sdk` 本机加密句柄可能比安全带寿命更长。默认值在工件写入后强制执行干净的 `process.exit` ；如果你未设置 `OPENCLAW_QA_MATRIX_DISABLE_FORCE_EXIT=1`，预计该过程将持续存在。
- **清理错误：**查找打印的恢复命令（`docker compose ... down --remove-orphans` 调用）并手动运行它以释放主服务器端口。
- **CI 中的片状否定断言窗口：** 当 CI 很快时，会降低 `OPENCLAW_QA_MATRIX_NO_REPLY_WINDOW_MS` （默认 8 秒）；对缓慢的共享跑步者提高它。
- **需要编辑错误报告正文：** 使用 `OPENCLAW_QA_MATRIX_CAPTURE_CONTENT=1` 重新运行并附加 `matrix-qa-observed-events.json`。将产生的工件视为敏感工件。
- **不同的 Tuwunel 版本：** 将 `OPENCLAW_QA_MATRIX_TUWUNEL_IMAGE` 指向正在测试的版本。该通道仅检查固定的默认图像。

## 直播运输合同

Matrix 是三个实时传输通道（Matrix、Telegram、Discord）之一，它们共享 [QA 概述 → 实时传输覆盖范围](/concepts/qa-e2e-automation#live-transport-coverage) 中定义的单个合同清单。 `qa-channel` 仍然是广泛的合成套件，并且故意不属于该矩阵。

## 相关

- [QA 概述](/concepts/qa-e2e-automation) — 整体 QA 堆栈和实时传输合同
- [QA Channel](/channels/qa-channel) — 用于回购支持场景的合成通道适配器
- [测试](/help/testing) — 运行测试并添加 QA 覆盖范围
- [Matrix](/channels/matrix) — 正在测试的通道插件
