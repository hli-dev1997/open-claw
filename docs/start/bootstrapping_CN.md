---
summary: "Agent bootstrapping ritual that seeds the workspace and identity files"
read_when:
  - Understanding what happens on the first agent run
  - Explaining where bootstrapping files live
  - Debugging onboarding identity setup
title: "Agent bootstrapping"
sidebarTitle: "Bootstrapping"
---

引导是**首次运行**仪式，用于准备智能体工作区并
收集身份详细信息。它发生在入职后，智能体启动时
第一次。

## 引导的作用是什么

在第一次智能体运行时，OpenClaw 引导工作区（默认
`~/.openclaw/workspace`):

- 种子 `AGENTS.md`、`BOOTSTRAP.md`、`IDENTITY.md`、`USER.md`。
- 进行简短的问答仪式（一次一个问题）。
- 将身份+首选项写入`IDENTITY.md`、`USER.md`、`SOUL.md`。
- 完成后删除 `BOOTSTRAP.md`，因此它只运行一次。

对于嵌入式/本地模型运行，OpenClaw 将 `BOOTSTRAP.md` 保留在
特权系统上下文。在主要交互式第一次运行时，它仍然通过
用户提示中的文件内容，以便模型不能可靠地调用
`read`工具可以完成仪式。如果当前运行无法安全访问
工作区中，智能体会收到有限的引导注释，而不是通用问候语。

## 跳过引导

要为预先设定的工作区跳过此步骤，请运行 `openclaw onboard --skip-bootstrap`。

## 它运行的地方

引导始终在 **网关主机** 上运行。如果 macOS 应用连接到
远程 Gateway，工作区和引导文件位于该远程
机。

<Note>
当Gateway在另一台机器上运行时，编辑网关上的工作区文件
主机（例如，`user@gateway-host:~/.openclaw/workspace`）。
</Note>

## 相关文档

- macOS 应用入门：[入门](/start/onboarding)
- 工作区布局：[智能体工作区](/concepts/agent-workspace)
