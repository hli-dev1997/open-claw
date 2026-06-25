# 小红书发布 Skill 设计笔记

## 结论

基于当前项目代码和文档，纯 `SKILL.md` 不能保证“必定正确执行”。Skill 的作用是把专用流程写进模型可读取的指导文档；是否触发、是否读取、是否逐步执行，仍然经过模型决策。要做到接近确定性，推荐方案是：

1. 先写一个低自由度的小红书专用 skill，强约束 tab 选择、页面校验、上传、发布确认。
2. 如果还要更稳，把 fragile browser 操作下沉为专用脚本或插件工具，例如 `xhs_publish_draft`，skill 只负责触发该工具。

对应源码证据：

- `src/agents/system-prompt.ts` 的 `buildSkillsSection` 要求模型先扫描 `<available_skills>`，如果一个 skill 明确适用，再读取该 skill 的 `SKILL.md`。
- `src/agents/skills/skill-contract.ts` 只把 skill 的 `name`、`description`、`location` 放进 prompt，正文不是默认全量注入。
- `src/agents/pi-embedded-runner/run/attempt.ts` 在 `toolsAllow` 存在时会把 skills catalog 去掉，所以限制工具的运行方式会导致 skill 不进入 prompt。
- `extensions/browser/src/browser-tool.ts` 的 browser tool 描述要求：登录态浏览器用 `profile="user"`，refs 必须保持在同一 tab，tab 操作优先用 `tabId` 或 label。
- `docs/tools/browser.md` 说明 `user` profile 是 attach 到真实已登录 Chrome，不是 OpenClaw 自己反复启动 Chrome。
- `docs/tools/browser-control.md` 说明 refs 跨导航不稳定，导航、弹窗、表单提交后必须重新 snapshot。
- `extensions/browser/src/browser/routes/existing-session-limits.ts` 说明 existing-session 上传必须使用 `ref` 或 `inputRef`，一次一个文件。

## Skill 放置与识别规则

推荐路径：

```text
skills/xiaohongshu-publisher/SKILL.md
```

原因：

- `docs/tools/skills.md` 说明 workspace skills 优先级最高。
- `docs/tools/creating-skills.md` 说明创建后要新开 session 或重启 gateway，再用 `openclaw skills list` 验证。
- Codex 自己的 `$CODEX_HOME/skills` 不是 OpenClaw 自动加载的 skill root，不适合这个场景。

注意：

- 不要给本次 agent run 设置 `toolsAllow`，否则 `src/agents/pi-embedded-runner/run/attempt.ts` 会剥离 skills catalog。
- `description` 是触发关键，必须包含中文和英文触发词，例如“小红书、Xiaohongshu、creator.xiaohongshu.com、发布图文、上传图文、图文笔记、发布笔记”。

## 完美级 SKILL.md 模板

```markdown
---
name: xiaohongshu-publisher
description: Use when publishing Xiaohongshu/小红书 notes through creator.xiaohongshu.com, especially 发布图文, 上传图文, 图文笔记, 发布笔记, draft creation, logged-in Chrome user browser automation, or Xiaohongshu creator platform workflows.
metadata: {"openclaw":{"requires":{"config":["browser.enabled"]},"os":["win32"]}}
---

# Xiaohongshu Publisher

Use the `browser` tool with `profile="user"` for all Xiaohongshu creator-platform operations.

## Non-Negotiable Rules

1. Do not use `www.xiaohongshu.com/explore` for publishing.
2. Use only tabs whose URL contains `creator.xiaohongshu.com`.
3. Prefer a tab whose URL contains `/publish/publish`; otherwise use `/new/home`.
4. Use `suggestedTargetId`, `tabId`, or an explicit label returned by `action="tabs"` as `targetId`.
5. Do not infer the target from tab order.
6. Snapshot before every page action.
7. After navigation, modal changes, upload, tab switch, form submission, or failed action, snapshot again and use fresh refs.
8. Never click final 发布 unless the user explicitly requested direct publishing.
9. Stop and report exact manual action for QR login, SMS code, captcha, risk control, account selection, native OS file picker, or permission prompts.
10. Never store or repeat passwords, SMS codes, cookies, or session tokens in logs or final replies.

## Input Collection

Before browser work, identify:

- content type: 图文, 视频, 长文, or 播客.
- title source: user-provided, generated from user brief, or existing draft.
- body source: user-provided, generated from user brief, or existing draft.
- media source: local file paths, uploaded attachments, or existing prepared files.
- publish mode: 保存草稿, 停在发布前让用户确认, or 直接发布.

If title/body/media are missing, ask for the missing inputs before opening the browser.

## Browser Attachment

1. Call `browser` with `action="status"` and `profile="user"` only if browser health is uncertain.
2. Call `browser` with `action="tabs"` and `profile="user"` before opening or navigating anything.
3. Reuse an existing `creator.xiaohongshu.com` tab when available.
4. If no creator tab exists, open `https://creator.xiaohongshu.com/new/home` or `https://creator.xiaohongshu.com/publish/publish` with a stable label such as `xhs-publish`.
5. Do not ask the user to close or restart Chrome unless browser status proves attach is impossible.

## Login Flow

1. If a creator tab shows an already logged-in account, continue.
2. If it shows a login page, ask the user to complete login manually in the visible Chrome.
3. If the user explicitly provides account/password in the current turn, fill only the visible username/password fields after snapshot verification, then stop for SMS/QR/captcha/risk control.
4. Do not save credentials. Do not include credentials in logs or replies.
5. After login, call `action="tabs"` and `action="snapshot"` again because tab targets and refs may have changed.

## 图文笔记 Flow

1. Navigate or focus creator publishing page.
2. Snapshot the target tab.
3. If current page is 上传视频, click the top tab named 上传图文. Do not click the center 上传视频 button.
4. Snapshot again and verify the UI is image-note publishing.
5. Prepare media files in the OpenClaw browser uploads directory before upload.
6. For existing-session profile, upload one file at a time using `ref` or `inputRef`.
7. If the upload control is only a visible button that opens a chooser, arm upload first, then click the chooser trigger.
8. After each upload, wait for visible thumbnail/count change, then snapshot again.
9. Fill title and body only after fresh snapshot refs.
10. Verify title, body, media count, and selected topics/tags before publish.
11. If publish mode is 保存草稿, click 暂存离开 or equivalent draft action.
12. If publish mode is 停在发布前, stop at final review and tell the user it is ready.
13. If publish mode is 直接发布, click 发布 only after explicit user authorization and final snapshot verification.

## Video Flow

Use the same target-selection and login rules. For video uploads, remain on 上传视频. Do not switch to 上传图文. Upload one video file from the browser uploads directory, wait for processing completion, fill title/body/topics, then stop before final 发布 unless explicitly authorized.

## Stale Ref Recovery

If a browser action fails because a ref is missing, stale, invisible, covered, or on the wrong tab:

1. Snapshot the same `targetId` again.
2. Find the visible control again.
3. Retry once with the new ref.
4. If it still fails, report the blocker and do not loop.

## Success Criteria

For draft creation:

- correct `creator.xiaohongshu.com` tab used.
- correct content type tab selected.
- media uploaded and visible.
- title/body filled.
- stopped before final 发布 unless direct publish was authorized.

For direct publish:

- all draft criteria passed.
- user explicitly authorized direct publishing.
- final page shows publish success or a clear server-side result.
```

## 需要加日志的关键代码块

本次不改代码。下面是后续如果要定位 skill 是否识别/调用，建议加日志的位置。

### 1. Skill 是否被加载

位置：`src/agents/skills/local-loader.ts`

建议在成功解析 `name`、`description`、`filePath` 后打印 debug 级别日志：

```text
id: agent.skills.loaded
fields: skillName, filePath, source, disableModelInvocation
```

目的：确认 `xiaohongshu-publisher` 的 `SKILL.md` 被扫描并解析成功。

### 2. Skill 是否进入 prompt catalog

位置：`src/agents/skills/workspace.ts`

建议在生成 `skillsForPrompt` 后打印：

```text
id: agent.skills.prompt_catalog
fields: resolvedSkillNames, promptSkillNames, truncated, compact, containsXhsPublisher
```

目的：确认该 skill 没有被 allowlist、metadata gate、prompt size truncation 排除。

### 3. Skill prompt 是否被本次 run 注入

位置：`src/agents/pi-embedded-runner/run/attempt.ts`

当前已有 `agent.prompt.skills`，但只有 `skillsPromptChars`。建议扩展字段：

```text
fields: runId, sessionId, skillsPromptChars, toolsAllow, effectivePromptMode, skillsStrippedByToolsAllow, containsXhsPublisher
```

目的：确认不是因为 `toolsAllow` 导致 skills catalog 被剥离。

### 4. 模型是否读取了 SKILL.md

位置：`src/agents/pi-tools.read.ts` 的 `createOpenClawReadTool`

建议在 read tool 执行时，如果 path 包含 `/skills/xiaohongshu-publisher/SKILL.md`，打印：

```text
id: agent.skills.read
fields: runId/toolCallId, skillName, path
```

目的：这是“skill 被调用”的最直接证据。仅进入 prompt 不等于读取和执行。

### 5. 公司模型是否解析出 browser 工具调用

位置：`src/agents/openai-transport-stream.ts`

当前已有两类关键日志：

- `prompt-json completions request prepared`
- `prompt-json completion parsed text tool call`

建议如需增强，补充：

```text
fields: runId, provider, model, parsedToolName, contentChars
```

目的：确认 prompt-json 兼容层把模型文本里的 `<tool_call>` 解析成了真实工具调用。

### 6. browser 工具是否按 skill 指定参数执行

位置：`extensions/browser/src/browser-tool.ts`

建议在 `execute` 开始处打印：

```text
id: browser.tool.call
fields: action, profile, targetId, targetUrl, url, label, hasRef, hasInputRef
```

注意不要打印标题、正文、账号、密码、cookie、token。

目的：确认是否一直使用 `profile="user"`，是否用了正确 `targetId`。

### 7. tabs 结果是否暴露了正确 creator tab

位置：`extensions/browser/src/browser-tool.actions.ts` 的 `formatAgentTab` 调用链附近，或 `browser-tool.ts` 的 `action="tabs"` 返回前。

建议打印：

```text
id: browser.tabs.result
fields: profile, count, urlsHostOnly, suggestedTargetIds
```

只记录 host/path 摘要，不记录敏感 query。

目的：确认系统看到了 `creator.xiaohongshu.com`，以及模型是否选错了普通 `www.xiaohongshu.com/explore`。

### 8. 上传动作是否满足 existing-session 限制

位置：`extensions/browser/src/browser-tool.ts` 的 `upload` 分支。

建议打印：

```text
id: browser.upload.armed
fields: profile, targetId, pathCount, hasRef, hasInputRef, hasElement
```

目的：定位上传失败是路径不在 uploads 目录，还是缺少 `ref/inputRef`。

## 小红书完整发布主流程

### 阶段 0：配置与运行方式

1. `openclaw.json` 中 browser 使用：
   - `browser.enabled=true`
   - `browser.defaultProfile="user"`
   - `browser.profiles.user.driver="existing-session"`
   - `browser.profiles.user.attachOnly=true`
   - `browser.profiles.user.userDataDir` 指向当前真实 Chrome 用户目录
2. Chrome 中打开 `chrome://inspect/#remote-debugging` 并启用 remote debugging。
3. 保持真实 Chrome 打开。
4. 不重复启动 Google Chrome；OpenClaw 的 `user` profile 是 attach，不负责启动真实 Chrome。

### 阶段 1：用户请求设计

推荐用户这样问：

```text
用小红书发布一篇图文笔记。使用当前已登录 Chrome 的小红书创作服务平台。标题是：... 正文是：... 图片路径是：... 发布模式：停在发布前让我确认。请不要使用 www.xiaohongshu.com/explore，只使用 creator.xiaohongshu.com。
```

如果用户没有给标题/正文/图片，agent 应先补齐输入，不要先开浏览器乱点。

### 阶段 2：获取文案

文案来源优先级：

1. 用户本次消息明确给出的标题和正文。
2. 用户给的草稿文件或附件。
3. 用户给的主题，由模型生成标题和正文。
4. 页面已有草稿内容。

如果需要生成文案，先在浏览器操作前生成并让用户确认；否则后面上传完成再临时改文案，容易引入页面状态错误。

### 阶段 3：准备媒体文件

1. 确认媒体类型：图文图片、视频、封面图。
2. 浏览器上传路径必须在 OpenClaw browser uploads 目录内。
3. 项目源码里 `DEFAULT_UPLOAD_DIR` 来自 `extensions/browser/src/browser/paths.ts`，即 OpenClaw 临时目录下的 `uploads`。
4. 如果用户给的是普通本地路径，需要先让系统把文件准备到 uploads 目录，再调用 browser upload。

### 阶段 4：连接真实 Chrome，不重复启动

1. 调 browser `action="tabs"`、`profile="user"`。
2. 如果 tabs 成功，说明已经 attach 到真实 Chrome。
3. 优先复用已打开的 `creator.xiaohongshu.com` tab。
4. 如果已有 `/publish/publish` tab，使用它。
5. 如果只有 `/new/home`，从首页进入发布入口。
6. 如果没有 creator tab，打开 `https://creator.xiaohongshu.com/new/home`，并设置 label，例如 `xhs-publish`。
7. 不要因为插件设置页 token 报红就判断 browser 不可用，以 browser tool `status/tabs/snapshot` 为准。

### 阶段 5：登录与账号状态

优先使用已有登录态：

1. Snapshot creator tab。
2. 如果看到账号头像、创作者首页、发布按钮，认为已登录。
3. 如果看到登录页、二维码、手机号、验证码，停止并让用户手动登录。

账号密码登录策略：

1. 默认不要让 agent 保存或索要密码。
2. 如果用户明确在当前对话提供账号密码，agent 可以只在当前页面当前表单中填入。
3. 遇到短信验证码、二维码、滑块、风控、人机验证，必须停止让用户手动处理。
4. 登录完成后重新 `tabs` + `snapshot`，不要继续用登录前 refs。

### 阶段 6：进入发布页并选择内容类型

图文：

1. 进入 `https://creator.xiaohongshu.com/publish/publish`。
2. 如果页面默认是 上传视频，点击顶部 tab `上传图文`。
3. 不要点击页面中央的 `上传视频` 按钮。
4. Snapshot 确认出现图片上传区域。

视频：

1. 保持 `上传视频`。
2. 上传视频后等待处理完成。

长文/播客：

1. 点击对应顶部 tab。
2. Snapshot 确认页面类型正确。

### 阶段 7：上传

图文上传：

1. Snapshot 找到图片上传输入或上传按钮 ref。
2. existing-session 下优先使用 `inputRef` 或 `ref`。
3. 一次上传一个文件。
4. 每次上传后等待缩略图或数量变化。
5. 上传完成后 snapshot 确认图片数量。

如果出现 Windows 原生文件选择器：

1. 停止自动流程。
2. 告诉用户手动选择文件。
3. 用户完成后继续 snapshot。

### 阶段 8：填写标题、正文、话题

1. Snapshot 后定位标题输入框和正文输入框。
2. 填标题。
3. 填正文。
4. 如用户给了话题标签，选择/输入话题。
5. 不要随意点“智能标题”或平台推荐功能，除非用户要求。

### 阶段 9：发布前确认

发布前必须检查：

- 当前 URL 是 `creator.xiaohongshu.com`。
- 内容类型正确。
- 图片/视频已上传完成。
- 标题存在。
- 正文存在。
- 没有登录/风控/验证码遮挡。
- 用户是否明确授权直接发布。

默认安全模式：停在发布前，让用户确认。

### 阶段 10：发布或保存草稿

如果用户要求保存草稿：

1. 点击草稿/暂存相关按钮。
2. Snapshot 或页面提示确认保存。

如果用户要求停在发布前：

1. 不点最终发布。
2. 回复用户“已准备好，等待你确认点击发布”。

如果用户明确要求直接发布：

1. 最后 snapshot。
2. 点击发布。
3. 等待成功提示或跳转。
4. 回复成功/失败的明确状态。

## 失败分支

### 选错 tab

症状：browser 操作去了 `www.xiaohongshu.com/explore`。

处理：重新 `action="tabs"`，只选 `creator.xiaohongshu.com`，优先 `/publish/publish`。

### 卡在上传视频页

症状：页面显示 上传视频 和大号 上传视频按钮。

处理：点击顶部 `上传图文` tab，而不是中央按钮。

### refs 失效

症状：missing/stale ref、not visible、covered。

处理：同一个 `targetId` 重新 snapshot，最多重试一次。

### 登录/风控

症状：二维码、短信、滑块、人机验证、账号异常。

处理：停止自动化，要求用户手动完成。

### 上传路径失败

症状：路径不在 uploads 目录或文件不存在。

处理：先把文件准备到 OpenClaw browser uploads 目录，再调用上传。

## 验证清单

1. `openclaw skills list` 能看到 `xiaohongshu-publisher`。
2. gateway 日志出现 `agent.prompt.skills`，且增强日志显示 `containsXhsPublisher=true`。
3. read tool 日志显示读取了 `skills/xiaohongshu-publisher/SKILL.md`。
4. `prompt-json completion parsed text tool call` 显示模型解析出 `browser` 工具调用。
5. browser 日志显示 `profile=user`。
6. browser tabs 日志显示选择的是 `creator.xiaohongshu.com`。
7. browser action 日志显示没有反复创建 Chrome，只是在已有 user profile tabs 上操作。
8. 发布流程默认停在最终发布前，除非用户明确授权直接发布。

