---
summary: "OpenClaw capabilities across channels, routing, media, and UX."
read_when:
  - You want a full list of what OpenClaw supports
title: "Features"
---

## 亮点

<Columns>
  <Card title="Channels" icon="message-square" href="/channels">
    Discord、iMessage、Signal、Slack、Telegram、WhatsApp、WebChat 等Gateway。
  </Card>
  <Card title="Plugins" icon="plug" href="/tools/plugin">
    捆绑插件添加了 Matrix、Nextcloud Talk、Nostr、Twitch、Zalo 等，在正常的当前版本中无需单独安装。
  </Card>
  <Card title="Routing" icon="route" href="/concepts/multi-agent">
    具有隔离会话的多智能体路由。
  </Card>
  <Card title="Media" icon="image" href="/nodes/images">
    图像、音频、视频、文档以及图像/视频生成。
  </Card>
  <Card title="Apps and UI" icon="monitor" href="/web/control-ui">
    Web Control UI 和 macOS 配套应用。
  </Card>
  <Card title="Mobile nodes" icon="smartphone" href="/nodes">
    iOS 和 Android 节点具有配对、语音/聊天和丰富的设备命令。
  </Card>
</Columns>

## 完整列表

**频道：**

- 内置通道包括 Discord、Google Chat、iMessage（旧版）、IRC、Signal、Slack、 Telegram、WebChat 和 WhatsApp
- 捆绑插件频道包括 BlueBubbles for iMessage、Feishu、LINE、Matrix、Mattermost、Microsoft Teams、Nextcloud Talk、Nostr、QQ Bot、Synology Chat、Tlon、 Twitch、Zalo 和 Zalo Personal
- 可选单独安装的渠道插件包括语音通话和微信等第三方软件包
- 第三方渠道插件可以进一步扩展Gateway，例如微信
- 群聊支持以及基于提及的激活
- 通过许可名单和配对实现 DM 安全

**智能体：**

- 具有工具流的嵌入式智能体运行时
- 多智能体路由，每个工作区或发送者具有隔离会话
- 会话：直接聊天折叠为共享 `main`；群体是孤立的
- 长响应的流式传输和分块

**授权和提供商：**

- 超过 35 个模型提供商（Anthropic、OpenAI、Google 等）
- 通过 OAuth 进行订阅授权 (e.g.OpenAI Codex)
- 自定义和自托管提供商支持（vLLM、SGLang、Ollama 和任何 OpenAI 兼容或 Anthropic 兼容端点）

**媒体：**

- 图片、音频、视频和文档的输入和输出
- 共享图像生成和视频生成功能界面
- 语音笔记转录
- 与多个提供商的文本转语音

**应用和界面：**

- WebChat 和浏览器 Control UI
- macOS 菜单栏配套应用
- iOS 节点，具有配对、Canvas、摄像头、屏幕录制、位置和语音
- Android 节点，具有配对、聊天、语音、Canvas、相机和设备命令

**工具和自动化：**

- 浏览器自动化、执行、沙箱
- 网页搜索（Brave、DuckDuckGo、Exa、Firecrawl、Gemini、Grok、Kimi、MiniMax 搜索、Ollama 网页搜索、Perplexity、SearXNG、Tavily）
- Cron 作业和心跳调度
- Skills、插件和工作流程管道（龙虾）

## 相关

- [实验特性](/concepts/experimental-features)
- [智能体运行时](/concepts/agent)
