# AGENTS.MD

电报风格。仅限根规则。在处理子树工作前阅读对应的 `AGENTS.md`。

## 开始

- 仓库：`https://github.com/openclaw/openclaw`
- 回复：仅使用仓库根路径引用：`extensions/telegram/src/index.ts:80`。不使用绝对路径，不使用 `~/`。
- 首先运行文档列表：如果能用则运行 `pnpm docs:list`；仅阅读相关文档。
- 修复/分类时仅给出高置信度的答案：在做决定前验证源码、测试、已发布/当前行为以及依赖合约。
- 依赖驱动的行为：首先阅读上游依赖的文档/源码/类型。不要臆测 API、默认值、错误、时机或运行时行为。
- 尽可能进行实时验证。在假设实时测试被阻塞前检查环境/`~/.profile` 中是否有密钥；注意对敏感输出进行脱敏处理。
- 缺失依赖：`pnpm install`，重试一次，然后报告第一个可操作的错误。
- CODEOWNERS：维护/重构/测试可以。较大的行为/产品/安全/所有权变更：需要所有者询问/审查。
- 用语：产品/文档/UI/变更日志使用 "plugin/plugins"；`extensions/` 是内部目录。
- 新的渠道/插件/应用/文档界面：更新 `.github/labeler.yml` + GitHub 标签。
- 新的 `AGENTS.md`：添加同级的 `CLAUDE.md` 符号链接。

## 地图

- 核心 TS：`src/`、`ui/`、`packages/`；插件：`extensions/`；SDK：`src/plugin-sdk/*`；渠道：`src/channels/*`；加载器：`src/plugins/*`；协议：`src/gateway/protocol/*`；文档/应用：`docs/`、`apps/`、`Swabble/`。
- 安装程序：同级目录 `../openclaw.ai`。
- 分层指南存在于：`extensions/`、`src/{plugin-sdk,channels,plugins,gateway,gateway/protocol,agents}/`、`test/helpers*/`、`docs/`、`ui/`、`scripts/`。

## 架构

- 核心保持与扩展无关。当清单/注册表/能力合约可用时，核心中不包含捆绑的 ID。
- 扩展仅通过 `openclaw/plugin-sdk/*`、清单元数据、注入的运行时辅助函数、文档化的导出桶（`api.ts`、`runtime-api.ts`）进入核心。
- 扩展生产代码：不引用核心 `src/**`、`src/plugin-sdk-internal/**`、其他扩展的 `src/**` 或相对路径的外部包。
- 核心/测试：不深入插件内部（`extensions/*/src/**`、`onboard.js`）。使用 `api.ts`、SDK 外观、通用合约。
- 扩展拥有的行为保持由扩展所有：修复、检测、安装引导、认证/提供商默认值、提供商工具/设置。
- 所有者边界：在所有者的模块中修复所有者特定的行为。共享/核心只获得通用接口；不包含所有者 ID、依赖字符串、默认值、迁移或恢复策略。如果一个缺陷提到某个扩展或其依赖，从该扩展开始排查，仅在多个所有者都需要时才添加通用的核心接口。
- 遗留配置修复：在 doctor/fix 路径中修复，而非启动/加载时的核心迁移。
- 测试扩展特定行为的核心测试：移到所有者扩展或通用合约测试中。
- 新接口：向后兼容、有文档、有版本号。第三方插件是存在的。
- 渠道：`src/channels/**` 是实现；插件作者获得 SDK 接口。
- 提供商：核心拥有通用循环；提供商插件拥有认证/目录/运行时钩子。
- Gateway 协议变更：以增量为先；不兼容的更改需要版本控制/文档/客户端的跟进。
- 配置合约：导出的类型、模式/帮助、元数据、基线、文档对齐。已弃用的公共键保持弃用状态；兼容性保留在原始迁移/doctor 中。
- 方向：清单优先的控制平面；有针对性的运行时加载器；无隐藏的合约绕过；广泛的可变注册表作为过渡方案。
- 提示缓存：在模型/工具载荷之前，对映射/集合/注册表/插件列表/文件/网络结果进行确定性排序。尽可能保留旧的转录文本字节。

## 命令

- 运行时：Node 22+。保持 Node + Bun 路径正常工作。
- 安装：`pnpm install`（如果触碰到，保持 Bun 锁定/补丁对齐）。
- CLI：`pnpm openclaw ...` 或 `pnpm dev`；构建：`pnpm build`。
- 智能门控：`pnpm check:changed`；解释 `pnpm changed:lanes --json`；暂存预览 `pnpm check:changed --staged`。
- 稀疏工作树：`pnpm check:changed` 是稀疏安全的，可能会跳过稀疏缺失的类型检查项目；不要仅为了满足变更门控的 tsgo 而扩展稀疏检出。直接 `pnpm tsgo*` 仍然是严格的；当需要直接的类型检查证明时，使用更完整的工作树。
- 生产环境全面检查：`pnpm check`；测试：`pnpm test`、`pnpm test:changed`、`pnpm test:serial`、`pnpm test:coverage`。
- 扩展测试：`pnpm test:extensions`、`pnpm test extensions`、`pnpm test extensions/<id>`。
- 针对性测试：`pnpm test <路径或过滤器> [vitest 参数...]`；绝不直接使用 `vitest`。
- 仅使用 Vitest 标志；不使用 Jest 标志如 `--runInBand`。串行运行使用 `pnpm test:serial` 或 `OPENCLAW_VITEST_MAX_WORKERS=1 pnpm test ...`。
- 类型检查：仅使用 `tsgo` 通道（`pnpm tsgo*`、`pnpm check:test-types`）；不要添加 `tsc --noEmit`、`typecheck`、`check:types`。
- 格式化：使用 `oxfmt`，而非 Prettier。优先使用 `pnpm format:check` / `pnpm format`；针对特定文件使用 `pnpm exec oxfmt --check --threads=1 <文件...>` 或 `pnpm exec oxfmt --write --threads=1 <文件...>`。
- 代码检查：使用仓库封装命令（`pnpm lint:*`、`scripts/run-oxlint.mjs`）；除非仓库脚本使用，否则不调用通用 JS 格式化工具/检查工具。
- 重型检查：`OPENCLAW_LOCAL_CHECK=1`，模式 `OPENCLAW_LOCAL_CHECK_MODE=throttled|full`；CI/共享环境使用 `OPENCLAW_LOCAL_CHECK=0`。
- Blacksmith/Testbox：在具有 Blacksmith 访问权限的维护者机器上，大规模/共享验证默认使用 Testbox。这包括 `pnpm check`、`pnpm check:changed`、`pnpm test`、`pnpm test:changed`、Docker/E2E/实时/打包/构建门控，以及任何可能在多个 Vitest 项目中扩散的命令。不要在本机启动那些大规模门控，除非用户明确要求本地验证或设置了 `OPENCLAW_LOCAL_CHECK_MODE=throttled|full`。
- 本地验证：仅限针对性的编辑循环，例如 `pnpm test <特定文件>`、针对性的格式化检查和小型代码检查/类型探测。如果本地命令扩展到针对性验证之外，停止它并将大规模门控移到 Testbox。
- Testbox 使用：从仓库根目录运行，使用 `blacksmith testbox warmup ci-check-testbox.yml --ref main --idle-timeout 90` 提前预热，为所有 `run`/`download` 命令重用返回的 `tbx_...` ID，并在交接前停止你创建的箱子。超时时间：`90` 分钟默认，`240` 多小时，`720` 全天，`1440` 过夜；超过 `1440` 需要明确批准和清理。
- Testbox 完整套件配置：`blacksmith testbox run --id <ID> "env NODE_OPTIONS=--max-old-space-size=4096 OPENCLAW_TEST_PROJECTS_PARALLEL=6 OPENCLAW_VITEST_MAX_WORKERS=1 pnpm test"`。对于可安装包验证，优先使用 GitHub 的 `Package Acceptance` 工作流而非临时的 Testbox 命令。

## GitHub / CI

- 分类：先列出，少加载。使用有界的 `gh --json --jq`；避免重复的全量评论扫描。
- 自动 PR/问题发现：跳过维护者拥有的项目，除非直接相关。未经 Peter 要求，不要评论、关闭、打标签、改标题、变基、修复或合并它们。
- PR 扫描/分类：未经请求的 PR 评论/审查。仅在聊天中报告，除非被明确要求，或者关闭/重复操作需要一条理由评论。
- 搜索/去重：优先使用 `gh search issues 'repo:openclaw/openclaw is:open <条件>' --json number,title,state,updatedAt --limit 20`。
- GitHub 搜索布尔文本很挑剔。如果 `OR` 查询返回空结果，在得出无匹配结论之前，先分开精确词条分别搜索标题/正文/评论。
- PR 候选列表：`gh pr list ...`；然后 `gh pr view <n> --json number,title,body,closingIssuesReferences,files,statusCheckRollup,reviewDecision`。
- 合并 PR 后：搜索重复的已打开问题/PR。在关闭前评论原因 + 规范链接。
- GitHub 评论中包含 Markdown 反引号、`$` 或 shell 片段：避免在行内使用双引号 `--body`；使用单引号或 `--body-file`。
- PR 执行产物/截图：将它们附加到 PR、评论或外部产物存储中。不要将 `.github/pr-assets` 或其他仅 PR 相关的资产添加到仓库中。
- PR 审查答案必须明确涵盖：我们试图修复什么缺陷/行为；PR/问题 URL 以及受影响的端点/界面；这是否是最佳修复方案，附带来自代码、测试、CI 和已发布/当前行为的高确定性证据。
- 在处理问题或 PR 时，始终以完整的 GitHub URL 结束面向用户的最终回答。
- CI 轮询：精确的 SHA，仅必要的字段。示例：`gh api repos/<所有者>/<仓库>/actions/runs/<ID> --jq '{status,conclusion,head_sha,updated_at,name,path}'`。
- 合并后等待：最小化。仅精确的已合并 SHA。如果在 `main` 上被取代，同分支的 `cancel-in-progress` 取消是预期的；一旦存在本地的受影响界面验证即可停止。除非被要求，否则永远不要等待较新的无关 `main`。
- 等待矩阵：
  - 永不等待：`Auto response`、`Labeler`、`Docs Sync Publish Repo`、`Docs Agent`、`Test Performance Agent`、`Stale`。
  - 条件性等待：`CI` 仅精确 SHA；`Docs` 仅限文档任务/无本地文档验证；`Workflow Sanity` 仅限工作流/组合/CI 策略编辑；`Plugin NPM Release` 仅限插件包/发布元数据。
  - 仅发布/手动：`Docker Release`、`OpenClaw NPM Release`、`macOS Release`、`OpenClaw Release Checks`、`Cross-OS Release Checks`、`NPM Telegram Beta E2E`。
  - 仅显式/界面：`QA-Lab - All Lanes`、`Scheduled Live And E2E`、`Install Smoke`、`CodeQL`、`Sandbox Common Smoke`、`Parity gate`、`Blacksmith Testbox`、`Control UI Locale Refresh`。
- `/landpr`：不要在 `auto-response` 或 `check-docs` 上空闲。除非 `check-docs` 已经失败并带有可操作的相关错误，否则将文档视为本地验证。
- 轮询间隔 30-60 秒。仅在失败/完成或有具体需要时才获取作业/日志/产物。

## 门控

- 预提交钩子：仅暂存文件的格式化。验证是显式的。
- 变更通道：
  - 核心生产代码：核心生产代码类型检查 + 核心测试
  - 核心测试：核心测试类型检查/测试
  - 扩展生产代码：扩展生产代码类型检查 + 扩展测试
  - 扩展测试：扩展测试类型检查/测试
  - 公开 SDK/插件合约：扩展生产代码/测试也包含
  - 未知根目录/配置：所有通道
- 在交接/推送代码/测试/运行时/配置更改前：在维护者机器上默认在 Testbox 中运行 `pnpm check:changed`。仅测试更改：默认在 Testbox 中运行 `pnpm test:changed`。完整生产环境检查：在 Testbox 中运行 `pnpm check`。仅在狭窄的针对性验证或明确要求时使用本地运行。
- 如果 `pnpm test:changed` 或 `pnpm check:changed` 选择了广泛/共享的通道，应放入 Testbox；在它扩散后不要让它在本地继续运行。
- 仅文档/变更日志和仅 CI/工作流元数据的更改默认不属于变更门控工作。使用 `git diff --check` 加上相关的格式化工具/文档/工作流健全性检查；仅在脚本、测试配置、生成的文档/API、包元数据或运行时/构建行为发生变化时才升级到 `pnpm check:changed`。
- 变基健全性：在 `pnpm check:changed` 通过后，如果变基没有冲突且分支差异在实质上没有变化，将分支干净地变基到当前的 `origin/main` 不需要重新运行完整的变更门控。进行快速的 `git status`、`git diff --check` 和 diff/stat 健全性检查；仅当冲突解决、上游重叠、生成的漂移、依赖/配置更改或触及文件内容变化导致先前结果过时时，才重新运行针对性或全面检查。
- 合并到 `main`：在将要合并前验证受影响的界面。默认可行标准：`pnpm check` + `pnpm test`。
- 硬构建门控：如果构建输出、打包、懒加载/模块边界或发布的界面可能会改变，在推送前运行 `pnpm build`。
- 不要合并相关的失败的格式化/代码检查/类型/构建/测试。如果在最新的 `origin/main` 上不相关，用有针对性的证据说明。
- 生成的/API 漂移：`pnpm check:architecture`、`pnpm config:docs:gen/check`、`pnpm plugin-sdk:api:gen/check`。追踪 `docs/.generated/*.sha256`；完整 JSON 被忽略。

## 代码

- TS ESM，严格模式。避免 `any`；优先使用真实类型、`unknown`、窄适配器。
- 不使用 `@ts-nocheck`。仅在有意图且有解释的情况下使用代码检查抑制。
- 外部边界：优先使用 `zod` 或现有的模式辅助函数。
- 运行时分支：优先使用判别联合/封闭代码而非自由格式字符串。
- 避免语义哨兵值：`?? 0`、空对象/字符串等。
- 动态导入：不要对同一个生产模块同时使用静态导入和动态导入。使用 `*.runtime.ts` 懒加载边界。编辑后：`pnpm build`；检查 `[INEFFECTIVE_DYNAMIC_IMPORT]`。
- 循环依赖：保持 `pnpm check:import-cycles` + architecture/madge 为绿色。
- 类：不使用原型混合/突变。优先使用继承/组合。测试优先使用每个实例的桩。
- 注释：简洁，仅针对非显而易见的逻辑。
- 文件大小约 700 LOC 时分割，当清晰度/可测试性提高时。
- 命名：**OpenClaw** 用于产品/文档；`openclaw` 用于 CLI/包/路径/配置。
- 语言：美式英语拼写。

## 测试

- 使用 Vitest。同目录 `*.test.ts`；e2e `*.e2e.test.ts`；示例模型 `sonnet-4.6`、`gpt-5.4`。
- 避免脆弱测试：不要为操作员策略而 grep 工作流/文档字符串。优先使用可执行的行为、解析后的配置/模式检查或实时运行验证；将发布/CI 策略提醒放在 AGENTS/文档中。
- 清理定时器/环境/全局变量/模拟/套接字/临时目录/模块状态；`--isolate=false` 安全。
- 热点测试：避免每个测试都使用 `vi.resetModules()` + 重量级导入。使用 `pnpm test:perf:imports <文件>` / `pnpm test:perf:hotspots --limit N` 测量。
- 接口深度：纯辅助函数/合约单元测试；每个边界一个集成冒烟测试。
- 直接模拟昂贵的接口：扫描器、清单、注册表、文件系统遍历、提供商 SDK、网络/进程启动。
- 优先使用依赖注入；如果需要模块模拟，模拟狭窄的本地 `*.runtime.ts`，而非宽泛的导出桶或 `openclaw/plugin-sdk/*`。
- 共享测试夹具/构建器；删除重复的断言；断言可能在此处退化的行为。
- 未经明确批准，不要编辑基线/清单/忽略/快照/预期失败文件来沉默检查。
- 不要在同一工作树中同时运行多个独立的 `pnpm test`/Vitest 命令。它们可能在 `node_modules/.experimental-vitest-cache` 上竞争并导致 `ENOTEMPTY` 失败。使用一个分组的 `pnpm test ...` 调用，按顺序运行目标通道，或在需要真正的并行 Vitest 进程时设置不同的 `OPENCLAW_VITEST_FS_MODULE_CACHE_PATH` 值。
- 测试工作线程最多 16 个。内存压力：`OPENCLAW_VITEST_MAX_WORKERS=1 pnpm test`。
- 实时测试：`OPENCLAW_LIVE_TEST=1 pnpm test:live`；详细输出 `OPENCLAW_LIVE_TEST_QUIET=0`。
- 指南：`docs/help/testing.md`。

## 文档 / 变更日志

- 文档随行为/API 变化。使用 docs list/read_when 提示；文档链接参见 `docs/AGENTS.md`。
- 文档最终答案：当文档文件发生变化时，以相关的完整 `https://docs.openclaw.ai/...` URL 结尾。
- 变更日志仅面向用户；修复问题或合并 PR 需要一个变更日志条目，除非纯粹是测试/内部变更。
- 变更日志放置：当前版本下的 `### Changes`/`### Fixes`；每个新增条目必须包含至少一个 `Thanks @作者` 署名，使用经过确认的 GitHub 用户名。绝不要添加 `Thanks @codex`、`Thanks @openclaw` 或 `Thanks @steipete`。
- 变更日志条目始终是单行。不跨多行换行/延续。长条目保持在一长行上，以便去重、PR 引用和信用审计工具正常工作，并保持视觉风格统一。

## Git

- 通过 `scripts/committer "<消息>" <文件...>` 提交；仅暂存预期的文件。它会格式化暂存文件；仍然需要运行门控。
- 提交：遵循常规风格，简洁，分组。
- 除非明确要求，不手动 stash/autostash。除非被要求，不更改分支/工作树。
- `main`：不创建合并提交；推送到 `origin/main` 前先变基到最新版本。在一次绿色运行加上干净的变基健全性检查后，不要通过重复的完整门控来持续追赶 `main`。
- 用户说 `commit`：仅你的更改。`commit all`：分组的全部更改。`push`：可能先执行 `git pull --rebase`。
- 不要删除/重命名意外的文件；如果阻塞则询问，否则忽略。
- 批量 PR 关闭/重新打开超过 5 个：询问数量/范围。
- PR/问题工作流：`$openclaw-pr-maintainer`。`/landpr`：`~/.codex/prompts/landpr.md`。

## 安全 / 发布

- 绝不提交真实的电话号码、视频、凭据、实时配置。
- 密钥：渠道/提供商凭据在 `~/.openclaw/credentials/` 中；模型认证配置文件在 `~/.openclaw/agents/<agentId>/agent/auth-profiles.json` 中。
- 环境密钥：检查 `~/.profile`。
- 依赖补丁/覆盖/供应商更改需要明确批准。`pnpm.patchedDependencies` 仅使用精确版本。
- Carbon 固定所有者专属：除非 Shadow（`@thewilloftheshadow`，通过 `gh` 验证）要求，否则不更改 `@buape/carbon`。
- 发布/发布/版本号提升需要明确批准。发布文档：`docs/reference/RELEASING.md`；使用 `$openclaw-release-maintainer`。
- GHSA/安全公告：`$openclaw-ghsa-maintainer`。
- Beta 标签/版本匹配：`vYYYY.M.D-beta.N` -> npm `YYYY.M.D-beta.N --tag beta`。

## 应用 / 平台

- 在模拟器/仿真器测试前，先检查真实的 iOS/Android 设备。
- "重启 iOS/Android 应用" = 重新构建/重新安装/重新启动，而非杀掉/启动。
- SwiftUI：使用 Observation（`@Observable`、`@Bindable`）而非旧的 `ObservableObject`。
- Mac gateway：开发监视 = `pnpm gateway:watch`（tmux `openclaw-gateway-watch-main`，自动附加）。非交互式：`OPENCLAW_GATEWAY_WATCH_ATTACH=0 pnpm gateway:watch`；附加/停止：`tmux attach -t openclaw-gateway-watch-main` / `tmux kill-session -t openclaw-gateway-watch-main`。托管安装：`openclaw gateway restart/status --deep`。不使用 launchd/临时 tmux。日志：`./scripts/clawlog.sh`。
- 版本号提升涉及：`package.json`、`apps/android/app/build.gradle.kts`、`apps/ios/version.json` + `pnpm ios:version:sync`、macOS `Info.plist`、`docs/install/updating.md`。Appcast 仅用于 Sparkle 发布。
- 移动设备局域网配对：明文 `ws://` 仅限本地回环。私有网络 `ws://` 需要 `OPENCLAW_ALLOW_INSECURE_PRIVATE_WS=1`；Tailscale/公网使用 `wss://` 或隧道。
- A2UI 哈希 `src/canvas-host/a2ui/.bundle.hash`：已生成；除非运行 `pnpm canvas:a2ui:bundle`，否则忽略；单独提交。

## 运维 / 陷阱

- 远程安装文档：`docs/install/{exe-dev,fly,hetzner}.md`。Parallels 冒烟测试：`$openclaw-parallels-smoke`；Discord 往返测试：`parallels-discord-roundtrip`。
- 记忆 Wiki：保持提示摘要极小。提示应仅说明 Wiki 存在，优先使用 `wiki_search` / `wiki_get`，从 `reports/person-agent-directory.md` 开始进行人员路由，在必要时使用搜索模式（`find-person`、`route-question`、`source-evidence`、`raw-claim`），并在使用前验证联系信息。
- 人员 Wiki 来源：生成的身份、社交、联系信息和"有趣细节"备注需要明确的来源分类/置信度（`maintainer-whois`、Discrawl 样本/统计、GitHub 个人资料、维护者仓库文件）。不要将推断的细节提升为事实。
- 品牌重命名/迁移/配置警告：运行 `openclaw doctor`。
- 绝不编辑 `node_modules`。
- 仅本地的 `.agents` 忽略：`.git/info/exclude`，而非仓库 `.gitignore`。
- CLI 进度条：`src/cli/progress.ts`；状态表格：`src/terminal/table.ts`。
- 连接/提供商添加：更新所有 UI 界面 + 文档 + 状态/配置表单。
- 提供商工具模式：优先使用扁平的字符串枚举辅助函数而非 `Type.Union([Type.Literal(...)])`；某些提供商拒绝 `anyOf`。这不是仓库范围的协议/模式禁令。
- 外部消息传递：不发送令牌差量频道消息。遵循 `docs/concepts/streaming.md`；预览/块流使用编辑/块并保留最终/回退投递。
