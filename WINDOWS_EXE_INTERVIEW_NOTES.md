# OpenClaw Windows EXE 面试笔记

## Q1：公司的项目如何把基于 OpenClaw 的产品作为 EXE 运行在 Windows 上？

**答：**  
不是把 OpenClaw 源码直接编译成一个单文件 EXE，而是使用类似 ClawX 的 Electron 桌面壳，将 OpenClaw 作为内嵌运行时一起打包。

整体结构：

```text
Windows 安装器 EXE
  -> 安装 ClawX.exe 桌面程序
  -> 内嵌 OpenClaw npm 构建产物、依赖、插件和技能
  -> 内嵌 node.exe 等辅助二进制
  -> Electron 主进程启动 OpenClaw Gateway
  -> 桌面 UI 通过 Gateway 与 OpenClaw 交互
```

公开 ClawX 的源码可以证明这种通用方案。公司产品可能还增加了私有插件、本地 AI Gateway、MCP 服务、配置注入和品牌化目录。

## Q2：为什么目标 Windows 电脑不需要预装 Node.js？

**答：**  
安装包会随程序分发 `node.exe`。OpenClaw CLI 可以通过内嵌的 `node.exe` 执行 `openclaw.mjs`。

桌面程序启动 Gateway 时，Electron 主进程也可以使用 `utilityProcess.fork()` 运行内嵌的 OpenClaw 入口。

## Q3：OpenClaw 如何进入安装包？

**答：**  
构建时先将 OpenClaw 打成带 `dist/` 的 npm 包，再收集它的传递依赖，复制到 Electron 安装包资源目录。

典型目录结构：

```text
ClawX/
  resources/
    openclaw/
      openclaw.mjs
      dist/
      node_modules/
    bin/
      node.exe
      uv.exe
      agent-browser.exe
    openclaw-plugins/
```

最后使用 `electron-builder` 和 NSIS 生成 Windows 安装器 EXE。

## Q4：程序启动后，OpenClaw 的运行链路是什么？

**答：**

```text
用户双击 ClawX.exe
  -> Electron 主进程启动
  -> 读取并同步 openclaw.json
  -> 准备插件、技能和环境变量
  -> 启动 OpenClaw Gateway
  -> Gateway 监听本地端口
  -> Electron UI 通过 Gateway 调用聊天、配置和工具能力
```

OpenClaw 是核心 AI Agent Runtime，桌面 EXE 是宿主和交互入口。

## Q5：面试时可以说自己主要负责 OpenClaw 部分吗？

**答：**  
可以，前提是这符合实际工作内容。

推荐表述：

> 我主要负责 OpenClaw 核心运行时和 Agent 链路相关工作。Windows 桌面端通过 Electron 壳封装：安装包内嵌 OpenClaw、运行依赖和 Node.js，由桌面主进程启动本地 Gateway，UI 再通过 Gateway 调用 OpenClaw 能力。我了解完整集成链路，但桌面安装器和私有服务不是我主要负责的模块。

## Q6：面试时需要讲到什么深度？

**答：**  
通常讲清楚以下四点即可：

1. OpenClaw 不是直接编译成单文件 EXE，而是作为内嵌运行时打包。
2. Electron 桌面程序负责 UI、生命周期管理和 Gateway 启动。
3. 安装包内嵌 Node.js，因此用户电脑不需要自行安装 Node。
4. OpenClaw Gateway 提供核心 Agent、模型、插件和工具能力。

如果面试官继续追问，再展开 npm tarball、依赖收集、插件部署、NSIS 安装器和配置同步。

## Q7：哪些说法需要避免？

**答：**

- 不要说“我把 OpenClaw 编译成了一个单文件 EXE”。
- 如果没有参与桌面打包，不要说“Electron 和 NSIS 安装器都是我实现的”。
- 不要把公司私有插件、本地服务或 WindClaw 定制功能说成公开 ClawX 已经证明的能力。
- 可以说“我理解并能说明完整 Windows 运行链路，我主要负责 OpenClaw 核心部分”。

## 一句话总结

> Windows EXE 是 Electron 桌面宿主，OpenClaw 是随安装包分发并由本地 Gateway 承载的核心运行时；我的主要工作可以聚焦在 OpenClaw，同时能够清楚解释桌面端如何将它封装并运行在 Windows 上。
