---
summary: "First-run setup flow for OpenClaw (macOS app)"
read_when:
  - Designing the macOS onboarding assistant
  - Implementing auth or identity setup
title: "Onboarding (macOS app)"
sidebarTitle: "Onboarding: macOS App"
---

本文档描述了**当前**首次运行设置流程。目标是一个
流畅的“第 0 天”体验：选择 Gateway 运行的位置，连接认证，运行
向导，并让智能体自行引导。
有关入门路径的一般概述，请参阅[入门概述](/start/onboarding-overview)。

<Steps>
<Step title="Approve macOS warning">
<Frame>
<img src="/assets/macos-onboarding/01-macos-warning.jpeg" alt="" />
</Frame>
</Step>
<Step title="Approve find local networks">
<Frame>
<img src="/assets/macos-onboarding/02-local-networks.jpeg" alt="" />
</Frame>
</Step>
<Step title="Welcome and security notice">
<Frame caption="Read the security notice displayed and decide accordingly">
<img src="/assets/macos-onboarding/03-security-notice.png" alt="" />
</Frame>

安全信任模型：

- 默认情况下，OpenClaw 是一名个人智能体：一个受信任的操作员边界。
- 共享/多用户设置需要锁定（分割信任边界，保持工具访问最小化，并遵循 [安全](/gateway/security)）。
- 本地载入现在默认新配置为 `tools.profile: "coding"`，因此新的本地设置可以保留文件系统/运行时工具，而不会强制使用不受限制的 `full` 配置文件。
- 如果启用了钩子/网络钩子或其他不受信任的内容提要，请使用强大的现代模型层并保持严格的工具策略/沙箱。

</Step>
<Step title="Local vs Remote">
<Frame>
<img src="/assets/macos-onboarding/04-choose-gateway.png" alt="" />
</Frame>

**Gateway** 在哪里运行？

- **此 Mac（仅限本地）：** 入门可以配置认证并写入凭据
  本地。
- **远程（通过 SSH/Tailnet）：** 加入不会**配置本地认证；
  凭据必须存在于网关主机上。
- **稍后配置：** 跳过设置并保持应用未配置。

<Tip>
**Gateway 认证提示：**

- 向导现在甚至会为环回生成 **token**，因此本地 WS 客户端必须进行认证。
- 如果禁用认证，任何本地进程都可以连接；仅在完全受信任的机器上使用它。
- 使用**token**进行多机访问或非环回绑定。

</Tip>
</Step>
<Step title="Permissions">
<Frame caption="Choose what permissions do you want to give OpenClaw">
<img src="/assets/macos-onboarding/05-permissions.png" alt="" />
</Frame>

入职请求 TCC 所需的权限：

- 自动化（AppleScript）
- 通知
- 无障碍设施
- 屏幕录制
- 麦克风
- 语音识别
- 相机
- 地点

</Step>
<Step title="CLI">
  <Info>此步骤是可选的</Info>
  该应用可以通过npm、pnpm或bun安装全局`openclaw` CLI。
  它首先首选 npm，然后是 pnpm，然后是 Bun（如果这是唯一检测到的）
  包管理器。对于 Gateway 运行时，Node 仍然是建议的路径。
</Step>
<Step title="Onboarding Chat (dedicated session)">
  设置后，该应用会打开一个专用的入职聊天会话，以便智能体可以
  自我介绍并指导后续步骤。这使得首次运行指南是分开的
  从你们的正常谈话中。请参阅[引导](/start/bootstrapping)
  第一次智能体运行期间网关主机上发生的情况。
</Step>
</Steps>

## 相关

- [入门概述](/start/onboarding-overview)
- [入门](/start/getting-started)
