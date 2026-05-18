# 沙箱文件安全 — 完整 Call Sequence 分析

> **源码版本**: openclaw v2026.4.30  
> **分析日期**: 2026-05-17  
> **入口文件**: `src/gateway/server-methods/chat.ts`  
> **关联模块**: `src/agents/sandbox/`

---

## 一、五层防御总览

OpenClaw 沙箱文件安全采用**五层纵深防御体系**，从容器创建到每次文件操作，层层校验：

| 层级 | 模块 | 防线作用 |
|------|------|----------|
| 容器层 | Docker (`docker.ts`) | --cap-drop=ALL, --read-only, network=none, no-new-privileges |
| 配置层 | Security Validator (`validate-sandbox-security.ts`) | 阻止危险 bind mount、host 网络、unconfined profile |
| 工具层 | Tool Policy (`tool-policy.ts`) | allow/deny 白名单，默认禁止 browser/canvas/cron |
| 路径层 | FS Bridge (`fs-bridge.ts` + `fs-paths.ts`) | mount 映射表，路径必须在已知 mount 内 |
| 守卫层 | Path Guard (`fs-bridge-path-safety.ts`) | symlink 解析、锚定操作、双重检查 |

---

## 二、Mermaid 时序图

```mermaid
sequenceDiagram
    autonumber
    participant Client
    participant ChatHandler as chat.ts<br/>chat.send
    participant SandboxCtx as context.ts<br/>resolveSandboxContext
    participant Config as config.ts<br/>resolveSandboxConfigForAgent
    participant SecurityVal as validate-sandbox-security.ts<br/>validateSandboxSecurity
    participant Docker as docker.ts<br/>createSandboxContainer
    participant Container as Docker Container
    participant MediaStage as stage-sandbox-media.ts<br/>stageSandboxMedia
    participant FSBridge as fs-bridge.ts<br/>SandboxFsBridgeImpl
    participant FSPaths as fs-paths.ts<br/>resolveSandboxFsPathWithMounts
    participant PathGuard as fs-bridge-path-safety.ts<br/>SandboxFsPathGuard
    participant Agent as Agent (容器内)

    Note over Client,Container: ═══ 阶段一：会话初始化 & 容器创建 ═══

    Client->>ChatHandler: POST chat.send (sessionKey, message)

    ChatHandler->>SandboxCtx: resolveSandboxRuntimeStatus(sessionKey)
    SandboxCtx->>Config: resolveSandboxConfigForAgent(cfg, agentId)
    Note over Config: workspaceAccess 决定 ro/rw/none<br/>scope 决定 session/agent/shared

    Config->>Config: resolveSandboxScope()
    Config->>Config: resolveSandboxDockerConfig()
    Note over Config: 合并 agent/global 配置<br/>默认: capDrop=ALL, network=none<br/>readOnlyRoot=true

    Config->>Config: resolveSandboxToolPolicyForAgent()
    Note over Config: 默认 allow: exec/read/write/edit…<br/>默认 deny: browser/canvas/nodes/cron…

    Config-->>SandboxCtx: SandboxConfig

    SandboxCtx->>SandboxCtx: ensureSandboxWorkspaceLayout()
    Note over SandboxCtx: 1. 解析 workspace 路径<br/>2. scope=shared→共享目录<br/>   scope=session→独立目录<br/>3. workspaceAccess≠rw→创建隔离副本+同步 skills

    SandboxCtx->>Docker: requireSandboxBackendFactory("docker")
    Docker->>Docker: createDockerSandboxBackend()
    Docker->>Docker: ensureSandboxContainer()

    Docker->>Docker: createSandboxContainer()
    Docker->>Docker: buildSandboxCreateArgs()

    Docker->>SecurityVal: validateSandboxSecurity()
    Note over SecurityVal: ★ 运行时安全校验

    SecurityVal->>SecurityVal: validateBindMounts()
    Note over SecurityVal: 1. String-only check: 拒绝非绝对路径<br/>2. 拒绝 blocked 路径 (/etc/proc/sys/dev…)<br/>3. 拒绝 reserved 容器目标 (/workspace/agent)<br/>4. 通过已有祖先解析规范化路径<br/>5. 对规范化路径再次执行 blocked/allowed 检查

    SecurityVal->>SecurityVal: validateNetworkMode()
    Note over SecurityVal: 拒绝 host 网络<br/>拒绝 container:* 命名空间加入

    SecurityVal->>SecurityVal: validateSeccompProfile / ApparmorProfile
    Note over SecurityVal: 拒绝 "unconfined"

    SecurityVal-->>Docker: ✅ 安全校验通过

    Docker->>Docker: appendWorkspaceMountArgs()
    Note over Docker: workspaceAccess≠rw → ro,z 只读挂载<br/>workspaceAccess=none → 仅挂载隔离目录<br/>workspaceAccess=rw → rw,z 读写挂载

    Docker->>Docker: execDocker(["create", "--read-only",<br/>"--cap-drop=ALL", "--network=none",<br/>"--security-opt=no-new-privileges", …])

    Docker->>Container: docker start <container>

    SandboxCtx->>FSBridge: createSandboxFsBridge(sandbox)
    FSBridge->>FSPaths: buildSandboxFsMounts()
    Note over FSPaths: 构建 mount 映射表:<br/>workspace → /workspace<br/>agent → /agent<br/>+ 用户自定义 binds

    FSBridge->>PathGuard: new SandboxFsPathGuard(mounts, runCommand)

    SandboxCtx-->>ChatHandler: SandboxContext (含 fsBridge)

    Note over Client,Agent: ═══ 阶段二：附件媒体暂存（有附件时） ═══

    ChatHandler->>ChatHandler: prestageMediaPathOffloads()
    ChatHandler->>ChatHandler: ensureSandboxWorkspaceForSession()

    ChatHandler->>ChatHandler: 超限检查: size > 5MB → 4xx 拒绝

    ChatHandler->>MediaStage: stageSandboxMedia()
    MediaStage->>MediaStage: isAllowedSourcePath()
    Note over MediaStage: assertSandboxPath:<br/>源文件必须在 media 目录内

    MediaStage->>MediaStage: copyFileWithinRoot()
    Note over MediaStage: maxBytes=5MB 限制<br/>copy 到 sandbox workspace/media/inbound/

    MediaStage->>MediaStage: rewriteStagedMediaPaths()
    Note over MediaStage: 将宿主绝对路径<br/>替换为沙箱相对路径<br/>如 media/inbound/foo.pdf

    MediaStage-->>ChatHandler: { staged: Map, paths, workspaceDir }

    ChatHandler->>ChatHandler: 完整性校验: 所有源文件必须进入 staged Map
    Note over ChatHandler: 缺失 → MediaOffloadError (5xx)

    Note over Client,Agent: ═══ 阶段三：运行时文件写操作 ═══

    Agent->>FSBridge: writeFile({ filePath: "/workspace/output.txt", data })

    FSBridge->>FSPaths: resolveSandboxFsPathWithMounts()
    Note over FSPaths: ★ 路径解析:<br/>1. 绝对路径 → 在 mount 表中查找 containerPath<br/>2. 相对路径 → 解析为宿主路径再反向查找<br/>3. 无匹配 mount → throw "Path escapes sandbox root"

    FSPaths-->>FSBridge: SandboxResolvedFsPath { hostPath, containerPath, writable }

    FSBridge->>FSBridge: ensureWriteAccess()
    Note over FSBridge: workspaceAccess≠"rw" 或<br/>mount.writable=false → throw "read-only"

    FSBridge->>PathGuard: assertPathSafety(target, { action:"write", requireWritable:true })

    PathGuard->>PathGuard: openBoundaryWithinRequiredMount()
    Note over PathGuard: ★ 词法挂载边界检查:<br/>1. resolveRequiredMount()<br/>   不在任何 mount → throw "escapes allowed mounts"<br/>2. openBoundaryFile(hostPath, mount.hostRoot)<br/>   验证宿主编 fd 位于 mount 根内

    PathGuard->>PathGuard: assertGuardedPathSafety()
    PathGuard->>Container: ★ 规范路径解析 (防 symlink 逃逸)
    Note over PathGuard,Container: docker exec sh -c<br/>"set -eu; readlink -f"

    Container-->>PathGuard: canonical path

    PathGuard->>PathGuard: 以规范路径重新 resolveRequiredMount()
    Note over PathGuard: 再次确认规范路径仍在允许的 mount 内

    PathGuard->>PathGuard: mount.writable? → 否 → throw "read-only"

    PathGuard-->>FSBridge: ✅ 路径安全

    FSBridge->>PathGuard: resolveAnchoredPinnedEntry()
    Note over PathGuard: ★ 锚定操作:<br/>1. resolveCanonicalContainerPath(父目录)<br/>2. resolveRequiredMount(规范父目录)<br/>3. finalizePinnedEntry:<br/>   计算相对路径, 验证不以 .. 开头

    FSBridge->>FSBridge: runCheckedCommand()
    Note over FSBridge: ★ 终态双重检查:<br/>1. assertPathChecks() ← 执行前再次检查<br/>2. (如有 recheckBeforeCommand) 再检查一次<br/>3. runCommand() → docker exec 执行写操作

    FSBridge->>Container: docker exec sh -c<br/>"cat > /workspace/output.txt"

    Container-->>FSBridge: ✅ 写入成功
    FSBridge-->>Agent: ✅ 文件已写入
```

---

## 三、源码映射表（按流程图执行步骤编号）

### 阶段一：会话初始化 & 容器创建

| 步骤 | 文件路径 | 方法/位置 | 核心简述 |
|------|----------|-----------|----------|
| 1-2 | `src/gateway/server-methods/chat.ts:2307` | `chat.send` handler | 接收客户端请求，在 respond() 前完成沙箱初始化和媒体暂存 |
| 3 | `src/agents/sandbox/context.ts:112` | `resolveSandboxSession()` | 检查 runtime status 是否 sandboxed，未启用则直接返回 null |
| 4 | `src/agents/sandbox/config.ts:221` | `resolveSandboxConfigForAgent()` | 合并 agent/global 配置：mode/backend/scope/workspaceAccess/Docker/工具策略 |
| 5 | `src/agents/sandbox/config.ts:83` | `resolveSandboxDockerConfig()` | 合并 Docker 配置并注入安全默认值：capDrop=["ALL"]、network="none"、readOnlyRoot=true |
| 6 | `src/agents/sandbox/tool-policy.ts:211` | `resolveSandboxToolPolicyForAgent()` | 构建工具 allow/deny 列表，agent 级覆盖 global，默认禁止 browser/canvas/cron 等 |
| 7 | `src/agents/sandbox/context.ts:24` | `ensureSandboxWorkspaceLayout()` | 根据 scope 计算隔离目录路径，workspaceAccess≠rw 时创建沙箱独立副本并同步 skills 文件 |
| 8 | `src/agents/sandbox/context.ts:159` | `requireSandboxBackendFactory()` | 从注册表获取沙箱后端工厂函数（docker/ssh），未注册则抛错 |
| 9 | `src/agents/sandbox/docker.ts:553` | `ensureSandboxContainer()` | 检查容器是否存在、config hash 是否匹配（不匹配且非热容器则销毁重建） |
| 10 | `src/agents/sandbox/docker.ts:499` | `createSandboxContainer()` | 拉取 Docker 镜像、build docker create 参数、启动容器、执行 setupCommand |
| 11 | `src/agents/sandbox/docker.ts:373` | `buildSandboxCreateArgs()` | 组装完整 docker create 参数：labels、--read-only、--tmpfs、--network、--cap-drop 等 |
| 12 | `src/agents/sandbox/validate-sandbox-security.ts:404` | `validateSandboxSecurity()` | **安全总闸**：串联调用 bind mount / network mode / seccomp / apparmor 四项校验 |
| 13 | `src/agents/sandbox/validate-sandbox-security.ts:307` | `validateBindMounts()` | 对每个 bind 执行双重检查：string-only 路径过滤 + 通过已有祖先规范化路径后再次检查 |
| 14 | `src/agents/sandbox/validate-sandbox-security.ts:359` | `validateNetworkMode()` | 拦截 host 网络模式和 container:* 命名空间加入，防止绕过网络隔离 |
| 15 | `src/agents/sandbox/validate-sandbox-security.ts:384` | `validateSeccompProfile()` | 拦截 unconfined seccomp/apparmor profile，禁用系统调用过滤和强制访问控制 |
| 16 | `src/agents/sandbox/workspace-mounts.ts:14` | `appendWorkspaceMountArgs()` | 按 workspaceAccess 生成挂载参数：≠rw→ro,z 只读、=none→仅隔离目录、=rw→读写 |
| 17 | `src/agents/sandbox/context.ts:237-239` | `createSandboxFsBridge()` | 根据 SandboxContext 创建 SandboxFsBridgeImpl 实例 |
| 18 | `src/agents/sandbox/fs-bridge.ts:33` | `SandboxFsBridgeImpl` constructor | 构建 mount 映射表（workspace/agent/binds）、实例化 SandboxFsPathGuard |
| 19 | `src/agents/sandbox/fs-paths.ts:61` | `buildSandboxFsMounts()` | 组装三类 mount：workspace、agent、用户自定义 bind，按 containerRoot 长度降序排列 |

### 阶段二：附件媒体暂存

| 步骤 | 文件路径 | 方法/位置 | 核心简述 |
|------|----------|-----------|----------|
| 20 | `src/gateway/server-methods/chat.ts:1069` | `prestageMediaPathOffloads()` | 在 chat.send 返回 accepted 前同步执行，确保错误分类（4xx vs 5xx）和重试语义正确 |
| 21 | `src/gateway/server-methods/chat.ts:1104` | 超限检查 (inline) | 文件超过 MEDIA_MAX_BYTES (5MB) 则直接抛出 UnsupportedAttachmentError 作为 4xx 拒绝 |
| 22 | `src/auto-reply/reply/stage-sandbox-media.ts:35` | `stageSandboxMedia()` | 将媒体从宿主 store 复制到 sandbox workspace 的 media/inbound/ 下，最大 5MB |
| 23 | `src/auto-reply/reply/stage-sandbox-media.ts:201` | `isAllowedSourcePath()` | assertSandboxPath 验证源文件路径在 media 目录内，防止从任意宿主路径读取 |
| 24 | `src/auto-reply/reply/stage-sandbox-media.ts:257` | `rewriteStagedMediaPaths()` | 将 ctx.MediaPaths 中的宿主绝对路径全部替换为沙箱相对路径 |
| 25 | `src/gateway/server-methods/chat.ts:1136-1142` | 完整性校验 (inline) | 检查 staged Map 覆盖所有 mediaPathRefs，任何缺失都抛出 MediaOffloadError |

### 阶段三：运行时文件写操作

| 步骤 | 文件路径 | 方法/位置 | 核心简述 |
|------|----------|-----------|----------|
| 26 | `src/agents/sandbox/fs-bridge.ts:74` | `SandboxFsBridgeImpl.writeFile()` | agent 写文件入口：解析路径 → 写权限检查 → 路径安全守卫 → 容器内执行 |
| 27 | `src/agents/sandbox/fs-paths.ts:99` | `resolveSandboxFsPathWithMounts()` | 在 mount 映射表中按绝对/相对路径匹配，无匹配则 throw "Path escapes sandbox root" |
| 28 | `src/agents/sandbox/fs-bridge.ts:274` | `ensureWriteAccess()` | 检查 workspaceAccess==="rw" 且目标 mount.writable，任一不满足即拒绝 |
| 29 | `src/agents/sandbox/fs-bridge-path-safety.ts:62` | `SandboxFsPathGuard.assertPathSafety()` | 路径安全检查入口，依次调用词法检查 + 规范路径检查 |
| 30 | `src/agents/sandbox/fs-bridge-path-safety.ts:143` | `openBoundaryWithinRequiredMount()` | 词法层：按 containerPath 找对应 mount → 宿主编 openBoundaryFile 验证 fd 在 hostRoot 内 |
| 31 | `src/agents/sandbox/fs-bridge-path-safety.ts:110` | `assertGuardedPathSafety()` | 规范路径层：若词法通过但 fd 失败且为目录则放宽；否则进入 readlink 解析 |
| 32 | `src/agents/sandbox/fs-bridge-path-safety.ts:248` | `resolveCanonicalContainerPath()` | 在容器内执行 `readlink -f` 解析符号链接真实路径，防止 symlink 逃逸攻击 |
| 33 | `src/agents/sandbox/fs-bridge-path-safety.ts:198` | `resolveAnchoredPinnedEntry()` | 对规范父目录执行 resolveRequiredMount → finalizePinnedEntry 验证不以 `..` 开头 |
| 34 | `src/agents/sandbox/fs-bridge.ts:252` | `runCheckedCommand()` | 执行前再次 assertPathChecks 终态确认（支持 recheckBeforeCommand 二次检查） |
| 35 | `src/agents/sandbox/docker-backend.ts:91` | `runDockerSandboxShellCommand()` | 组装 `docker exec -i <container> sh -c "<script>"` 在容器内执行实际文件写入 |

---

## 四、关键安全防线（面试回答框架）

一次文件写操作依次穿透的七道安全检查：

1. **容器创建时** (`validateSandboxSecurity`) → 阻止危险配置（敏感路径 bind、host 网络、unconfined seccomp）进入容器
2. **路径解析时** (`resolveSandboxFsPathWithMounts`) → 路径必须在已知 mount 映射表内，无匹配直接抛错
3. **写权限检查时** (`ensureWriteAccess`) → workspaceAccess + mount.writable 双重校验，只读 mount 拒绝写入
4. **词法路径检查时** (`openBoundaryWithinRequiredMount`) → 容器路径 + 宿主编路径双重边界验证，确保 fd 在挂载根内
5. **规范路径检查时** (`resolveCanonicalContainerPath`) → 容器内 `readlink -f` 消除 symlink，防止符号链接逃逸
6. **锚定操作时** (`resolveAnchoredPinnedEntry`) → 规范父目录 + 相对路径防 `..` 穿越
7. **执行前终态检查** (`runCheckedCommand`) → assertPathChecks 再次确认后 Docker exec 执行

---

## 五、关键文件索引

| 文件 | 职责 |
|------|------|
| `src/gateway/server-methods/chat.ts` | chat.send 入口，prestageMediaPathOffloads 媒体暂存 |
| `src/agents/sandbox/context.ts` | resolveSandboxContext, ensureSandboxWorkspaceForSession |
| `src/agents/sandbox/config.ts` | resolveSandboxConfigForAgent, resolveSandboxDockerConfig |
| `src/agents/sandbox/validate-sandbox-security.ts` | validateBindMounts, validateNetworkMode, validateSandboxSecurity |
| `src/agents/sandbox/tool-policy.ts` | resolveSandboxToolPolicyForAgent, isToolAllowed |
| `src/agents/sandbox/workspace-mounts.ts` | appendWorkspaceMountArgs (ro,z / rw,z 挂载参数) |
| `src/agents/sandbox/workspace.ts` | ensureSandboxWorkspace (目录创建 + 种子文件) |
| `src/agents/sandbox/docker.ts` | ensureSandboxContainer, createSandboxContainer, buildSandboxCreateArgs |
| `src/agents/sandbox/docker-backend.ts` | createDockerSandboxBackend, runDockerSandboxShellCommand |
| `src/agents/sandbox/fs-bridge.ts` | SandboxFsBridgeImpl (writeFile, readFile, remove, rename, stat) |
| `src/agents/sandbox/fs-paths.ts` | buildSandboxFsMounts, resolveSandboxFsPathWithMounts |
| `src/agents/sandbox/fs-bridge-path-safety.ts` | SandboxFsPathGuard (assertPathSafety, resolveCanonicalContainerPath) |
| `src/agents/sandbox/backend.ts` | requireSandboxBackendFactory, registerSandboxBackend |
| `src/agents/sandbox/shared.ts` | resolveSandboxScopeKey, resolveSandboxWorkspaceDir |
| `src/agents/sandbox/constants.ts` | DEFAULT_TOOL_ALLOW, DEFAULT_TOOL_DENY, 默认镜像/路径常量 |
| `src/auto-reply/reply/stage-sandbox-media.ts` | stageSandboxMedia, isAllowedSourcePath, rewriteStagedMediaPaths |
