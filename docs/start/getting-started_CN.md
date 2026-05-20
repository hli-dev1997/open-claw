---
summary: "Get OpenClaw installed and run your first chat in minutes."
read_when:
  - First time setup from zero
  - You want the fastest path to a working chat
title: "Getting started"
---

安装 OpenClaw、运行入门并与你的 AI 助手聊天 — 一切尽在其中
约5分钟。最后，你将拥有一个正在运行的 Gateway，已配置认证，
and a working chat session.

## 你需要什么

- **Node.js** — 推荐 Node 24（也支持 Node 22.14+）
- **来自模型提供商的 API 密钥**（Anthropic、OpenAI、Google 等）— 入门时会提示你

<Tip>
使用 `node --version` 检查你的 Node 版本。
**Windows 用户：** 支持本机 Windows 和 WSL2。 WSL2 更多
stable and recommended for the full experience. See [Windows](/platforms/windows).
需要安装Node？请参阅 [Node 设置](/install/node)。
</Tip>

## 快速设置

<Steps>
  <Step title="Install OpenClaw">
    <Tabs>
      <Tab title="macOS / Linux">
        ```bash
        curl -fsSL https://openclaw.ai/install.sh | bash
        ```
        <图片
  src =“/assets/install-script.svg”
  alt="安装脚本过程"
  类名=“圆角-lg”
/>
      </Tab>
      <Tab title="Windows (PowerShell)">
        ```powershell
        iwr -useb https://openclaw.ai/install.ps1 | iex
        ```
      </Tab>
    </Tabs>

    <Note>
    其他安装方法（Docker、Nix、npm）：[安装](/install)。
    </Note>

  </Step>
  <Step title="Run onboarding">
    ```bash
    openclaw onboard --install-daemon
    ```

    该向导将引导你选择模型提供商、设置 API 密钥，
    并配置 Gateway。大约需要2分钟。

    请参阅 [入门 (CLI)](/start/wizard) 以获取完整参考。

  </Step>
  <Step title="Verify the Gateway is running">
    ```bash
    openclaw gateway status
    ```

    你应该看到 Gateway 正在侦听端口 18789。

  </Step>
  <Step title="Open the dashboard">
    ```bash
    openclaw dashboard
    ```

    这将在浏览器中打开 Control UI。如果加载，则一切正常。

  </Step>
  <Step title="Send your first message">
    在 Control UI 聊天中输入一条消息，你应该会收到 AI 回复。

    想通过手机聊天吗？设置最快的通道是
    [Telegram](/channels/telegram)（只是一个机器人token）。请参阅[频道](/channels)
    对于所有选项。

  </Step>
</Steps>

<Accordion title="Advanced: mount a custom Control UI build">
  如果你维护本地化或自定义的仪表板构建，请点
  `gateway.controlUi.root` 到包含你构建的静态的目录
  资产和`index.html`。

```bash
mkdir -p "$HOME/.openclaw/control-ui-custom"
# Copy your built static files into that directory.
```

然后设置：

```json
{
  "gateway": {
    "controlUi": {
      "enabled": true,
      "root": "$HOME/.openclaw/control-ui-custom"
    }
  }
}
```

重新启动网关并重新打开仪表板：

```bash
openclaw gateway restart
openclaw dashboard
```

</Accordion>

## 接下来做什么

<Columns>
  <Card title="Connect a channel" href="/channels" icon="message-square">
    Discord、飞书、iMessage、Matrix、Microsoft Teams、Signal、Slack、Telegram、 WhatsApp、Zalo 等。
  </Card>
  <Card title="Pairing and safety" href="/channels/pairing" icon="shield">
    控制谁可以向你的智能体发送消息。
  </Card>
  <Card title="Configure the Gateway" href="/gateway/configuration" icon="settings">
    模型、工具、沙箱和高级设置。
  </Card>
  <Card title="Browse tools" href="/tools" icon="wrench">
    浏览器、执行程序、网络搜索、技能和插件。
  </Card>
</Columns>

<Accordion title="Advanced: environment variables">
  如果你将 OpenClaw 作为服务帐户运行或想要自定义路径：

- `OPENCLAW_HOME` — 用于内部路径解析的主目录
- `OPENCLAW_STATE_DIR` — 覆盖状态目录
- `OPENCLAW_CONFIG_PATH` — 覆盖配置文件路径

完整参考：[环境变量](/help/environment)。
</Accordion>

## 相关

- [安装概述](/install)
- [频道概述](/channels)
- [设置](/start/setup)
