---
summary: "Overview of OpenClaw onboarding options and flows"
read_when:
  - Choosing an onboarding path
  - Setting up a new environment
title: "Onboarding overview"
sidebarTitle: "Onboarding Overview"
---

OpenClaw 有两个加入路径。两者都配置认证、Gateway 和
可选的聊天频道 - 它们只是在你与设置交互的方式上有所不同。

## 我应该使用哪条路径？

|            | CLI 入职                             | macOS 应用入门       |
| ---------- | ------------------------------------ | -------------------- |
| **平台**   | macOS、Linux、Windows（本机或 WSL2） | 仅 macOS             |
| **界面**   | 终端向导                             | 应用中的引导 UI      |
| **最适合** | 服务器，headless，完全控制           | 桌面 Mac，可视化设置 |
| **自动化** | `--non-interactive` 用于脚本         | 仅限手动             |
| **命令**   | `openclaw onboard`                   | 启动应用             |

大多数用户应该从**CLI入职**开始——它可以在任何地方使用并提供
你最有控制力。

## 入门配置是什么

无论你选择哪条路径，入职设置都会：

1. **模型提供商和认证** — API 密钥、OAuth 或你选择的提供商的设置token
2. **工作区** — 智能体文件、引导模板和内存的目录
3. **Gateway** — 端口、绑定地址、验证模式
4. **频道**（可选）——内置和捆绑的聊天频道，例如
   BlueBubbles、Discord、飞书、Google Chat、Mattermost、Microsoft Teams、
   Telegram、WhatsApp 等
5. **守护进程**（可选）- 后台服务，以便 Gateway 自动启动

## CLI 入职

在任意终端运行：

```bash
openclaw onboard
```

添加 `--install-daemon` 也可以一步安装后台服务。

完整参考：[入职 (CLI)](/start/wizard)
CLI 命令文档：[`openclaw onboard`](/cli/onboard)

## macOS 应用入门

打开 OpenClaw 应用。首次运行向导将引导你完成相同的步骤
具有可视化界面。

完整参考：[入门（macOS 应用）](/start/onboarding)

## 自定义或未列出的提供商

如果你的提供商未在入职培训中列出，请选择 **自定义提供商** 并
输入：

- API 兼容模式（OpenAI 兼容、Anthropic 兼容或自动检测）
- 基本 URL 和 API 密钥
- 模型 ID 和可选别名

多个自定义端点可以共存 - 每个端点都有自己的端点 ID。

## 相关

- [入门](/start/getting-started)
- [CLI 设置参考](/start/wizard-cli-reference)
