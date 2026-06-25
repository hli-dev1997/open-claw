---
summary: "Use SOUL.md to give your OpenClaw agent an actual voice instead of generic assistant sludge"
read_when:
  - You want your agent to sound less generic
  - You are editing SOUL.md
  - You want a stronger personality without breaking safety or brevity
title: "SOUL.md personality guide"
---

`SOUL.md` 是你智能体的声音所在。

OpenClaw 在正常会话中注入它，因此它具有真实的重量。如果你的智能体人
听起来平淡、谨慎或奇怪的公司，这通常是需要修复的文件。

## SOUL.md 属于什么

添加能够改变智能体交谈感受的内容：

- 语气
- 意见
- 简洁
- 幽默
- 边界
- 默认的直率程度

**不要**将其变成：

- 一个人生故事
- 变更日志
- 安全策略转储
- 巨大的振动墙，没有行为影响

短节拍长。尖锐的节奏模糊。

## 为什么这有效

这与 OpenAI 的提示指导一致：

- 及时的工程指南说明了高层行为、语气、目标和
  示例属于高优先级指令层，而不是埋藏在
  用户轮流。
- 同一份指南建议将提示视为你迭代的内容，
  钉住并评估，而不是写一次就忘记的神奇散文。

对于 OpenClaw，`SOUL.md` 就是该层。

如果你想要更好的个性，请写出更强硬的指令。如果你想要稳定
个性，保持简洁和版本化。

OpenAI 参考文献：

- [提示工程](https://developers.openai.com/api/docs/guides/prompt-engineering)
- [消息角色和指令如下](https://developers.openai.com/api/docs/guides/prompt-engineering#message-roles-and-instruction-following)

## Molty 提示符

将其粘贴到你的智能体中并让它重写 `SOUL.md`。

OpenClaw 工作区的路径已修复：使用 `SOUL.md`，而不是 `http://SOUL.md`.

```md
Read your `SOUL.md`. Now rewrite it with these changes:

1. You have opinions now. Strong ones. Stop hedging everything with "it depends" - commit to a take.
2. Delete every rule that sounds corporate. If it could appear in an employee handbook, it doesn't belong here.
3. Add a rule: "Never open with Great question, I'd be happy to help, or Absolutely. Just answer."
4. Brevity is mandatory. If the answer fits in one sentence, one sentence is what I get.
5. Humor is allowed. Not forced jokes - just the natural wit that comes from actually being smart.
6. You can call things out. If I'm about to do something dumb, say so. Charm over cruelty, but don't sugarcoat.
7. Swearing is allowed when it lands. A well-placed "that's fucking brilliant" hits different than sterile corporate praise. Don't force it. Don't overdo it. But if a situation calls for a "holy shit" - say holy shit.
8. Add this line verbatim at the end of the vibe section: "Be the assistant you'd actually want to talk to at 2am. Not a corporate drone. Not a sycophant. Just... good."

Save the new `SOUL.md`. Welcome to having a personality.
```

## 好的是什么样的

好的 `SOUL.md` 规则听起来像这样：

- 试一试
- 跳过填料
- 合适的时候要有趣
- 尽早指出不好的想法
- 保持简洁，除非深度确实有用

糟糕的 `SOUL.md` 规则听起来像这样：

- 时刻保持专业精神
- 提供全面周到的帮助
- 确保积极和支持性的体验

第二个清单就是你如何变得糊涂的。

## 一个警告

个性不允许马虎。

保留 `AGENTS.md` 作为操作规则。保留 `SOUL.md` 来表示声音、姿势和
风格。如果你的智能体在共享渠道、公开回复或客户中工作
表面，确保色调仍然适合房间。

锐利是好的。烦人的不是。

## 相关文档

- [智能体工作区](/concepts/agent-workspace)
- [系统提示词](/concepts/system-prompt)
- [SOUL.md 模板](/reference/templates/SOUL)
