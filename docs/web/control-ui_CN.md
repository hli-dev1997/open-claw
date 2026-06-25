---
summary: "Browser-based control UI for the Gateway (chat, nodes, config)"
read_when:
  - You want to operate the Gateway from a browser
  - You want Tailnet access without SSH tunnels
title: "Control UI"
sidebarTitle: "Control UI"
---

Control UI 是一个小型 **Vite + Lit** 单页应用，由 Gateway 提供服务：

- 默认：`http://<host>:18789/`
- 可选前缀：设置 `gateway.controlUi.basePath` (e.g.`/openclaw`)

它**直接与同一端口上的 Gateway WebSocket** 通信。

## 快速打开（本地）

如果 Gateway 正在同一台计算机上运行，请打开：

- [http://127.0.0.1:18789/](http://127.0.0.1:18789/)（或 [http://localhost:18789/](http://localhost:18789/)）

如果页面加载失败，请先启动Gateway：`openclaw gateway`。

在 WebSocket 握手期间通过以下方式提供认证：

- `connect.params.auth.token`
- `connect.params.auth.password`
- Tailscale 在 `gateway.auth.allowTailscale: true` 时提供身份标头
- `gateway.auth.mode: "trusted-proxy"` 时的可信智能体身份标头

仪表板设置面板保留当前浏览器选项卡会话和选定网关的token URL；密码不会被保留。入职通常会在首次连接时生成用于共享秘密认证的网关token，但当 `gateway.auth.mode` 为 `"password"` 时，密码认证也可以工作。

## 设备配对（首次连接）

当你从新的浏览器或设备连接到 Control UI 时，Gateway 通常需要**一次性配对批准**。这是防止未经授权的访问的安全措施。

**你将看到：**“已断开连接 (1008)：需要配对”

<Steps>
  <Step title="List pending requests">
    ```bash
    openclaw devices list
    ```
  </Step>
  <Step title="Approve by request ID">
    ```bash
    openclaw devices approve <requestId>
    ```
  </Step>
</Steps>

如果浏览器重试与更改的认证详细信息（角色/范围/公钥）配对，则先前的待处理请求将被取代并创建新的 `requestId` 。在批准之前重新运行 `openclaw devices list`。

如果浏览器已配对并且你将其从读取访问权限更改为写入/管理访问权限，则这将被视为批准升级，而不是静默重新连接。 OpenClaw 保持旧的批准处于活动状态，阻止更广泛的重新连接，并要求你明确批准新的范围集。

一旦获得批准，设备就会被记住，并且不需要重新批准，除非你使用 `openclaw devices revoke --device <id> --role <role>` 撤销它。请参阅 [设备 CLI](/cli/devices) 了解token轮换和撤销。

<Note>
- 直接本地环回浏览器连接 (`127.0.0.1` / `localhost`) 会自动批准。
- 当 `gateway.auth.allowTailscale: true`、Tailscale 认证时，Tailscale Serve 可以跳过 Control UI 操作员会话的配对往返，并且浏览器显示其设备身份。
- 直接Tailnet绑定，LAN浏览器连接，并且没有设备标识的浏览器配置文件仍然需要明确批准。
- 每个浏览器配置文件都会生成唯一的设备 ID，因此切换浏览器或清除浏览器数据将需要重新配对。

</Note>

## 个人身份（浏览器本地）

Control UI 支持将每个浏览器的个人身份（显示名称和头像）附加到传出消息中，以便在共享会话中进行归因。它存在于浏览器存储中，范围仅限于当前浏览器配置文件，并且不会与其他设备同步，也不会在你实际发送的消息上的正常转录作者元数据之外保留在服务器端。清除站点数据或切换浏览器会将其重置为空。

相同的浏览器本地模式适用于助理头像覆盖。上传的助理头像仅在本地浏览器上覆盖网关解析的身份，并且不会通过 `config.patch` 往返。共享 `ui.assistant.avatar` 配置字段仍然可用于直接写入该字段的非 UI 客户端（例如脚本化网关或自定义仪表板）。

## 运行时配置端点

Control UI 从 `/__openclaw/control-ui-config.json` 获取其运行时设置。该端点由与 HTTP 表面的其余部分相同的网关认证进行控制：未经认证的浏览器无法获取它，并且成功的获取需要已经有效的网关token/密码、Tailscale 服务身份或受信任的智能体身份。

## 语言支持

Control UI 可以在首次加载时根据你的浏览器区域设置进行自身本地化。要稍后覆盖它，请打开 **概述 -> Gateway 访问 -> 语言**。区域设置选择器位于 Gateway 访问卡中，而不是在外观下。

- 支持的区域设置：`en`、`zh-CN`、`zh-TW`、`pt-BR`、`de`、`es`、 `ja-JP`、`ko`、`fr`、`ar`、`it`、`tr`、`uk`、 `id`、`pl`、`th`、`vi`、`nl`、`fa`
- 非英语翻译在浏览器中延迟加载。
- 所选区域设置保存在浏览器存储中，并在将来访问时重复使用。
- 缺少翻译键会回退为英语。

文档翻译是针对相同的非英语区域设置生成的，但文档站点的内置 Mintlify 语言选择器仅限于 Mintlify 接受的区域设置代码。泰语 (`th`) 和波斯语 (`fa`) 文档仍然在发布存储库中生成；在 Mintlify 支持这些代码之前，它们可能不会出现在该选择器中。

## 外观主题

外观面板保留了内置的 Claw、Knot 和 Dash 主题，以及一个浏览器本地的tweakcn 导入槽。要导入主题，请打开[tweakcn主题](https://tweakcn.com/themes)，选择或创建主题，单击**共享**，然后将复制的主题链接粘贴到外观中。导入程序还接受 `https://tweakcn.com/r/themes/<id>` 注册表 URL、编辑器 URL（如 `https://tweakcn.com/editor/theme?theme=amethyst-haze`）、相对 `/themes/<id>` 路径、原始主题 ID 和默认主题名称（如 `amethyst-haze`）。

导入的主题仅存储在当前浏览器配置文件中。它们不会写入网关配置，也不会跨设备同步。替换导入的主题会更新一个本地插槽；如果选择了导入的主题，则清除它会将活动主题切换回 Claw。

## 它能做什么（今天）

<AccordionGroup>
  <Accordion title="Chat and Talk">
    - 通过 Gateway WS (`chat.history`、`chat.send`、`chat.abort`、`chat.inject`) 与模型聊天。
    - 通过浏览器实时会话进行交谈。 OpenAI 使用直接 WebRTC，Google Live 在 WebSocket 上使用受限的一次性浏览器token，仅后端实时语音插件使用 Gateway 中继传输。中继将提供商凭据保留在 Gateway 上，同时浏览器通过 `talk.realtime.relay*` RPC 流式传输麦克风 PCM，并通过 `chat.send` 发送 `openclaw_agent_consult` 工具回调以获取更大的配置 OpenClaw模型。
    - 聊天中的流工具调用 + 实时工具输出卡（智能体事件）。

  </Accordion>
  <Accordion title="Channels, instances, sessions, dreams">
    - 频道：内置加捆绑/外部插件频道状态、二维码登录和每频道配置（`channels.status`、`web.login.*`、`config.patch`）。
    - 实例：存在列表 + 刷新 (`system-presence`)。
    - 会话：列表+每个会话模型/思考/快速/详细/跟踪/推理覆盖（`sessions.list`、`sessions.patch`）。
    - 梦想：做梦状态、启用/禁用切换和梦想日记阅读器（`doctor.memory.status`、`doctor.memory.dreamDiary`、`config.patch`）。

  </Accordion>
  <Accordion title="Cron, skills, nodes, exec approvals">
    - Cron 作业：列出/添加/编辑/运行/启用/禁用 + 运行历史记录 (`cron.*`)。
    - Skills：状态、启用/禁用、安装、API 密钥更新 (`skills.*`)。
    - 节点：列表 + 大写字母 (`node.list`)。
    - 执行批准：编辑网关或节点允许列表 + 询问 `exec host=gateway/node` (`exec.approvals.*`) 的策略。

  </Accordion>
  <Accordion title="Config">
    - 查看/编辑 `~/.openclaw/openclaw.json` (`config.get`、`config.set`)。
    - 应用 + 重新启动并进行验证 (`config.apply`) 并唤醒最后一个活动会话。
    - 写入包括基本哈希保护，以防止破坏并发编辑。
    - 为提交的配置负载中的引用写入 (`config.set`/`config.apply`/`config.patch`) 预检活动 SecretRef 解析；未解析的活动提交的引用在写入之前被拒绝。
    - 模式+表单渲染（`config.schema` / `config.schema.lookup`，包括字段`title` / `description`，匹配的UI提示，直接子摘要，嵌套对象/通配符/数组/组合节点上的文档元数据，以及插件+ 渠道模式（如果可用）；仅当快照具有安全的原始往返时，原始 JSON 编辑器才可用。
    - 如果快照无法安全地往返原始文本，Control UI 会强制采用表单模式并禁用该快照的原始模式。
    - 原始 JSON 编辑器“重置为保存”保留原始创作的形状（格式、注释、`$include` 布局），而不是重新渲染扁平快照，因此当快照可以安全往返时，外部编辑可以在重置后继续存在。
    - 结构化 SecretRef 对象值在表单文本输入中呈现为只读，以防止意外的对象到字符串损坏。

  </Accordion>
  <Accordion title="Debug, logs, update">
    - 调试：状态/运行状况/模型快照 + 事件日志 + 手动 RPC 调用（`status`、`health`、`models.list`）。
    - 日志：带有过滤器/导出功能的网关文件日志的实时尾部 (`logs.tail`)。
    - 更新：运行 package/git update + restart (`update.run`) 并提供重新启动报告，然后在重新连接后轮询 `update.status` 以验证正在运行的网关版本。

  </Accordion>
  <Accordion title="Cron jobs panel notes">
    - 对于孤立的作业，交付默认公布摘要。如果你希望仅在内部运行，则可以切换为“无”。
    - 选择公告时会出现频道/目标字段。
    - Webhook 模式使用 `delivery.mode = "webhook"`，并将 `delivery.to` 设置为有效的 HTTP(S) webhook URL。
    - 对于主会话作业，可以使用 Webhook 和无交付模式。
    - 高级编辑控件包括运行后删除、清除智能体覆盖、cron 精确/交错选项、智能体模型/思考覆盖以及尽力交付切换。
    - 表单验证与字段级错误一致；无效值会禁用保存按钮，直至修复。
    - 设置 `cron.webhookToken` 以发送专用承载token，如果省略，则发送 webhook 时不带认证标头。
    - 已弃用的回退：使用 `notify: true` 存储的旧作业在迁移之前仍可以使用 `cron.webhook`。

  </Accordion>
</AccordionGroup>

## 聊天行为

<AccordionGroup>
  <Accordion title="Send and history semantics">
    - `chat.send` 是 **非阻塞**：它立即通过 `{ runId, status: "started" }` 进行确认，并通过 `chat` 事件进行响应流。
    - 聊天上传接受图像和非视频文件。图片保持原生图片路径；其他文件存储为托管媒体并在历史记录中显示为附件链接。
    - 使用相同的 `idempotencyKey` 重新发送在运行时返回 `{ status: "in_flight" }`，并在完成后返回 `{ status: "ok" }`。
    - `chat.history` 响应的大小是有限制的，以确保 UI 安全。当转录条目太大时，Gateway 可能会截断长文本字段、省略大量元数据块，并用占位符 (`[chat.history omitted: message too large]`) 替换过大的消息。
    - 助理/生成的图像作为托管媒体引用保留，并通过经过认证的 Gateway 媒体 URL 提供服务，因此重新加载不依赖于保留在聊天历史记录响应中的原始 base64 图像有效负载。
    - `chat.history` 还从可见助手文本中剥离仅显示的内联指令标签（例如 `[[reply_to_*]]` 和 `[[audio_as_voice]]`）、纯文本工具调用 XML 有效负载（包括 `<tool_call>...</tool_call>`、 `<function_call>...</function_call>`、`<tool_calls>...</tool_calls>`、`<function_calls>...</function_calls>` 和截断的工具调用块），并泄漏 ASCII/全角模型控制token，并省略其整个可见文本仅是确切的静默token `NO_REPLY` 的辅助条目/`no_reply`。
    - 在主动发送和最终历史记录刷新期间，如果 `chat.history` 短暂返回较旧的快照，聊天视图将保持本地乐观用户/助理消息可见；一旦 Gateway 历史记录赶上，规范记录就会替换这些本地消息。
    - `chat.inject` 将辅助注释附加到会话记录中，并广播 `chat` 事件，仅用于 UI 更新（无智能体运行，无通道传送）。
    - 聊天头模型和思考选择器通过 `sessions.patch` 立即修补活动会话；它们是持久会话覆盖，而不是仅一回合的发送选项。
    - 聊天模型选择器请求 Gateway 的配置模型视图。如果存在 `agents.defaults.models` ，则该允许列表将驱动选择器。否则，选择器会显示显式 `models.providers.*.models` 条目以及具有可用认证的提供商。通过调试 `models.list` RPC 和 `view: "all"` ，完整目录保持可用。
    - 当新的 Gateway 会话使用报告显示高上下文压力时，聊天编辑器区域会显示上下文通知，并在建议的压缩级别上显示一个运行正常会话压缩路径的压缩按钮。过时的token快照将被隐藏，直到 Gateway 再次报告新的使用情况。

  </Accordion>
  <Accordion title="Talk mode (browser realtime)">
    通话模式使用注册的实时语音提供商。使用 `talk.provider: "openai"` 加上 `talk.providers.openai.apiKey` 配置 OpenAI，或使用 `talk.provider: "google"` 加上 `talk.providers.google.apiKey` 配置 Google；语音呼叫实时提供商配置仍然可以重复使用作为后备。浏览器永远不会收到标准提供商 API 密钥。 OpenAI 接收 WebRTC 的临时实时客户端密钥。 Google Live 接收浏览器 WebSocket 会话的一次性受限 Live API 认证token，指令和工具声明由 Gateway 锁定到token中。仅公开后端实时桥的提供商通过 Gateway 中继传输运行，因此凭证和供应商套接字保留在服务器端，而浏览器音频通过经过认证的 Gateway RPC 移动。实时会话提示由 Gateway 组装； `talk.realtime.session` 不接受调用者提供的指令覆盖。

    在聊天编辑器中，“谈话”控件是麦克风听写按钮旁边的波浪按钮。 Talk 启动时，Composer 状态行显示 `Connecting Talk...`，然后在连接音频时显示 `Talk live`，或者在实时工具调用通过 `chat.send` 查询配置的较大模型时显示 `Asking OpenClaw...`。

    维护者现场烟雾：`OPENAI_API_KEY=... GEMINI_API_KEY=... node --import tsx scripts/dev/realtime-talk-live-smoke.ts` 验证 OpenAI 浏览器 WebRTC SDP 交换、Google Live 约束token浏览器 WebSocket 设置以及带有假麦克风媒体的 Gateway 中继浏览器适配器。该命令仅打印提供商状态，不记录机密。

  </Accordion>
  <Accordion title="Stop and abort">
    - 单击 **停止**（调用 `chat.abort`）。
    - 当运行处于活动状态时，正常的后续队列。单击排队消息上的 **Steer**，将该后续消息注入到正在运行的转弯中。
    - 输入 `/stop` （或独立中止短语，如 `stop`、`stop action`、`stop run`、`stop openclaw`、`please stop`）以在带外中止。
    - `chat.abort` 支持 `{ sessionKey }`（无 `runId`）来中止该会话的所有活动运行。

  </Accordion>
  <Accordion title="Abort partial retention">
    - 当运行中止时，部分辅助文本仍可以显示在 UI 中。
    - 当缓冲输出存在时，Gateway 将中止的部分助理文本保留到转录历史记录中。
    - 持久条目包括中止元数据，因此转录使用者可以区分中止部分和正常完成输出。

  </Accordion>
</AccordionGroup>

## PWA 安装和网络推送

Control UI 附带了 `manifest.webmanifest` 和一个服务工作线程，因此现代浏览器可以将其安装为独立的 PWA。即使选项卡或浏览器窗口未打开，Web 推送也可以让 Gateway 通过通知唤醒已安装的 PWA。

|表面|它有什么作用 |
| ---------------------------------------------------------------- | ------------------------------------------------------------------ |
| `ui/public/manifest.webmanifest` | `ui/public/manifest.webmanifest` PWA 清单。一旦可以访问，浏览器就会提供“安装应用”。   |
| `ui/public/sw.js` |处理 `push` 事件和通知点击的 Service Worker。 |
| `push/vapid-keys.json`（在 OpenClaw 状态目录下）|自动生成的 VAPID 密钥对用于签署 Web 推送有效负载。       |
| `push/web-push-subscriptions.json` |持久浏览器订阅端点。                          |

当你想要固定密钥（用于多主机部署、机密轮换或测试）时，通过 Gateway 进程上的环境变量覆盖 VAPID 密钥对：

- `OPENCLAW_VAPID_PUBLIC_KEY`
- `OPENCLAW_VAPID_PRIVATE_KEY`
- `OPENCLAW_VAPID_SUBJECT`（默认为 `mailto:openclaw@localhost`）

Control UI 使用这些作用域门控 Gateway 方法来注册和测试浏览器订阅：

- `push.web.vapidPublicKey` — 获取活动的 VAPID 公钥。
- `push.web.subscribe` — 注册 `endpoint` 加上 `keys.p256dh`/`keys.auth`。
- `push.web.unsubscribe` — 删除已注册的端点。
- `push.web.test` — 向调用者的订阅发送测试通知。

<Note>
Web 推送独立于 iOS APNS 中继路径（有关中继支持的推送，请参阅[配置](/gateway/configuration)）和现有的 `push.test` 方法，其目标是本机移动配对。
</Note>

## 托管嵌入

助理消息可以使用 `[embed ...]` 短代码呈现内联的托管 Web 内容。 iframe 沙箱策略由 `gateway.controlUi.embedSandbox` 控制：

<Tabs>
  <Tab title="strict">
    禁用托管嵌入内的脚本执行。
  </Tab>
  <Tab title="scripts (default)">
    允许交互式嵌入，同时保持源隔离；这是默认设置，通常对于独立的浏览器游戏/小部件来说就足够了。
  </Tab>
  <Tab title="trusted">
    对于有意需要更强权限的同站点文档，在 `allow-scripts` 之上添加 `allow-same-origin`。
  </Tab>
</Tabs>

示例：

```json5
{
  gateway: {
    controlUi: {
      embedSandbox: "scripts",
    },
  },
}
```

<Warning>
仅当嵌入文档确实需要同源行为时才使用 `trusted`。对于大多数智能体生成的游戏和交互式画布，`scripts` 是更安全的选择。
</Warning>

默认情况下，绝对外部 `http(s)` 嵌入 URL 保持阻止状态。如果你有意希望`[embed url="https://..."]`加载第三方页面，请设置`gateway.controlUi.allowExternalEmbedUrls: true`。

## Tailnet 访问（推荐）

<Tabs>
  <Tab title="Integrated Tailscale Serve (preferred)">
    保持 Gateway 处于环回状态，并让 Tailscale 使用 HTTPS 提供智能体服务：

    ```bash
    openclaw gateway --tailscale serve
    ```

    打开：

    - `https://<magicdns>/` （或你配置的 `gateway.controlUi.basePath`）

    默认情况下，当 `gateway.auth.allowTailscale` 为 `true` 时，Control UI/WebSocket 服务请求可以通过 Tailscale 身份标头 (`tailscale-user-login`) 进行认证。 OpenClaw 通过使用 `tailscale whois` 解析 `x-forwarded-for` 地址并将其与标头匹配来验证身份，并且仅当请求使用 Tailscale 的 `x-forwarded-*` 标头进行环回时才接受这些内容。对于具有浏览器设备身份的 Control UI 操作员会话，此经过验证的服务路径还会跳过设备配对往返；无设备浏览器和节点角色连接仍然遵循正常的设备检查。如果你希望甚至对于服务流量也需要显式共享秘密凭据，请设置 `gateway.auth.allowTailscale: false` 。然后使用 `gateway.auth.mode: "token"` 或 `"password"`。

    对于该异步服务身份路径，同一客户端 IP 和认证范围的失败认证尝试将在速率限制写入之前序列化。因此，来自同一浏览器的并发错误重试可能会在第二个请求上显示 `retry later`，而不是并行出现两个简单的不匹配。

    <Warning>
    无token服务认证假定网关主机是可信的。如果不受信任的本地代码可能在该主机上运行，​​则需要token/密码认证。
    </Warning>

  </Tab>
  <Tab title="Bind to tailnet + token">
    ```bash
    openclaw gateway --bind tailnet --token "$(openssl rand -hex 32)"
    ```

    然后打开：

    - `http://<tailscale-ip>:18789/` （或你配置的 `gateway.controlUi.basePath`）

    将匹配的共享密钥粘贴到 UI 设置中（作为 `connect.params.auth.token` 或 `connect.params.auth.password` 发送）。

  </Tab>
</Tabs>

## 不安全 HTTP

如果你通过普通 HTTP （`http://<lan-ip>` 或 `http://<tailscale-ip>`）打开仪表板，浏览器将在 **非安全上下文** 中运行并阻止 WebCrypto。默认情况下，OpenClaw **阻止** Control UI 无设备标识的连接。

记录的异常：

- 仅本地主机不安全 HTTP 与 `gateway.controlUi.allowInsecureAuth=true` 兼容性
- 通过 `gateway.auth.mode: "trusted-proxy"` 成功操作员 Control UI 认证
- 破碎玻璃`gateway.controlUi.dangerouslyDisableDeviceAuth=true`

**建议修复：** 使用 HTTPS (Tailscale Serve) 或在本地打开 UI：

- `https://<magicdns>/`（发球）
- `http://127.0.0.1:18789/`（在网关主机上）

<AccordionGroup>
  <Accordion title="Insecure-auth toggle behavior">
    ```json5
    {
      gateway: {
        controlUi: { allowInsecureAuth: true },
        bind: "tailnet",
        auth: { mode: "token", token: "replace-me" },
      },
    }
    ```

    `allowInsecureAuth` 仅是本地兼容性切换：

    - 它允许本地主机 Control UI 会话在非安全 HTTP 上下文中无需设备身份即可继续进行。
    - 它不会绕过配对检查。
    - 它不会放松远程（非本地主机）设备身份要求。

  </Accordion>
  <Accordion title="Break-glass only">
    ```json5
    {
      gateway: {
        controlUi: { dangerouslyDisableDeviceAuth: true },
        bind: "tailnet",
        auth: { mode: "token", token: "replace-me" },
      },
    }
    ```

    <Warning>
    `dangerouslyDisableDeviceAuth` 禁用 Control UI 设备身份检查，是严重的安全降级。紧急使用后迅速恢复。
    </Warning>

  </Accordion>
  <Accordion title="Trusted-proxy note">
    - 成功的可信智能体认证可以允许没有设备身份的**操作员** Control UI 会话。
    - 这**不会**扩展到节点角色 Control UI 会话。
    - 同主机环回反向智能体仍然不满足可信智能体认证；请参阅[可信智能体认证](/gateway/trusted-proxy-auth)。

  </Accordion>
</AccordionGroup>

请参阅 [Tailscale](/gateway/tailscale) 了解 HTTPS 设置指南。

## 内容安全策略

Control UI 附带严格的 `img-src` 策略：仅允许 **同源** 资产、`data:` URL 和本地生成的 `blob:` URL。远程 `http(s)` 和协议相关图像 URL 会被浏览器拒绝，并且不会发出网络提取。

这在实践中意味着什么：

- 在相对路径（例如 `/avatars/<id>`）下提供的头像和图像仍然呈现，包括 UI 获取并转换为本地 `blob:` URL 的经过认证的头像路由。
- 内联 `data:image/...` URL 仍然呈现（对于协议内负载有用）。
- 由 Control UI 创建的本地 `blob:` URL 仍会呈现。
- 通道元数据发出的远程头像 URL 在 Control UI 的头像助手处被剥离，并替换为内置徽标/徽章，因此受损或恶意通道无法强制从操作员浏览器获取任意远程图像。

你无需更改任何内容即可获得此行为 - 它始终处于开启状态且不可配置。

## 头像路由验证

配置网关认证后，Control UI 头像端点需要与 API 的其余部分相同的网关token：

- `GET /avatar/<agentId>` 仅将头像图像返回给经过认证的调用者。 `GET /avatar/<agentId>?meta=1` 返回相同规则下的头像元数据。
- 对任一路由的未经认证的请求都会被拒绝（与同级助理媒体路由匹配）。这可以防止化身路由泄露受其他保护的主机上的智能体身份。
- Control UI 本身在获取头像时将网关token作为承载标头转发，并使用经过认证的 blob URL，以便图像仍然在仪表板中呈现。

如果禁用网关认证（不建议在共享主机上使用），则头像路由也会变得未经认证，与网关的其余部分一致。

## 构建 UI

Gateway 提供来自 `dist/control-ui` 的静态文件。构建它们：

```bash
pnpm ui:build
```

可选的绝对基数（当你需要固定资产 URL 时）：

```bash
OPENCLAW_CONTROL_UI_BASE_PATH=/openclaw/ pnpm ui:build
```

对于本地开发（单独的开发服务器）：

```bash
pnpm ui:dev
```

然后将 UI 指向 Gateway WS URL (e.g. `ws://127.0.0.1:18789`)。

## 调试/测试：开发服务器+远程Gateway

Control UI 是静态文件； WebSocket 目标是可配置的，并且可以与 HTTP 源不同。当你希望在本地使用 Vite 开发服务器但 Gateway 在其他地方运行时，这很方便。

<Steps>
  <Step title="Start the UI dev server">
    ```bash
    pnpm ui:dev
    ```
  </Step>
  <Step title="Open with gatewayUrl">
    ```text
    http://localhost:5173/?gatewayUrl=ws%3A%2F%2F<gateway-host>%3A18789
    ```

    可选的一次性认证（如果需要）：

    ```text
    http://localhost:5173/?gatewayUrl=wss%3A%2F%2F<gateway-host>%3A18789#token=<gateway-token>
    ```

  </Step>
</Steps>

<AccordionGroup>
  <Accordion title="Notes">
    - `gatewayUrl` 在加载后存储在 localStorage 中，并从 URL 中删除。
    - 如果你通过 `gatewayUrl` 传递完整的 `ws://` 或 `wss://` 端点，则 URL 对 `gatewayUrl` 值进行编码，以便浏览器正确解析查询字符串。
    - `token` 应尽可能通过 URL 片段 (`#token=...`) 传递。分片不会发送到服务器，从而避免了请求日志和Referer泄漏。为了兼容性，旧版 `?token=` 查询参数仍会导入一次，但仅作为后备，并在引导后立即删除。
    - `password` 仅保存在内存中。
    - 设置 `gatewayUrl` 时，UI 不会回退到配置或环境凭据。显式提供 `token` （或 `password`）。缺少显式凭据是一个错误。
    - 当 Gateway 位于 TLS 之后时使用 `wss://`（Tailscale 服务、HTTPS 智能体等）。
    - `gatewayUrl` 仅在顶级窗口（未嵌入）中接受，以防止点击劫持。
    - 非环回 Control UI 部署必须显式设置 `gateway.controlUi.allowedOrigins` （完整来源）。这包括远程开发设置。
    - Gateway 启动可能会从有效的运行时绑定和端口播种本地源，例如 `http://localhost:<port>` 和 `http://127.0.0.1:<port>` ，但远程浏览器源仍然需要显式条目。
    - 除严格控制的本地测试外，请勿使用 `gateway.controlUi.allowedOrigins: ["*"]`。这意味着允许任何浏览器来源，而不是“匹配我正在使用的任何主机”。
    - `gateway.controlUi.dangerouslyAllowHostHeaderOriginFallback=true` 启用主机标头源回退模式，但这是一种危险的安全模式。

  </Accordion>
</AccordionGroup>

示例：

```json5
{
  gateway: {
    controlUi: {
      allowedOrigins: ["http://localhost:5173"],
    },
  },
}
```

远程访问设置详细信息：[远程访问](/gateway/remote)。

## 相关

- [仪表板](/web/dashboard) — 网关仪表板
- [健康检查](/gateway/health) — 网关健康监控
- [TUI](/web/tui) — 终端UI
- [WebChat](/web/webchat) — 基于浏览器的聊天界面
