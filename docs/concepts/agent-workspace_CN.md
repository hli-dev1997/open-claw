---
summary: "Agent workspace: location, layout, and backup strategy"
read_when:
  - You need to explain the agent workspace or its file layout
  - You want to back up or migrate an agent workspace
title: "Agent workspace"
sidebarTitle: "Agent workspace"
---

工作区是智能体的家。它是用于文件工具和工作区上下文的唯一工作目录。保持其私密性并将其视为内存。

它与 `~/.openclaw/` 不同，后者存储配置、凭据和会话。

<Warning>
工作区是**默认的cwd**，而不是硬沙箱。工具可以解析工作区的相对路径，但除非启用沙箱，否则绝对路径仍然可以到达主机上的其他位置。如果需要隔离，请使用 [`agents.defaults.sandbox`](/gateway/sandboxing) （和/或每个智能体沙箱配置）。

当启用沙箱且 `workspaceAccess` 不是 `"rw"` 时，工具在 `~/.openclaw/sandboxes` 下的沙箱工作区（而不是主机工作区）内运行。
</Warning>

## 默认位置

- 默认值：`~/.openclaw/workspace`
- 如果设置了 `OPENCLAW_PROFILE` 而不是 `"default"`，则默认值变为 `~/.openclaw/workspace-<profile>`。
- 在 `~/.openclaw/openclaw.json` 中覆盖：

```json5
{
  agents: {
    defaults: {
      workspace: "~/.openclaw/workspace",
    },
  },
}
```

`openclaw onboard`、`openclaw configure` 或 `openclaw setup` 将创建工作区并为引导文件（如果丢失）提供种子。

<Note>
沙箱种子副本仅接受常规工作区内文件；在源工作区之外解析的符号链接/硬链接别名将被忽略。
</Note>

如果你已经自己管理工作区文件，则可以禁用引导文件创建：

```json5
{ agents: { defaults: { skipBootstrap: true } } }
```

## 额外的工作区文件夹

较旧的安装可能已创建 `~/openclaw`。保留多个工作区目录可能会导致认证混乱或状态漂移，因为一次只有一个工作区处于活动状态。

<Note>
**建议：** 保留一个活动工作区。如果你不再使用额外的文件夹，请将其存档或移至废纸篓（例如 `trash ~/openclaw`）。如果你有意保留多个工作区，请确保 `agents.defaults.workspace` 指向活动工作区。

`openclaw doctor` 在检测到额外的工作区目录时发出警告。
</Note>

## 工作区文件映射

这些是 OpenClaw 在工作区中期望的标准文件：

<AccordionGroup>
  <Accordion title="AGENTS.md — operating instructions">
    智能体的操作说明以及它应如何使用内存。在每个会话开始时加载。放置规则、优先级和“行为方式”细节的好地方。
  </Accordion>
  <Accordion title="SOUL.md — persona and tone">
    角色、语气和界限。加载每个会话。指南：[SOUL.md 个性指南](/concepts/soul)。
  </Accordion>
  <Accordion title="USER.md — who the user is">
    用户是谁以及如何称呼他们。加载每个会话。
  </Accordion>
  <Accordion title="IDENTITY.md — name, vibe, emoji">
    特工的姓名、氛围和表情符号。在引导仪式期间创建/更新。
  </Accordion>
  <Accordion title="TOOLS.md — local tool conventions">
    有关本地工具和约定的注释。不控制工具的可用性；这只是指导。
  </Accordion>
  <Accordion title="HEARTBEAT.md — heartbeat checklist">
    用于心跳运行的可选小清单。保持简短以避免token燃烧。
  </Accordion>
  <Accordion title="BOOT.md — startup checklist">
    可选的启动检查列表在网关重新启动时自动运行（当启用 [内部挂钩](/automation/hooks) 时）。保持简短；使用消息工具进行出站发送。
  </Accordion>
  <Accordion title="BOOTSTRAP.md — first-run ritual">
    一次性的首次运行仪式。专为全新的工作区而创建。仪式完成后将其删除。
  </Accordion>
  <Accordion title="memory/YYYY-MM-DD.md — daily memory log">
    每日内存日志（每天一个文件）。建议在今天+昨天会议开始时阅读。
  </Accordion>
  <Accordion title="MEMORY.md — curated long-term memory (optional)">
    精心策划的长期记忆。仅在主专用会话（而不是共享/组上下文）中加载。有关工作流程和自动内存刷新，请参阅[内存](/concepts/memory)。
  </Accordion>
  <Accordion title="skills/ — workspace skills (optional)">
    工作场所特定的技能。该工作区的最高优先级技能位置。当名称发生冲突时，覆盖项目智能体技能、个人智能体技能、托管技能、捆绑技能和 `skills.load.extraDirs`。
  </Accordion>
  <Accordion title="canvas/ — Canvas UI files (optional)">
    Canvas UI 用于节点显示的文件（例如 `canvas/index.html`）。
  </Accordion>
</AccordionGroup>

<Note>
如果丢失任何引导程序文件，OpenClaw 会将“丢失文件”标记注入到会话中并继续。注入时大型引导文件会被截断；使用 `agents.defaults.bootstrapMaxChars` （默认值：12000）和 `agents.defaults.bootstrapTotalMaxChars` （默认值：60000）调整限制。 `openclaw setup` 可以重新创建丢失的默认值，而无需覆盖现有文件。
</Note>

## 工作区中的 NOT 是什么

这些位于 `~/.openclaw/` 下，并且应该将 NOT 提交到工作区存储库：

- `~/.openclaw/openclaw.json`（配置）
- `~/.openclaw/agents/<agentId>/agent/auth-profiles.json`（模型认证配置文件：OAuth + API 密钥）
- `~/.openclaw/agents/<agentId>/agent/codex-home/`（每个智能体 Codex 运行时帐户、配置、技能、插件和本机线程状态）
- `~/.openclaw/credentials/`（通道/提供商状态加上旧版 OAuth 导入数据）
- `~/.openclaw/agents/<agentId>/sessions/`（会话记录 + 元数据）
- `~/.openclaw/skills/`（管理技能）

如果你需要迁移会话或配置，请单独复制它们并使它们不受版本控制。

## Git 备份（推荐，私有）

将工作区视为私有内存。将其放入**私有** git 存储库中，以便对其进行备份和恢复。

在运行 Gateway 的计算机（即工作区所在的位置）上运行这些步骤。

<Steps>
  <Step title="Initialize the repo">
    如果安装了 git，则会自动初始化全新的工作区。如果此工作区还不是存储库，请运行：

    ```bash
    cd ~/.openclaw/workspace
    git init
    git add AGENTS.md SOUL.md TOOLS.md IDENTITY.md USER.md HEARTBEAT.md memory/
    git commit -m "Add agent workspace"
    ```

  </Step>
  <Step title="Add a private remote">
    <Tabs>
      <Tab title="GitHub web UI">
        1. 在 GitHub 上创建一个新的 **私有** 存储库。
        2. 不要使用 README 进行初始化（避免合并冲突）。
        3. 复制 HTTPS 远程 URL。
        4.添加遥控器并推送：

        ```bash
        git branch -M main
        git remote add origin <https-url>
        git push -u origin main
        ```
      </Tab>
      <Tab title="GitHub CLI (gh)">
        ```bash
        gh auth login
        gh repo create openclaw-workspace --private --source . --remote origin --push
        ```
      </Tab>
      <Tab title="GitLab web UI">
        1. 在 GitLab 上创建一个新的 **私有** 存储库。
        2. 不要使用 README 进行初始化（避免合并冲突）。
        3. 复制 HTTPS 远程 URL。
        4.添加遥控器并推送：

        ```bash
        git branch -M main
        git remote add origin <https-url>
        git push -u origin main
        ```
      </Tab>
    </Tabs>

  </Step>
  <Step title="Ongoing updates">
    ```bash
    git status
    git add .
    git commit -m "Update memory"
    git push
    ```
  </Step>
</Steps>

## 不要泄露秘密

<Warning>
即使在私人仓库中，也避免在工作区中存储机密：

- API 密钥、OAuth token、密码或私人凭据。
- `~/.openclaw/` 下的任何内容。
- 聊天或敏感附件的原始转储。

如果必须存储敏感引用，请使用占位符并在其他地方保留真正的秘密（密码管理器、环境变量或 `~/.openclaw/`）。
</Warning>

建议的 `.gitignore` 启动器：

```gitignore
.DS_Store
.env
**/*.key
**/*.pem
**/secrets*
```

## 将工作区移至新机器

<Steps>
  <Step title="Clone the repo">
    将存储库克隆到所需路径（默认 `~/.openclaw/workspace`）。
  </Step>
  <Step title="Update config">
    将 `agents.defaults.workspace` 设置为 `~/.openclaw/openclaw.json` 中的该路径。
  </Step>
  <Step title="Seed missing files">
    运行 `openclaw setup --workspace <path>` 来播种任何丢失的文件。
  </Step>
  <Step title="Copy sessions (optional)">
    如果你需要会话，请单独从旧计算机复制 `~/.openclaw/agents/<agentId>/sessions/` 。
  </Step>
</Steps>

## 高级注释

- 多智能体路由可以为每个智能体使用不同的工作区。有关路由配置，请参阅[通道路由](/channels/channel-routing)。
- 如果启用 `agents.defaults.sandbox`，非主会话可以使用 `agents.defaults.sandbox.workspaceRoot` 下的每会话沙箱工作区。

## 相关

- [心跳](/gateway/heartbeat) — HEARTBEAT.md 工作区文件
- [沙盒](/gateway/sandboxing) — 沙盒环境中的工作区访问
- [Session](/concepts/session) — 会话存储路径
- [常规命令](/automation/standing-orders) — 工作区文件中的持久指令
