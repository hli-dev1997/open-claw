import fs from "node:fs";
import path from "node:path";
import { CURRENT_SESSION_VERSION, SessionManager } from "@mariozechner/pi-coding-agent";
import { resolveSendableOutboundReplyParts } from "openclaw/plugin-sdk/reply-payload";
import { resolveAgentWorkspaceDir, resolveSessionAgentId } from "../../agents/agent-scope.js";
import { rewriteTranscriptEntriesInSessionFile } from "../../agents/pi-embedded-runner/transcript-rewrite.js";
import { ensureSandboxWorkspaceForSession } from "../../agents/sandbox/context.js";
import { resolveAgentTimeoutMs } from "../../agents/timeout.js";
import { dispatchInboundMessage } from "../../auto-reply/dispatch.js";
import type { ReplyPayload } from "../../auto-reply/reply-payload.js";
import { createReplyDispatcher } from "../../auto-reply/reply/reply-dispatcher.js";
import { stageSandboxMedia } from "../../auto-reply/reply/stage-sandbox-media.js";
import type { MsgContext, TemplateContext } from "../../auto-reply/templating.js";
import { extractCanvasFromText } from "../../chat/canvas-render.js";
import { resolveSessionFilePath } from "../../config/sessions.js";
import type { OpenClawConfig } from "../../config/types.openclaw.js";
import { formatErrorMessage } from "../../infra/errors.js";
import { jsonUtf8Bytes } from "../../infra/json-utf8-bytes.js";
import { normalizeReplyPayloadsForDelivery } from "../../infra/outbound/payloads.js";
import { getSessionBindingService } from "../../infra/outbound/session-binding-service.js";
import { logLargePayload } from "../../logging/diagnostic-payload.js";
import {
  appendLocalMediaParentRoots,
  getAgentScopedMediaLocalRoots,
} from "../../media/local-roots.js";
import { isAudioFileName } from "../../media/mime.js";
import type { PromptImageOrderEntry } from "../../media/prompt-image-order.js";
import {
  deleteMediaBuffer,
  MEDIA_MAX_BYTES,
  type SavedMedia,
  saveMediaBuffer,
} from "../../media/store.js";
import { createChannelReplyPipeline } from "../../plugin-sdk/channel-reply-pipeline.js";
import { isPluginOwnedSessionBindingRecord } from "../../plugins/conversation-binding.js";
import { normalizeInputProvenance, type InputProvenance } from "../../sessions/input-provenance.js";
import { resolveSendPolicy } from "../../sessions/send-policy.js";
import { parseAgentSessionKey } from "../../sessions/session-key-utils.js";
import { emitSessionTranscriptUpdate } from "../../sessions/transcript-events.js";
import {
  stripInlineDirectiveTagsForDisplay,
  sanitizeReplyDirectiveId,
} from "../../utils/directive-tags.js";
import {
  INTERNAL_MESSAGE_CHANNEL,
  isGatewayCliClient,
  isWebchatClient,
  normalizeMessageChannel,
} from "../../utils/message-channel.js";
import {
  abortChatRunById,
  type ChatAbortControllerEntry,
  type ChatAbortOps,
  isChatStopCommandText,
  registerChatAbortController,
} from "../chat-abort.js";
import {
  type ChatImageContent,
  MediaOffloadError,
  type OffloadedRef,
  parseMessageWithAttachments,
  resolveChatAttachmentMaxBytes,
  UnsupportedAttachmentError,
} from "../chat-attachments.js";
import {
  isToolHistoryBlockType,
  projectChatDisplayMessage,
  projectRecentChatDisplayMessages,
  resolveEffectiveChatHistoryMaxChars,
} from "../chat-display-projection.js";
import { stripEnvelopeFromMessage } from "../chat-sanitize.js";
import { augmentChatHistoryWithCliSessionImports } from "../cli-session-history.js";
import { isSuppressedControlReplyText } from "../control-reply-text.js";
import {
  attachManagedOutgoingImagesToMessage,
  cleanupManagedOutgoingImageRecords,
  createManagedOutgoingImageBlocks,
} from "../managed-image-attachments.js";
import { ADMIN_SCOPE } from "../method-scopes.js";
import {
  GATEWAY_CLIENT_CAPS,
  GATEWAY_CLIENT_MODES,
  GATEWAY_CLIENT_NAMES,
  hasGatewayClientCap,
} from "../protocol/client-info.js";
import {
  ErrorCodes,
  errorShape,
  formatValidationErrors,
  validateChatAbortParams,
  validateChatHistoryParams,
  validateChatInjectParams,
  validateChatSendParams,
} from "../protocol/index.js";
import { CHAT_SEND_SESSION_KEY_MAX_LENGTH } from "../protocol/schema/primitives.js";
import { getMaxChatHistoryMessagesBytes } from "../server-constants.js";
import {
  capArrayByJsonBytes,
  loadSessionEntry,
  resolveGatewayModelSupportsImages,
  resolveGatewaySessionThinkingDefault,
  resolveDeletedAgentIdFromSessionKey,
  readRecentSessionMessages,
  resolveSessionModelRef,
} from "../session-utils.js";
import { formatForLog } from "../ws-log.js";
import { injectTimestamp, timestampOptsFromConfig } from "./agent-timestamp.js";
import { setGatewayDedupeEntry } from "./agent-wait-dedupe.js";
import { normalizeRpcAttachmentsToChatAttachments } from "./attachment-normalize.js";
import { appendInjectedAssistantMessageToTranscript } from "./chat-transcript-inject.js";
import {
  buildWebchatAssistantMessageFromReplyPayloads,
  buildWebchatAudioContentBlocksFromReplyPayloads,
} from "./chat-webchat-media.js";
import type {
  GatewayRequestContext,
  GatewayRequestHandlerOptions,
  GatewayRequestHandlers,
} from "./types.js";

type TranscriptAppendResult = {
  ok: boolean;
  messageId?: string;
  message?: Record<string, unknown>;
  error?: string;
};

type AbortOrigin = "rpc" | "stop-command";

type AbortedPartialSnapshot = {
  runId: string;
  sessionId: string;
  text: string;
  abortOrigin: AbortOrigin;
};

type ChatAbortRequester = {
  connId?: string;
  deviceId?: string;
  isAdmin: boolean;
};

/**
 * 🏷️ 【模块分类】: 回复载荷媒体识别 (Reply Payload Media Detection)
 * 💡 【核心职责】: 判断一条回复是否携带可发送的媒体引用，用于后续 transcript 和 WebChat 分支。
 * ☕ 【Java 视角】: 类似在 DTO 上做媒体字段判定的 Predicate<ReplyPayload>。
 *
 * True when a reply payload carries at least one media reference (mediaUrl or mediaUrls).
 * [中文]: 当回复载荷至少携带一个媒体引用（mediaUrl 或 mediaUrls）时返回 true。
 *
 * @param payload 单条回复载荷；可能包含文本、媒体、语音或控制字段。
 */
function isMediaBearingPayload(payload: ReplyPayload): boolean {
  if (payload.isReasoning === true) {
    return false;
  }
  if (payload.mediaUrl?.trim()) {
    return true;
  }
  if (payload.mediaUrls?.some((url) => url.trim())) {
    return true;
  }
  return false;
}

/**
 * 🏷️ 【模块分类】: TTS 补充载荷识别 (TTS Supplement Detection)
 * 💡 【核心职责】: 判断回复是否是带语音文本和媒体的 TTS 补充消息。
 * ☕ 【Java 视角】: 类似对语音附件 DTO 做组合条件校验的业务 Predicate。
 *
 * @param payload 单条回复载荷；可能包含文本、媒体、语音或控制字段。
 */
function isTtsSupplementPayload(payload: ReplyPayload): boolean {
  return (
    typeof payload.spokenText === "string" &&
    payload.spokenText.trim().length > 0 &&
    isMediaBearingPayload(payload)
  );
}

/**
 * 🏷️ 【模块分类】: TTS 显示文本清洗 (TTS Display Text Sanitization)
 * 💡 【核心职责】: 对 TTS 补充媒体移除可见文本，避免语音工具摘要重复出现在聊天正文。
 * ☕ 【Java 视角】: 类似复制不可变响应对象并清空展示字段的 DTO Mapper。
 *
 * @param payload 单条回复载荷；可能包含文本、媒体、语音或控制字段。
 */
function stripVisibleTextFromTtsSupplement(payload: ReplyPayload): ReplyPayload {
  return isTtsSupplementPayload(payload) ? { ...payload, text: undefined } : payload;
}

/**
 * 🏷️ 【模块分类】: WebChat 媒体消息构建 (WebChat Media Message Builder)
 * 💡 【核心职责】: 把回复载荷转换为 WebChat 可展示、可写入 transcript 的媒体内容块。
 * ☕ 【Java 视角】: 类似异步组装响应 ViewModel 的 CompletableFuture 工厂方法。
 *
 * @param payloads 回复载荷数组；按发送顺序处理文本、媒体和工具结果。
 * @param options 可选构建参数；包含本地媒体根目录和本地音频访问失败回调。
 */
async function buildWebchatAssistantMediaMessage(
  payloads: ReplyPayload[],
  options?: {
    localRoots?: readonly string[];
    onLocalAudioAccessDenied?: (message: string) => void;
  },
): Promise<{ content: Array<Record<string, unknown>>; transcriptText: string } | null> {
  return buildWebchatAssistantMessageFromReplyPayloads(payloads, {
    localRoots: options?.localRoots,
    onLocalAudioAccessDenied: (err) => {
      options?.onLocalAudioAccessDenied?.(formatForLog(err));
    },
  });
}

export {
  DEFAULT_CHAT_HISTORY_TEXT_MAX_CHARS,
  resolveEffectiveChatHistoryMaxChars,
  sanitizeChatHistoryMessages,
} from "../chat-display-projection.js";

// 🏷️ 【模块分类】: 历史消息大小限制 (History Message Budget)
// 💡 【核心职责】: 限制单条 chat.history 消息的最大 JSON 字节数，防止单条记录撑爆响应。
// ☕ 【Java 视角】: 类似 Controller 层返回分页数据时的单项 payload 上限常量。
export const CHAT_HISTORY_MAX_SINGLE_MESSAGE_BYTES = 128 * 1024;
// 🏷️ 【模块分类】: 历史消息占位文本 (History Placeholder Text)
// 💡 【核心职责】: 为超大历史消息提供安全占位内容，保留角色和时间戳但丢弃大 payload。
// ☕ 【Java 视角】: 类似返回脱敏/截断占位 DTO 的固定提示文案。
const CHAT_HISTORY_OVERSIZED_PLACEHOLDER = "[chat.history omitted: message too large]";
// 🏷️ 【模块分类】: 托管出站图片路由 (Managed Outgoing Image Routing)
// 💡 【核心职责】: 标识 Gateway 托管图片 URL 前缀，便于历史记录清理和展示过滤。
// ☕ 【Java 视角】: 类似 Spring MVC 静态资源/下载接口的路径前缀常量。
const MANAGED_OUTGOING_IMAGE_PATH_PREFIX = "/api/chat/media/outgoing/";
// 🏷️ 【模块分类】: 历史占位统计计数器 (History Placeholder Counter)
// 💡 【核心职责】: 统计本进程内 chat.history 被占位替换的消息数量，用于诊断日志。
// ☕ 【Java 视角】: 类似服务内存中的 AtomicLong 诊断计数器。
let chatHistoryPlaceholderEmitCount = 0;
// 🏷️ 【模块分类】: 历史图片清理去重状态 (Managed Image Cleanup State)
// 💡 【核心职责】: 记录每个 session 正在运行的图片清理 Promise，避免重复清理任务并发执行。
// ☕ 【Java 视角】: 类似 ConcurrentHashMap<String, CompletableFuture<Void>> 的任务去重表。
const chatHistoryManagedImageCleanupState = new Map<string, Promise<void>>();
// 🏷️ 【模块分类】: 会话作用域识别 (Session Scope Classification)
// 💡 【核心职责】: 定义不应该天然继承外部消息投递路由的通用会话 scope。
// ☕ 【Java 视角】: 类似 Set<String> 白名单，用于路由策略判断。
const CHANNEL_AGNOSTIC_SESSION_SCOPES = new Set([
  "main",
  "direct",
  "dm",
  "group",
  "channel",
  "cron",
  "run",
  "subagent",
  "acp",
  "thread",
  "topic",
]);
// 🏷️ 【模块分类】: 渠道会话形态识别 (Channel Session Shape Classification)
// 💡 【核心职责】: 定义明确属于渠道对话的 session 形态，用于判断能否继承外部投递路由。
// ☕ 【Java 视角】: 类似路由策略中的枚举集合 EnumSet。
const CHANNEL_SCOPED_SESSION_SHAPES = new Set(["direct", "dm", "group", "channel"]);

type ChatSendDeliveryEntry = {
  deliveryContext?: {
    channel?: string;
    to?: string;
    accountId?: string;
    threadId?: string | number;
  };
  origin?: {
    provider?: string;
    accountId?: string;
    threadId?: string | number;
  };
  lastChannel?: string;
  lastTo?: string;
  lastAccountId?: string;
  lastThreadId?: string | number;
};

type ChatSendOriginatingRoute = {
  originatingChannel: string;
  originatingTo?: string;
  accountId?: string;
  messageThreadId?: string | number;
  explicitDeliverRoute: boolean;
};

type ChatSendExplicitOrigin = {
  originatingChannel?: string;
  originatingTo?: string;
  accountId?: string;
  messageThreadId?: string;
};

type SideResultPayload = {
  kind: "btw";
  runId: string;
  sessionKey: string;
  question: string;
  text: string;
  isError?: boolean;
  ts: number;
};

/**
 * 🏷️ 【模块分类】: Transcript 回复文本序列化 (Transcript Reply Serialization)
 * 💡 【核心职责】: 把可发送回复载荷压平成 transcript 中可持久化的文本和媒体标记。
 * ☕ 【Java 视角】: 类似把多个响应 DTO 序列化为审计日志字符串。
 *
 * @param payloads 回复载荷数组；按发送顺序处理文本、媒体和工具结果。
 */
function buildTranscriptReplyText(payloads: ReplyPayload[]): string {
  const chunks = payloads
    .map((payload) => {
      if (payload.isReasoning === true) {
        return "";
      }
      const parts = resolveSendableOutboundReplyParts(payload);
      const lines: string[] = [];
      const replyToId = sanitizeReplyDirectiveId(payload.replyToId);
      if (replyToId) {
        lines.push(`[[reply_to:${replyToId}]]`);
      } else if (payload.replyToCurrent) {
        lines.push("[[reply_to_current]]");
      }
      const text = payload.text?.trim();
      if (text && !isSuppressedControlReplyText(text)) {
        lines.push(text);
      }
      for (const mediaUrl of parts.mediaUrls) {
        if (payload.sensitiveMedia === true) {
          continue;
        }
        const trimmed = mediaUrl.trim();
        if (trimmed) {
          lines.push(`MEDIA:${trimmed}`);
        }
      }
      if (payload.audioAsVoice && parts.mediaUrls.some((mediaUrl) => isAudioFileName(mediaUrl))) {
        lines.push("[[audio_as_voice]]");
      }
      return lines.join("\n").trim();
    })
    .filter(Boolean);
  return chunks.join("\n\n").trim();
}

/**
 * 🏷️ 【模块分类】: 敏感媒体检测 (Sensitive Media Detection)
 * 💡 【核心职责】: 检测回复载荷中是否存在需要避免持久化/广播的敏感媒体。
 * ☕ 【Java 视角】: 类似在响应列表上执行合规过滤前的 anyMatch 检查。
 *
 * @param payloads 回复载荷数组；按发送顺序处理文本、媒体和工具结果。
 */
function hasSensitiveMediaPayload(payloads: ReplyPayload[]): boolean {
  return payloads.some(
    (payload) => payload.sensitiveMedia === true && isMediaBearingPayload(payload),
  );
}

type AssistantDisplayContentBlock = Record<string, unknown>;

/**
 * 🏷️ 【模块分类】: Assistant 展示文本清洗 (Assistant Display Text Sanitization)
 * 💡 【核心职责】: 去掉消息 envelope 和内联指令标签，只保留 UI 可展示文本。
 * ☕ 【Java 视角】: 类似服务端返回前的响应文案 Sanitizer。
 *
 * @param value 待规范化或检测的输入值。
 */
function sanitizeAssistantDisplayText(value?: string | null): string | undefined {
  if (!value) {
    return undefined;
  }
  const withoutEnvelope = stripEnvelopeFromMessage(value);
  const normalized = typeof withoutEnvelope === "string" ? withoutEnvelope : value;
  const stripped = stripInlineDirectiveTagsForDisplay(normalized).text.trim();
  return stripped || undefined;
}

/**
 * 🏷️ 【模块分类】: Assistant 内容文本提取 (Assistant Content Text Extraction)
 * 💡 【核心职责】: 从结构化 content blocks 中提取 text 块并拼接为展示文本。
 * ☕ 【Java 视角】: 类似从 List<Map<String,Object>> 中抽取文本字段的 Adapter。
 *
 * @param content assistant 结构化内容块数组；可能包含 text、image、audio 等 block。
 */
function extractAssistantDisplayTextFromContent(
  content?: readonly AssistantDisplayContentBlock[] | null,
): string | undefined {
  if (!Array.isArray(content) || content.length === 0) {
    return undefined;
  }
  const parts = content
    .map((block) => {
      if (block?.type !== "text" || typeof block.text !== "string") {
        return "";
      }
      return block.text.trim();
    })
    .filter(Boolean);
  return parts.length > 0 ? parts.join("\n\n") : undefined;
}

/**
 * 🏷️ 【模块分类】: Assistant 展示内容构建 (Assistant Display Content Builder)
 * 💡 【核心职责】: 将回复载荷转换为 WebChat 可展示的文本、音频和托管图片内容块。
 * ☕ 【Java 视角】: 类似异步聚合多种附件资源并返回 ViewModel 列表的服务方法。
 *
 * @param params 参数对象；包含 sessionKey、payloads、媒体根目录和错误回调。
 */
async function buildAssistantDisplayContentFromReplyPayloads(params: {
  sessionKey: string;
  payloads: ReplyPayload[];
  managedImageLocalRoots?: Parameters<typeof createManagedOutgoingImageBlocks>[0]["localRoots"];
  includeSensitiveMedia?: boolean;
  onLocalAudioAccessDenied?: (message: string) => void;
  onManagedImagePrepareError?: (message: string) => void;
}): Promise<AssistantDisplayContentBlock[] | undefined> {
  const rawTextPayloadCount = params.payloads.filter(
    (payload) =>
      payload.isReasoning !== true &&
      typeof payload.text === "string" &&
      payload.text.trim().length > 0,
  ).length;
  const normalized = normalizeReplyPayloadsForDelivery(params.payloads);
  if (normalized.length === 0) {
    return rawTextPayloadCount > 0 ? [{ type: "text", text: "" }] : undefined;
  }

  const content: AssistantDisplayContentBlock[] = [];
  let strippedTextPayloadCount = 0;
  for (const payload of normalized) {
    const text = sanitizeAssistantDisplayText(payload.text);
    if (text) {
      content.push({ type: "text", text });
    } else if (typeof payload.text === "string" && payload.text.trim().length > 0) {
      strippedTextPayloadCount += 1;
    }
    if (params.includeSensitiveMedia === false && payload.sensitiveMedia === true) {
      continue;
    }
    const audioBlocks = await buildWebchatAudioContentBlocksFromReplyPayloads([payload], {
      localRoots: Array.isArray(params.managedImageLocalRoots)
        ? params.managedImageLocalRoots
        : undefined,
      onLocalAudioAccessDenied: (err) => {
        params.onLocalAudioAccessDenied?.(formatForLog(err));
      },
    });
    content.push(...audioBlocks);

    const mediaUrls = Array.from(
      new Set([
        ...(Array.isArray(payload.mediaUrls) ? payload.mediaUrls : []),
        ...(typeof payload.mediaUrl === "string" ? [payload.mediaUrl] : []),
      ]),
    );
    const imageBlocks = await createManagedOutgoingImageBlocks({
      sessionKey: params.sessionKey,
      mediaUrls,
      localRoots: params.managedImageLocalRoots,
      continueOnPrepareError: true,
      onPrepareError: (error) => {
        params.onManagedImagePrepareError?.(error.message);
      },
    });
    if (imageBlocks.length > 0) {
      content.push(...imageBlocks);
    }
  }

  if (content.length > 0) {
    return content;
  }
  return strippedTextPayloadCount > 0 ? [{ type: "text", text: "" }] : undefined;
}

/**
 * 🏷️ 【模块分类】: Transcript 文本块对齐 (Transcript Text Block Alignment)
 * 💡 【核心职责】: 用 transcript 媒体消息中的文本块替换展示内容里的对应文本块，保证持久化内容一致。
 * ☕ 【Java 视角】: 类似合并两个响应模型时按类型替换 List 元素。
 *
 * @param content 当前准备展示或广播的 assistant 内容块。
 * @param transcriptMediaMessage 已生成的 transcript 媒体消息；其 text 块优先作为持久化文本来源。
 */
function replaceAssistantContentTextBlocks(
  content: readonly AssistantDisplayContentBlock[] | undefined,
  transcriptMediaMessage: { content: Array<Record<string, unknown>> } | null,
): AssistantDisplayContentBlock[] | undefined {
  const transcriptTextBlocks = (transcriptMediaMessage?.content ?? []).filter(
    (block): block is AssistantDisplayContentBlock =>
      Boolean(block) &&
      typeof block === "object" &&
      block.type === "text" &&
      typeof block.text === "string",
  );
  if (transcriptTextBlocks.length === 0) {
    return content ? [...content] : undefined;
  }
  if (!content || content.length === 0) {
    return [...transcriptTextBlocks];
  }
  const merged: AssistantDisplayContentBlock[] = [];
  let transcriptTextIndex = 0;
  for (const block of content) {
    if (
      block?.type === "text" &&
      typeof block.text === "string" &&
      transcriptTextIndex < transcriptTextBlocks.length
    ) {
      merged.push(transcriptTextBlocks[transcriptTextIndex++]);
      continue;
    }
    merged.push(block);
  }
  if (transcriptTextIndex < transcriptTextBlocks.length) {
    merged.unshift(...transcriptTextBlocks.slice(transcriptTextIndex));
  }
  return merged;
}

/**
 * 🏷️ 【模块分类】: 托管图片 URL 判定 (Managed Image URL Detection)
 * 💡 【核心职责】: 判断一个 URL 是否指向 Gateway 管理的出站图片接口。
 * ☕ 【Java 视角】: 类似 URI 解析后检查 path 前缀的工具方法。
 *
 * @param value 待规范化或检测的输入值。
 */
function isManagedOutgoingImageUrl(value: unknown): boolean {
  if (typeof value !== "string" || !value.trim()) {
    return false;
  }
  try {
    const parsed = new URL(value, "http://localhost");
    return parsed.pathname.startsWith(MANAGED_OUTGOING_IMAGE_PATH_PREFIX);
  } catch {
    return false;
  }
}

/**
 * 🏷️ 【模块分类】: 托管图片内容剥离 (Managed Image Content Stripping)
 * 💡 【核心职责】: 在 fallback 场景中移除不能直接持久化的托管图片块。
 * ☕ 【Java 视角】: 类似对响应 List 进行 filter，排除临时资源引用。
 *
 * @param content assistant 结构化内容块数组；可能包含 text、image、audio 等 block。
 */
function stripManagedOutgoingAssistantContentBlocks(
  content: readonly AssistantDisplayContentBlock[] | undefined,
): AssistantDisplayContentBlock[] | undefined {
  if (!content || content.length === 0) {
    return undefined;
  }
  const filtered = content.filter((block) => {
    if (block?.type !== "image") {
      return true;
    }
    return !(isManagedOutgoingImageUrl(block.url) || isManagedOutgoingImageUrl(block.openUrl));
  });
  return filtered.length > 0 ? filtered : undefined;
}

/**
 * 🏷️ 【模块分类】: Assistant 展示文本聚合 (Assistant Display Text Aggregation)
 * 💡 【核心职责】: 从 assistant 内容块中聚合纯文本，作为 transcript 或 fallback 文本。
 * ☕ 【Java 视角】: 类似 Stream.map/filter/joining 生成展示摘要。
 *
 * @param content assistant 结构化内容块数组；可能包含 text、image、audio 等 block。
 */
function extractAssistantDisplayText(
  content: readonly AssistantDisplayContentBlock[] | undefined,
): string | undefined {
  if (!content || content.length === 0) {
    return undefined;
  }
  const text = content
    .map((block) => (block?.type === "text" && typeof block.text === "string" ? block.text : ""))
    .filter(Boolean)
    .join("\n\n")
    .trim();
  return text || undefined;
}

/**
 * 🏷️ 【模块分类】: Assistant 媒体内容检测 (Assistant Media Content Detection)
 * 💡 【核心职责】: 判断内容块中是否包含非文本媒体，用于决定持久化和广播形态。
 * ☕ 【Java 视角】: 类似检查响应 blocks 中是否存在附件类型。
 *
 * @param content assistant 结构化内容块数组；可能包含 text、image、audio 等 block。
 */
function hasAssistantDisplayMediaContent(
  content: readonly AssistantDisplayContentBlock[] | undefined,
): boolean {
  return Boolean(content?.some((block) => block?.type !== "text"));
}

/**
 * 🏷️ 【模块分类】: 历史图片清理调度 (History Image Cleanup Scheduler)
 * 💡 【核心职责】: 针对 session 去重调度托管出站图片清理任务。
 * ☕ 【Java 视角】: 类似用 ConcurrentHashMap 防重的异步清理任务调度器。
 *
 * @param params 参数对象；包含 sessionKey 和日志上下文。
 */
function scheduleChatHistoryManagedImageCleanup(params: {
  sessionKey: string;
  context: Pick<GatewayRequestContext, "logGateway">;
}) {
  if (chatHistoryManagedImageCleanupState.has(params.sessionKey)) {
    return;
  }
  const pending = cleanupManagedOutgoingImageRecords({ sessionKey: params.sessionKey })
    .then(() => undefined)
    .catch((error) => {
      params.context.logGateway.debug(
        `chat.history managed image cleanup skipped sessionKey=${JSON.stringify(params.sessionKey)} error=${formatForLog(error)}`,
      );
    })
    .finally(() => {
      if (chatHistoryManagedImageCleanupState.get(params.sessionKey) === pending) {
        chatHistoryManagedImageCleanupState.delete(params.sessionKey);
      }
    });
  chatHistoryManagedImageCleanupState.set(params.sessionKey, pending);
}

/**
 * 🏷️ 【模块分类】: chat.send 来源路由解析 (Originating Route Resolution)
 * 💡 【核心职责】: 根据显式来源、session key、客户端类型和历史绑定决定回复是否投递回外部渠道。
 * ☕ 【Java 视角】: 类似 Controller 入参到消息路由上下文的策略解析器。
 *
 * 执行主线:
 * 1. 优先使用 admin 显式传入的 originating route。
 * 2. deliver=false 时强制走内部渠道，不继承外部路由。
 * 3. 从 session entry 和 sessionKey 中推断候选渠道、收件人、账号和线程。
 * 4. 阻止 WebChat 和通用 scope 误继承外部投递路由。
 *
 * @param params 参数对象；包含客户端信息、deliver 标记、session entry、显式来源和 sessionKey。
 */
function resolveChatSendOriginatingRoute(params: {
  client?: { mode?: string | null; id?: string | null } | null;
  deliver?: boolean;
  entry?: ChatSendDeliveryEntry;
  explicitOrigin?: ChatSendExplicitOrigin;
  hasConnectedClient?: boolean;
  mainKey?: string;
  sessionKey: string;
}): ChatSendOriginatingRoute {
  if (params.explicitOrigin?.originatingChannel && params.explicitOrigin.originatingTo) {
    return {
      originatingChannel: params.explicitOrigin.originatingChannel,
      originatingTo: params.explicitOrigin.originatingTo,
      ...(params.explicitOrigin.accountId ? { accountId: params.explicitOrigin.accountId } : {}),
      ...(params.explicitOrigin.messageThreadId
        ? { messageThreadId: params.explicitOrigin.messageThreadId }
        : {}),
      explicitDeliverRoute: params.deliver === true,
    };
  }
  const shouldDeliverExternally = params.deliver === true;
  if (!shouldDeliverExternally) {
    return {
      originatingChannel: INTERNAL_MESSAGE_CHANNEL,
      explicitDeliverRoute: false,
    };
  }

  const routeChannelCandidate = normalizeMessageChannel(
    params.entry?.deliveryContext?.channel ??
      params.entry?.lastChannel ??
      params.entry?.origin?.provider,
  );
  const routeToCandidate = params.entry?.deliveryContext?.to ?? params.entry?.lastTo;
  const routeAccountIdCandidate =
    params.entry?.deliveryContext?.accountId ??
    params.entry?.lastAccountId ??
    params.entry?.origin?.accountId ??
    undefined;
  const routeThreadIdCandidate =
    params.entry?.deliveryContext?.threadId ??
    params.entry?.lastThreadId ??
    params.entry?.origin?.threadId;
  if (params.sessionKey.length > CHAT_SEND_SESSION_KEY_MAX_LENGTH) {
    return {
      originatingChannel: INTERNAL_MESSAGE_CHANNEL,
      explicitDeliverRoute: false,
    };
  }

  const parsedSessionKey = parseAgentSessionKey(params.sessionKey);
  const sessionScopeParts = (parsedSessionKey?.rest ?? params.sessionKey)
    .split(":", 3)
    .filter(Boolean);
  const sessionScopeHead = sessionScopeParts[0];
  const sessionChannelHint = normalizeMessageChannel(sessionScopeHead);
  const normalizedSessionScopeHead = (sessionScopeHead ?? "").trim().toLowerCase();
  const sessionPeerShapeCandidates = [sessionScopeParts[1], sessionScopeParts[2]]
    .map((part) => (part ?? "").trim().toLowerCase())
    .filter(Boolean);
  const isChannelAgnosticSessionScope = CHANNEL_AGNOSTIC_SESSION_SCOPES.has(
    normalizedSessionScopeHead,
  );
  const isChannelScopedSession = sessionPeerShapeCandidates.some((part) =>
    CHANNEL_SCOPED_SESSION_SHAPES.has(part),
  );
  const hasLegacyChannelPeerShape =
    !isChannelScopedSession &&
    typeof sessionScopeParts[1] === "string" &&
    sessionChannelHint === routeChannelCandidate;
  const isFromWebchatClient = isWebchatClient(params.client);
  const isFromGatewayCliClient = isGatewayCliClient(params.client);
  const hasClientMetadata =
    (typeof params.client?.mode === "string" && params.client.mode.trim().length > 0) ||
    (typeof params.client?.id === "string" && params.client.id.trim().length > 0);
  const configuredMainKey = (params.mainKey ?? "main").trim().toLowerCase();
  const isConfiguredMainSessionScope =
    normalizedSessionScopeHead.length > 0 && normalizedSessionScopeHead === configuredMainKey;
  const canInheritConfiguredMainRoute =
    isConfiguredMainSessionScope &&
    params.hasConnectedClient &&
    (isFromGatewayCliClient || !hasClientMetadata);

  // Webchat clients never inherit external delivery routes. Configured-main
  // sessions are stricter than channel-scoped sessions: only CLI callers, or
  // legacy callers with no client metadata, may inherit the last external route.
  // [中文]: WebChat 客户端永远不继承外部投递路由。配置的 main 会话比渠道会话更严格：只有 CLI 调用方，或没有客户端元数据的旧调用方，才能继承上一次外部路由。
  const canInheritDeliverableRoute = Boolean(
    !isFromWebchatClient &&
    sessionChannelHint &&
    sessionChannelHint !== INTERNAL_MESSAGE_CHANNEL &&
    ((!isChannelAgnosticSessionScope && (isChannelScopedSession || hasLegacyChannelPeerShape)) ||
      canInheritConfiguredMainRoute),
  );
  const hasDeliverableRoute =
    canInheritDeliverableRoute &&
    routeChannelCandidate &&
    routeChannelCandidate !== INTERNAL_MESSAGE_CHANNEL &&
    typeof routeToCandidate === "string" &&
    routeToCandidate.trim().length > 0;

  if (!hasDeliverableRoute) {
    return {
      originatingChannel: INTERNAL_MESSAGE_CHANNEL,
      explicitDeliverRoute: false,
    };
  }

  return {
    originatingChannel: routeChannelCandidate,
    originatingTo: routeToCandidate,
    accountId: routeAccountIdCandidate,
    messageThreadId: routeThreadIdCandidate,
    explicitDeliverRoute: true,
  };
}

/**
 * 🏷️ 【模块分类】: ACP 会话识别 (ACP Session Detection)
 * 💡 【核心职责】: 通过 sessionKey 判断会话是否属于 ACP 桥接会话。
 * ☕ 【Java 视角】: 类似按业务 key 片段识别子系统会话类型。
 *
 * @param sessionKey 会话 key；用于定位 session、广播目标和运行状态。
 */
function isAcpSessionKey(sessionKey: string | undefined): boolean {
  return Boolean(sessionKey?.split(":").includes("acp"));
}

/**
 * 🏷️ 【模块分类】: ACP 显式来源绑定检测 (ACP Explicit Origin Binding)
 * 💡 【核心职责】: 根据显式渠道来源查找会话绑定，判断目标是否为 ACP 会话。
 * ☕ 【Java 视角】: 类似从绑定服务查询 ConversationId 到 SessionKey 的映射后做类型判断。
 *
 * @param origin 显式来源路由字段；用于判断外部渠道会话绑定。
 */
function explicitOriginTargetsAcpSession(origin: ChatSendExplicitOrigin | undefined): boolean {
  if (!origin?.originatingChannel || !origin.originatingTo || !origin.accountId) {
    return false;
  }
  const channel = normalizeMessageChannel(origin.originatingChannel);
  if (!channel || channel === INTERNAL_MESSAGE_CHANNEL) {
    return false;
  }
  const binding = getSessionBindingService().resolveByConversation({
    channel,
    accountId: origin.accountId,
    conversationId: origin.originatingTo,
  });
  return isAcpSessionKey(binding?.targetSessionKey);
}

/**
 * 🏷️ 【模块分类】: 插件会话绑定检测 (Plugin Binding Detection)
 * 💡 【核心职责】: 判断显式来源是否指向插件拥有的会话绑定，从而保留插件自己的接收模型语义。
 * ☕ 【Java 视角】: 类似通过绑定仓储查询 ownerType 并判断是否为插件所有。
 *
 * @param origin 显式来源路由字段；用于判断外部渠道会话绑定。
 */
function explicitOriginTargetsPluginBinding(origin: ChatSendExplicitOrigin | undefined): boolean {
  if (!origin?.originatingChannel || !origin.originatingTo || !origin.accountId) {
    return false;
  }
  const channel = normalizeMessageChannel(origin.originatingChannel);
  if (!channel || channel === INTERNAL_MESSAGE_CHANNEL) {
    return false;
  }
  const binding = getSessionBindingService().resolveByConversation({
    channel,
    accountId: origin.accountId,
    conversationId: origin.originatingTo,
  });
  return isPluginOwnedSessionBindingRecord(binding);
}

/**
 * 🏷️ 【模块分类】: 输入控制字符过滤 (Input Control Character Filtering)
 * 💡 【核心职责】: 移除 chat.send 消息中不允许的控制字符，保留 tab、换行和可打印字符。
 * ☕ 【Java 视角】: 类似对请求字符串执行字符级 Sanitizer。
 *
 * @param message 待处理的消息对象或消息文本。
 */
function stripDisallowedChatControlChars(message: string): string {
  let output = "";
  for (const char of message) {
    const code = char.charCodeAt(0);
    if (code === 9 || code === 10 || code === 13 || (code >= 32 && code !== 127)) {
      output += char;
    }
  }
  return output;
}

/**
 * 🏷️ 【模块分类】: chat.send 输入规范化 (Chat Send Input Normalization)
 * 💡 【核心职责】: 对用户输入做 Unicode NFC 规范化、NUL 字节拒绝和控制字符过滤。
 * ☕ 【Java 视角】: 类似 Controller 入参校验器，返回 Either<ValidMessage, Error>。
 *
 * @param message 待处理的消息对象或消息文本。
 */
export function sanitizeChatSendMessageInput(
  message: string,
): { ok: true; message: string } | { ok: false; error: string } {
  const normalized = message.normalize("NFC");
  if (normalized.includes("\u0000")) {
    return { ok: false, error: "message must not contain null bytes" };
  }
  return { ok: true, message: stripDisallowedChatControlChars(normalized) };
}

/**
 * 🏷️ 【模块分类】: 系统来源回执规范化 (System Provenance Receipt Normalization)
 * 💡 【核心职责】: 校验并清洗可选系统来源回执，确保它可以安全注入 agent 输入。
 * ☕ 【Java 视角】: 类似 Optional<String> 的请求字段校验和 trim。
 *
 * @param value 待规范化或检测的输入值。
 */
function normalizeOptionalChatSystemReceipt(
  value: unknown,
): { ok: true; receipt?: string } | { ok: false; error: string } {
  if (value == null) {
    return { ok: true };
  }
  if (typeof value !== "string") {
    return { ok: false, error: "systemProvenanceReceipt must be a string" };
  }
  const sanitized = sanitizeChatSendMessageInput(value);
  if (!sanitized.ok) {
    return sanitized;
  }
  const receipt = sanitized.message.trim();
  return { ok: true, receipt: receipt || undefined };
}

/**
 * 🏷️ 【模块分类】: ACP 桥客户端识别 (ACP Bridge Client Detection)
 * 💡 【核心职责】: 识别来自 CLI ACP 桥的 Gateway 客户端，避免对其重复持久化附件。
 * ☕ 【Java 视角】: 类似基于 client metadata 判断调用方类型的鉴权辅助方法。
 *
 * @param client Gateway 客户端信息；用于权限、设备和连接归属判断。
 */
function isAcpBridgeClient(client: GatewayRequestHandlerOptions["client"]): boolean {
  const info = client?.connect?.client;
  return (
    info?.id === GATEWAY_CLIENT_NAMES.CLI &&
    info?.mode === GATEWAY_CLIENT_MODES.CLI &&
    info?.displayName === "ACP" &&
    info?.version === "acp"
  );
}

/**
 * 🏷️ 【模块分类】: 系统来源注入授权 (System Provenance Authorization)
 * 💡 【核心职责】: 判断客户端是否具备 admin scope，可以注入系统来源和显式路由字段。
 * ☕ 【Java 视角】: 类似检查 SecurityContext 中是否包含 ADMIN 权限。
 *
 * @param client Gateway 客户端信息；用于权限、设备和连接归属判断。
 */
function canInjectSystemProvenance(client: GatewayRequestHandlerOptions["client"]): boolean {
  const scopes = Array.isArray(client?.connect?.scopes) ? client.connect.scopes : [];
  return scopes.includes(ADMIN_SCOPE);
}

/**
 * 🏷️ 【模块分类】: chat.send 图片持久化 (Inbound Image Persistence)
 * 💡 【核心职责】: 将内联图片和 offloaded 图片统一保存为 transcript 可引用的媒体记录。
 * ☕ 【Java 视角】: 类似 MultipartFile 落盘后返回附件元数据列表的异步服务。
 *
 * @param params 参数对象；包含内联图片、图片顺序、offload 引用、客户端和日志器。
 */
async function persistChatSendImages(params: {
  images: ChatImageContent[];
  imageOrder: PromptImageOrderEntry[];
  offloadedRefs: OffloadedRef[];
  client: GatewayRequestHandlerOptions["client"];
  logGateway: GatewayRequestContext["logGateway"];
}): Promise<SavedMedia[]> {
  if (
    (params.images.length === 0 && params.offloadedRefs.length === 0) ||
    isAcpBridgeClient(params.client)
  ) {
    return [];
  }
  const inlineSaved: SavedMedia[] = [];
  for (const img of params.images) {
    try {
      inlineSaved.push(
        await saveMediaBuffer(Buffer.from(img.data, "base64"), img.mimeType, "inbound"),
      );
    } catch (err) {
      params.logGateway.warn(
        `chat.send: failed to persist inbound image (${img.mimeType}): ${formatForLog(err)}`,
      );
    }
  }
  // imageOrder now only tracks image slots (see chat-attachments.ts), so split
  // offloaded refs by mime: image offloads interleave with inline images via
  // imageOrder, and non-image offloads append to the transcript tail. Without
  // this split a non-image file would consume the next image slot whenever
  // both kinds appear in the same request.
  // [中文]: imageOrder 现在只跟踪图片槽位（见 chat-attachments.ts），所以要按 MIME 拆分 offloaded 引用：图片 offload 通过 imageOrder 和内联图片交错排列，非图片 offload 追加到 transcript 尾部。否则同一个请求同时包含两类文件时，非图片文件会错误占用下一个图片槽位。
  const imageOffloadedSaved: SavedMedia[] = [];
  const nonImageOffloadedSaved: SavedMedia[] = [];
  for (const ref of params.offloadedRefs) {
    const entry: SavedMedia = {
      id: ref.id,
      path: ref.path,
      size: 0,
      contentType: ref.mimeType,
    };
    if (ref.mimeType.startsWith("image/")) {
      imageOffloadedSaved.push(entry);
    } else {
      nonImageOffloadedSaved.push(entry);
    }
  }
  if (params.imageOrder.length === 0) {
    return [...inlineSaved, ...imageOffloadedSaved, ...nonImageOffloadedSaved];
  }
  const saved: SavedMedia[] = [];
  let inlineIndex = 0;
  let offloadedIndex = 0;
  for (const entry of params.imageOrder) {
    if (entry === "inline") {
      const inline = inlineSaved[inlineIndex++];
      if (inline) {
        saved.push(inline);
      }
      continue;
    }
    const offloaded = imageOffloadedSaved[offloadedIndex++];
    if (offloaded) {
      saved.push(offloaded);
    }
  }
  for (; inlineIndex < inlineSaved.length; inlineIndex++) {
    const inline = inlineSaved[inlineIndex];
    if (inline) {
      saved.push(inline);
    }
  }
  for (; offloadedIndex < imageOffloadedSaved.length; offloadedIndex++) {
    const offloaded = imageOffloadedSaved[offloadedIndex];
    if (offloaded) {
      saved.push(offloaded);
    }
  }
  for (const offloaded of nonImageOffloadedSaved) {
    saved.push(offloaded);
  }
  return saved;
}

/**
 * 🏷️ 【模块分类】: 用户 Transcript 消息构建 (User Transcript Message Builder)
 * 💡 【核心职责】: 将 chat.send 用户输入和媒体字段组装为 Pi transcript 的 user message。
 * ☕ 【Java 视角】: 类似构建持久化消息实体的 Factory 方法。
 *
 * @param params 参数对象；包含用户消息、已保存媒体和消息时间戳。
 */
function buildChatSendTranscriptMessage(params: {
  message: string;
  savedImages: SavedMedia[];
  timestamp: number;
}) {
  const mediaFields = resolveChatSendTranscriptMediaFields(params.savedImages);
  return {
    role: "user" as const,
    content: params.message,
    timestamp: params.timestamp,
    ...mediaFields,
  };
}

/**
 * 🏷️ 【模块分类】: Offload 媒体标记清理 (Offloaded Media Marker Cleanup)
 * 💡 【核心职责】: 从用户消息尾部移除已经被结构化 offload 处理的媒体标记，避免重复展示。
 * ☕ 【Java 视角】: 类似在保存前清理文本协议尾部标记的字符串工具。
 *
 * @param message 待处理的消息对象或消息文本。
 * @param refs offload 媒体引用列表；用于匹配和清理文本中的媒体标记。
 */
function stripTrailingOffloadedMediaMarkers(message: string, refs: OffloadedRef[]): string {
  if (refs.length === 0) {
    return message;
  }
  const removableRefs = new Set(refs.map((ref) => ref.mediaRef));
  const lines = message.split(/\r?\n/);
  while (lines.length > 0) {
    const last = lines[lines.length - 1]?.trim() ?? "";
    const match = /^\[media attached:\s*(media:\/\/inbound\/[^\]\s]+)\]$/.exec(last);
    if (!match?.[1] || !removableRefs.delete(match[1])) {
      break;
    }
    lines.pop();
  }
  return lines.join("\n").trimEnd();
}

/**
 * 🏷️ 【模块分类】: 沙箱媒体预暂存 (Sandbox Media Pre-Staging)
 * 💡 【核心职责】: 在 chat.send 返回 accepted 前同步把媒体路径放入 agent 沙箱，确保错误分类和重试语义正确。
 * ☕ 【Java 视角】: 类似在 Controller ack 前执行的受控文件 staging 服务，失败时映射为明确 HTTP 4xx/5xx。
 *
 * Stages media-path offloads into the agent sandbox synchronously so chat.send
 * can surface 5xx before respond().
 * [中文]: 同步将媒体路径 offload 暂存到 agent 沙箱中，以便 chat.send 在 respond() 前暴露 5xx 错误。（类似 Java Controller 在返回 ResponseEntity 前完成文件预处理）
 * Throws MediaOffloadError on any staging
 * failure (ENOSPC / EPERM / partial-stage) so the outer chat.send handler can
 * map it to UNAVAILABLE (5xx); plain Error would be misclassified as 4xx.
 * [中文]: 任何暂存失败（ENOSPC、EPERM、partial-stage）都会抛出 MediaOffloadError，让外层 chat.send 处理器映射为 UNAVAILABLE（5xx）；普通 Error 会被误判为 4xx。（类似 Java 中用业务异常区分可重试服务端错误和客户端错误）
 * All offloaded refs are cleaned up from the media store before rethrow.
 * [中文]: 在重新抛出异常前，会从媒体存储中清理所有已 offload 的引用。（类似 finally 中清理临时文件）
 * Callers MUST set ctx.MediaStaged=true when this runs so the dispatch
 * pipeline skips its own stageSandboxMedia pass.
 * [中文]: 调用方运行此函数后必须设置 ctx.MediaStaged=true，使调度管线跳过自身的 stageSandboxMedia 阶段。（类似 Java 流水线中设置上下文标记避免重复执行 Filter）
 *
 * Returned paths are absolute media-store paths when no sandbox is active, or
 * sandbox-relative paths plus `workspaceDir` when sandboxing is active. Host-side
 * media-understanding uses MediaWorkspaceDir to resolve those relative paths.
 * [中文]: 未启用沙箱时返回媒体存储绝对路径；启用沙箱时返回沙箱相对路径和 workspaceDir，宿主侧媒体理解模块通过 MediaWorkspaceDir 解析这些相对路径。（类似 Java 中同时传递相对路径和根目录 Path）
 *
 * 执行主线:
 * 1. 按 includeImageRefs 筛选需要进入 MediaPaths 的 offload 引用。
 * 2. 解析 agent workspace，并为当前 session 准备 sandbox workspace。
 * 3. 未启用 sandbox 时返回媒体存储绝对路径。
 * 4. 启用 sandbox 时先拒绝超过 staging 上限的附件，再调用 stageSandboxMedia。
 * 5. 校验每个源文件都进入 sandbox，失败时清理媒体存储并抛出可分类错误。
 *
 * @param params 参数对象；包含 offloadedRefs、includeImageRefs、配置、sessionKey 和 agentId。
 */
async function prestageMediaPathOffloads(params: {
  offloadedRefs: OffloadedRef[];
  includeImageRefs?: boolean;
  cfg: OpenClawConfig;
  sessionKey: string;
  agentId: string;
}): Promise<{ paths: string[]; types: string[]; workspaceDir?: string }> {
  const mediaPathRefs = params.offloadedRefs.filter(
    (ref) => params.includeImageRefs || !ref.mimeType.startsWith("image/"),
  );
  if (mediaPathRefs.length === 0) {
    return { paths: [], types: [] };
  }

  try {
    const workspaceDir = resolveAgentWorkspaceDir(params.cfg, params.agentId);
    const sandbox = await ensureSandboxWorkspaceForSession({
      config: params.cfg,
      sessionKey: params.sessionKey,
      workspaceDir,
    });
    if (!sandbox) {
      return {
        paths: mediaPathRefs.map((ref) => ref.path),
        types: mediaPathRefs.map((ref) => ref.mimeType),
      };
    }

    // stageSandboxMedia caps each file at STAGED_MEDIA_MAX_BYTES (=
    // MEDIA_MAX_BYTES, 5MB) and silently skips oversized files. The parse cap
    // (resolveChatAttachmentMaxBytes, default 20MB) is higher, so a sandboxed
    // session receiving a file between the two caps would otherwise
    // pass parse, fail staging, and surface as a retryable 5xx even though
    // retry cannot succeed. Reject here as a client-side 4xx instead.
    // [中文]: stageSandboxMedia 将每个文件限制在 STAGED_MEDIA_MAX_BYTES（等于 MEDIA_MAX_BYTES，5MB）内，并静默跳过超大文件。解析上限（resolveChatAttachmentMaxBytes，默认 20MB）更高，所以沙箱会话收到介于两个上限之间的文件时，本来会解析成功、暂存失败，并表现为可重试的 5xx；但重试无法成功，因此这里直接作为客户端 4xx 拒绝。
    const oversizedForSandbox = mediaPathRefs.filter((ref) => ref.sizeBytes > MEDIA_MAX_BYTES);
    if (oversizedForSandbox.length > 0) {
      const details = oversizedForSandbox
        .map((ref) => `${ref.label} (${ref.sizeBytes} bytes)`)
        .join(", ");
      throw new UnsupportedAttachmentError(
        "non-image-too-large-for-sandbox",
        `attachments exceed sandbox staging limit (${MEDIA_MAX_BYTES} bytes): ${details}`,
      );
    }

    const stagingCtx: MsgContext = {
      MediaPath: mediaPathRefs[0].path,
      MediaPaths: mediaPathRefs.map((ref) => ref.path),
      MediaType: mediaPathRefs[0].mimeType,
      MediaTypes: mediaPathRefs.map((ref) => ref.mimeType),
    };
    const stageResult = await stageSandboxMedia({
      ctx: stagingCtx,
      sessionCtx: stagingCtx as TemplateContext,
      cfg: params.cfg,
      sessionKey: params.sessionKey,
      workspaceDir,
    });

    // stageSandboxMedia silently keeps unstaged entries as their original
    // absolute path, so length parity with `nonImage` does not prove every
    // file landed in the sandbox. The RPC max (20MB via
    // resolveChatAttachmentMaxBytes) admits files above the staging cap
    // (STAGED_MEDIA_MAX_BYTES = 5MB); check the returned `staged` map so any
    // missing source becomes a 5xx MediaOffloadError the client can retry.
    // [中文]: stageSandboxMedia 会静默保留未暂存条目的原始绝对路径，因此长度一致不能证明每个文件都进入了沙箱。RPC 上限（resolveChatAttachmentMaxBytes 的 20MB）允许超过暂存上限（5MB）的文件；这里检查返回的 staged map，让任何缺失源都变成客户端可重试的 5xx MediaOffloadError。（类似 Java 中校验批处理结果 Map 是否覆盖全部输入）
    const stagedSources = stageResult.staged;
    const missing = mediaPathRefs.filter((ref) => !stagedSources.has(ref.path));
    if (missing.length > 0) {
      throw new Error(
        `attachment staging incomplete: ${stagedSources.size}/${mediaPathRefs.length} paths staged into sandbox workspace (missing: ${missing.map((ref) => ref.path).join(", ")})`,
      );
    }
    const stagedPaths = stagingCtx.MediaPaths ?? [];
    const stagedTypes = stagingCtx.MediaTypes ?? mediaPathRefs.map((ref) => ref.mimeType);

    // Keep stagedPaths sandbox-relative (e.g. `media/inbound/foo.pdf`) so the
    // agent inside the container can read them. Host-side media-understanding
    // resolves them via ctx.MediaWorkspaceDir, which we carry separately.
    // [中文]: 保持 stagedPaths 为沙箱相对路径（例如 `media/inbound/foo.pdf`），让容器内 agent 可以读取；宿主侧媒体理解通过单独携带的 ctx.MediaWorkspaceDir 解析它们。（类似 Java 容器任务中传相对路径给容器、传工作目录给宿主服务）
    return { paths: stagedPaths, types: stagedTypes, workspaceDir: sandbox.workspaceDir };
  } catch (err) {
    await Promise.allSettled(
      params.offloadedRefs.map((ref) => deleteMediaBuffer(ref.id, "inbound")),
    );
    if (err instanceof MediaOffloadError) {
      throw err;
    }
    // Sandbox-oversize rejections are client-side 4xx (see check above). Wrapping
    // them as MediaOffloadError would misclassify them as retryable 5xx.
    // [中文]: 沙箱超大文件拒绝属于客户端 4xx（见上面的检查）。如果包装成 MediaOffloadError，就会被误分类为可重试 5xx。
    if (err instanceof UnsupportedAttachmentError) {
      throw err;
    }
    throw new MediaOffloadError(
      `[Gateway Error] Failed to stage attachments into agent workspace: ${formatErrorMessage(err)}`,
      { cause: err },
    );
  }
}

/**
 * 🏷️ 【模块分类】: Transcript 媒体字段解析 (Transcript Media Field Resolution)
 * 💡 【核心职责】: 从已保存媒体记录生成 Pi transcript 兼容的 MediaPath/MediaType 字段。
 * ☕ 【Java 视角】: 类似把附件实体列表映射为消息扩展字段 Map。
 *
 * @param savedImages 已保存媒体记录列表；用于生成 transcript 媒体字段。
 */
function resolveChatSendTranscriptMediaFields(savedImages: SavedMedia[]) {
  const mediaPaths = savedImages.map((entry) => entry.path);
  if (mediaPaths.length === 0) {
    return {};
  }
  const mediaTypes = savedImages.map((entry) => entry.contentType ?? "application/octet-stream");
  return {
    MediaPath: mediaPaths[0],
    MediaPaths: mediaPaths,
    MediaType: mediaTypes[0],
    MediaTypes: mediaTypes,
  };
}

/**
 * 🏷️ 【模块分类】: Transcript 用户文本提取 (Transcript User Text Extraction)
 * 💡 【核心职责】: 从字符串或结构化 content blocks 中提取用户文本，用于匹配待重写消息。
 * ☕ 【Java 视角】: 类似兼容多版本消息 schema 的文本抽取适配器。
 *
 * @param content assistant 结构化内容块数组；可能包含 text、image、audio 等 block。
 */
function extractTranscriptUserText(content: unknown): string | undefined {
  if (typeof content === "string") {
    return content;
  }
  if (!Array.isArray(content)) {
    return undefined;
  }
  const textBlocks = content
    .map((block) =>
      block && typeof block === "object" && "text" in block ? block.text : undefined,
    )
    .filter((text): text is string => typeof text === "string");
  return textBlocks.length > 0 ? textBlocks.join("") : undefined;
}

/**
 * 🏷️ 【模块分类】: 用户回合媒体路径回写 (User Turn Media Path Rewrite)
 * 💡 【核心职责】: 在 agent 写入用户回合后，将实际媒体路径补写回对应 transcript 消息。
 * ☕ 【Java 视角】: 类似事务后置补偿更新，按内容匹配记录并 patch JSONL。
 *
 * @param params 参数对象；包含 transcriptPath、sessionKey、原始消息和已保存媒体。
 */
async function rewriteChatSendUserTurnMediaPaths(params: {
  transcriptPath: string;
  sessionKey: string;
  message: string;
  savedImages: SavedMedia[];
}) {
  const mediaFields = resolveChatSendTranscriptMediaFields(params.savedImages);
  if (!("MediaPath" in mediaFields)) {
    return;
  }
  const sessionManager = SessionManager.open(params.transcriptPath);
  const branch = sessionManager.getBranch();
  const target = [...branch].toReversed().find((entry) => {
    if (entry.type !== "message" || entry.message.role !== "user") {
      return false;
    }
    const existingPaths = Array.isArray((entry.message as { MediaPaths?: unknown }).MediaPaths)
      ? (entry.message as { MediaPaths?: unknown[] }).MediaPaths
      : undefined;
    if (
      (typeof (entry.message as { MediaPath?: unknown }).MediaPath === "string" &&
        (entry.message as { MediaPath?: string }).MediaPath) ||
      (existingPaths && existingPaths.length > 0)
    ) {
      return false;
    }
    return (
      extractTranscriptUserText((entry.message as { content?: unknown }).content) === params.message
    );
  });
  if (!target || target.type !== "message") {
    return;
  }
  const rewrittenMessage = {
    ...target.message,
    ...mediaFields,
  };
  await rewriteTranscriptEntriesInSessionFile({
    sessionFile: params.transcriptPath,
    sessionKey: params.sessionKey,
    request: {
      replacements: [
        {
          entryId: target.id,
          message: rewrittenMessage,
        },
      ],
    },
  });
}

/**
 * 🏷️ 【模块分类】: 历史块文本提取 (History Block Text Extraction)
 * 💡 【核心职责】: 从历史消息的 content/text 字段中抽取文本，用于识别 canvas 预览。
 * ☕ 【Java 视角】: 类似从多态消息对象中提取统一 text 字段。
 *
 * @param message 待处理的消息对象或消息文本。
 */
function extractChatHistoryBlockText(message: unknown): string | undefined {
  if (!message || typeof message !== "object") {
    return undefined;
  }
  const entry = message as Record<string, unknown>;
  if (typeof entry.content === "string") {
    return entry.content;
  }
  if (typeof entry.text === "string") {
    return entry.text;
  }
  if (!Array.isArray(entry.content)) {
    return undefined;
  }
  const textParts = entry.content
    .map((block) => {
      if (!block || typeof block !== "object") {
        return undefined;
      }
      const typed = block as { text?: unknown; type?: unknown };
      return typeof typed.text === "string" ? typed.text : undefined;
    })
    .filter((value): value is string => typeof value === "string");
  return textParts.length > 0 ? textParts.join("\n") : undefined;
}

/**
 * 🏷️ 【模块分类】: Canvas 历史块追加 (Canvas History Block Attachment)
 * 💡 【核心职责】: 将工具生成的 canvas 预览追加到最近可渲染的 assistant 历史消息。
 * ☕ 【Java 视角】: 类似对历史消息 ViewModel 增补富媒体预览块。
 *
 * @param params 参数对象；包含目标消息、canvas 预览和原始文本。
 */
function appendCanvasBlockToAssistantHistoryMessage(params: {
  message: unknown;
  preview: ReturnType<typeof extractCanvasFromText>;
  rawText: string | null;
}): unknown {
  const preview = params.preview;
  if (!preview || !params.message || typeof params.message !== "object") {
    return params.message;
  }
  const entry = params.message as Record<string, unknown>;
  const baseContent = Array.isArray(entry.content)
    ? [...entry.content]
    : typeof entry.content === "string"
      ? [{ type: "text", text: entry.content }]
      : typeof entry.text === "string"
        ? [{ type: "text", text: entry.text }]
        : [];
  const alreadyPresent = baseContent.some((block) => {
    if (!block || typeof block !== "object") {
      return false;
    }
    const typed = block as { type?: unknown; preview?: unknown };
    return (
      typed.type === "canvas" &&
      typed.preview &&
      typeof typed.preview === "object" &&
      (((typed.preview as { viewId?: unknown }).viewId &&
        (typed.preview as { viewId?: unknown }).viewId === preview.viewId) ||
        ((typed.preview as { url?: unknown }).url &&
          (typed.preview as { url?: unknown }).url === preview.url))
    );
  });
  if (!alreadyPresent) {
    baseContent.push({
      type: "canvas",
      preview,
      rawText: params.rawText,
    });
  }
  return {
    ...entry,
    content: baseContent,
  };
}

/**
 * 🏷️ 【模块分类】: 工具历史内容检测 (Tool History Content Detection)
 * 💡 【核心职责】: 判断历史消息是否是工具调用/工具结果，避免把它当普通 assistant 文本展示。
 * ☕ 【Java 视角】: 类似按字段或 block type 判断消息子类型。
 *
 * @param message 待处理的消息对象或消息文本。
 */
function messageContainsToolHistoryContent(message: unknown): boolean {
  if (!message || typeof message !== "object") {
    return false;
  }
  const entry = message as Record<string, unknown>;
  if (
    typeof entry.toolCallId === "string" ||
    typeof entry.tool_call_id === "string" ||
    typeof entry.toolName === "string" ||
    typeof entry.tool_name === "string"
  ) {
    return true;
  }
  if (!Array.isArray(entry.content)) {
    return false;
  }
  return entry.content.some((block) => {
    if (!block || typeof block !== "object") {
      return false;
    }
    return isToolHistoryBlockType((block as { type?: unknown }).type);
  });
}

/**
 * 🏷️ 【模块分类】: Canvas 历史增强 (Canvas History Augmentation)
 * 💡 【核心职责】: 扫描工具历史并把 canvas 预览挂到相邻 assistant 消息，优化 WebChat 展示。
 * ☕ 【Java 视角】: 类似对查询出的消息列表执行服务端 ViewModel enrichment。
 *
 * @param messages 历史消息数组；用于投影、增强或预算裁剪。
 */
export function augmentChatHistoryWithCanvasBlocks(messages: unknown[]): unknown[] {
  if (messages.length === 0) {
    return messages;
  }
  const next = [...messages];
  let changed = false;
  let lastAssistantIndex = -1;
  let lastRenderableAssistantIndex = -1;
  const pending: Array<{
    preview: NonNullable<ReturnType<typeof extractCanvasFromText>>;
    rawText: string | null;
  }> = [];
  for (let index = 0; index < next.length; index++) {
    const message = next[index];
    if (!message || typeof message !== "object") {
      continue;
    }
    const entry = message as Record<string, unknown>;
    const role = typeof entry.role === "string" ? entry.role.toLowerCase() : "";
    if (role === "assistant") {
      lastAssistantIndex = index;
      if (!messageContainsToolHistoryContent(entry)) {
        lastRenderableAssistantIndex = index;
        if (pending.length > 0) {
          let target = next[index];
          for (const item of pending) {
            target = appendCanvasBlockToAssistantHistoryMessage({
              message: target,
              preview: item.preview,
              rawText: item.rawText,
            });
          }
          next[index] = target;
          pending.length = 0;
          changed = true;
        }
      }
      continue;
    }
    if (!messageContainsToolHistoryContent(entry)) {
      continue;
    }
    const toolName =
      typeof entry.toolName === "string"
        ? entry.toolName
        : typeof entry.tool_name === "string"
          ? entry.tool_name
          : undefined;
    const text = extractChatHistoryBlockText(entry);
    const preview = extractCanvasFromText(text, toolName);
    if (!preview) {
      continue;
    }
    pending.push({
      preview,
      rawText: text ?? null,
    });
  }
  if (pending.length > 0) {
    const targetIndex =
      lastRenderableAssistantIndex >= 0 ? lastRenderableAssistantIndex : lastAssistantIndex;
    if (targetIndex >= 0) {
      let target = next[targetIndex];
      for (const item of pending) {
        target = appendCanvasBlockToAssistantHistoryMessage({
          message: target,
          preview: item.preview,
          rawText: item.rawText,
        });
      }
      next[targetIndex] = target;
      changed = true;
    }
  }
  return changed ? next : messages;
}

/**
 * 🏷️ 【模块分类】: 超大历史占位构建 (Oversized History Placeholder Builder)
 * 💡 【核心职责】: 为被截断的超大历史消息生成保留 role/timestamp 的占位消息。
 * ☕ 【Java 视角】: 类似用占位响应对象替换超限实体。
 *
 * @param message 待处理的消息对象或消息文本。
 */
export function buildOversizedHistoryPlaceholder(message?: unknown): Record<string, unknown> {
  const role =
    message &&
    typeof message === "object" &&
    typeof (message as { role?: unknown }).role === "string"
      ? (message as { role: string }).role
      : "assistant";
  const timestamp =
    message &&
    typeof message === "object" &&
    typeof (message as { timestamp?: unknown }).timestamp === "number"
      ? (message as { timestamp: number }).timestamp
      : Date.now();
  return {
    role,
    timestamp,
    content: [{ type: "text", text: CHAT_HISTORY_OVERSIZED_PLACEHOLDER }],
    __openclaw: { truncated: true, reason: "oversized" },
  };
}

/**
 * 🏷️ 【模块分类】: 单条历史预算裁剪 (Per-Message History Budget Enforcement)
 * 💡 【核心职责】: 将超过单条字节上限的历史消息替换为占位消息。
 * ☕ 【Java 视角】: 类似分页响应前按单项大小做截断转换。
 *
 * @param params 参数对象；包含历史消息数组和单条消息字节上限。
 */
export function replaceOversizedChatHistoryMessages(params: {
  messages: unknown[];
  maxSingleMessageBytes: number;
}): { messages: unknown[]; replacedCount: number } {
  const { messages, maxSingleMessageBytes } = params;
  if (messages.length === 0) {
    return { messages, replacedCount: 0 };
  }
  let replacedCount = 0;
  const next = messages.map((message) => {
    if (jsonUtf8Bytes(message) <= maxSingleMessageBytes) {
      return message;
    }
    replacedCount += 1;
    return buildOversizedHistoryPlaceholder(message);
  });
  return { messages: replacedCount > 0 ? next : messages, replacedCount };
}

/**
 * 🏷️ 【模块分类】: chat.history 总预算裁剪 (Final History Budget Enforcement)
 * 💡 【核心职责】: 确保最终返回的 history 数组不超过总字节预算，必要时只保留最后一条或占位。
 * ☕ 【Java 视角】: 类似 API Gateway 响应大小保护器。
 *
 * @param params 参数对象；承载该方法所需的上下文、输入和回调配置。
 */
export function enforceChatHistoryFinalBudget(params: { messages: unknown[]; maxBytes: number }): {
  messages: unknown[];
  placeholderCount: number;
} {
  const { messages, maxBytes } = params;
  if (messages.length === 0) {
    return { messages, placeholderCount: 0 };
  }
  if (jsonUtf8Bytes(messages) <= maxBytes) {
    return { messages, placeholderCount: 0 };
  }
  const last = messages.at(-1);
  if (last && jsonUtf8Bytes([last]) <= maxBytes) {
    return { messages: [last], placeholderCount: 0 };
  }
  const placeholder = buildOversizedHistoryPlaceholder(last);
  if (jsonUtf8Bytes([placeholder]) <= maxBytes) {
    return { messages: [placeholder], placeholderCount: 1 };
  }
  return { messages: [], placeholderCount: 0 };
}

/**
 * 🏷️ 【模块分类】: Transcript 路径解析 (Transcript Path Resolution)
 * 💡 【核心职责】: 根据 sessionId、storePath、sessionFile 和 agentId 定位 Pi transcript 文件。
 * ☕ 【Java 视角】: 类似从业务 id 和配置解析持久化文件 Path。
 *
 * @param params 参数对象；包含 sessionId、storePath、可选 sessionFile 和 agentId。
 */
function resolveTranscriptPath(params: {
  sessionId: string;
  storePath: string | undefined;
  sessionFile?: string;
  agentId?: string;
}): string | null {
  const { sessionId, storePath, sessionFile, agentId } = params;
  if (!storePath && !sessionFile) {
    return null;
  }
  try {
    const sessionsDir = storePath ? path.dirname(storePath) : undefined;
    return resolveSessionFilePath(
      sessionId,
      sessionFile ? { sessionFile } : undefined,
      sessionsDir || agentId ? { sessionsDir, agentId } : undefined,
    );
  } catch {
    return null;
  }
}

/**
 * 🏷️ 【模块分类】: Transcript 文件初始化 (Transcript File Initialization)
 * 💡 【核心职责】: 在需要时创建 transcript JSONL 文件并写入 session header。
 * ☕ 【Java 视角】: 类似 Files.createDirectories + 写入审计日志头记录。
 *
 * @param params 参数对象；承载该方法所需的上下文、输入和回调配置。
 */
function ensureTranscriptFile(params: { transcriptPath: string; sessionId: string }): {
  ok: boolean;
  error?: string;
} {
  if (fs.existsSync(params.transcriptPath)) {
    return { ok: true };
  }
  try {
    fs.mkdirSync(path.dirname(params.transcriptPath), { recursive: true });
    const header = {
      type: "session",
      version: CURRENT_SESSION_VERSION,
      id: params.sessionId,
      timestamp: new Date().toISOString(),
      cwd: process.cwd(),
    };
    fs.writeFileSync(params.transcriptPath, `${JSON.stringify(header)}\n`, {
      encoding: "utf-8",
      mode: 0o600,
    });
    return { ok: true };
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : String(err) };
  }
}

/**
 * 🏷️ 【模块分类】: Transcript 幂等检测 (Transcript Idempotency Detection)
 * 💡 【核心职责】: 扫描 transcript，判断指定幂等 key 是否已经写入。
 * ☕ 【Java 视角】: 类似在追加日志前检查 requestId 去重。
 *
 * @param transcriptPath transcript 文件路径；用于扫描幂等 key 是否已存在。
 * @param idempotencyKey 幂等 key；用于避免重复写入同一条注入消息。
 */
function transcriptHasIdempotencyKey(transcriptPath: string, idempotencyKey: string): boolean {
  try {
    const lines = fs.readFileSync(transcriptPath, "utf-8").split(/\r?\n/);
    for (const line of lines) {
      if (!line.trim()) {
        continue;
      }
      const parsed = JSON.parse(line) as { message?: { idempotencyKey?: unknown } };
      if (parsed?.message?.idempotencyKey === idempotencyKey) {
        return true;
      }
    }
    return false;
  } catch {
    return false;
  }
}

/**
 * 🏷️ 【模块分类】: Assistant Transcript 追加 (Assistant Transcript Append)
 * 💡 【核心职责】: 解析/创建 transcript 后，通过 Pi 安全 API 追加 assistant 消息并支持幂等。
 * ☕ 【Java 视角】: 类似封装 append-only 事件日志写入，带 create-if-missing 和 idempotencyKey。
 *
 * 执行主线:
 * 1. 解析 transcript 文件路径。
 * 2. 必要时创建 transcript 文件头。
 * 3. 如果 idempotencyKey 已存在，则直接返回成功避免重复写入。
 * 4. 通过 appendInjectedAssistantMessageToTranscript 追加 assistant 消息。
 *
 * @param params 参数对象；包含消息内容、session 标识、路径信息、幂等 key 和中止元数据。
 */
function appendAssistantTranscriptMessage(params: {
  message: string;
  label?: string;
  content?: Array<Record<string, unknown>>;
  sessionId: string;
  storePath: string | undefined;
  sessionFile?: string;
  agentId?: string;
  createIfMissing?: boolean;
  idempotencyKey?: string;
  abortMeta?: {
    aborted: true;
    origin: AbortOrigin;
    runId: string;
  };
}): TranscriptAppendResult {
  const transcriptPath = resolveTranscriptPath({
    sessionId: params.sessionId,
    storePath: params.storePath,
    sessionFile: params.sessionFile,
    agentId: params.agentId,
  });
  if (!transcriptPath) {
    return { ok: false, error: "transcript path not resolved" };
  }

  if (!fs.existsSync(transcriptPath)) {
    if (!params.createIfMissing) {
      return { ok: false, error: "transcript file not found" };
    }
    const ensured = ensureTranscriptFile({
      transcriptPath,
      sessionId: params.sessionId,
    });
    if (!ensured.ok) {
      return { ok: false, error: ensured.error ?? "failed to create transcript file" };
    }
  }

  if (params.idempotencyKey && transcriptHasIdempotencyKey(transcriptPath, params.idempotencyKey)) {
    return { ok: true };
  }

  return appendInjectedAssistantMessageToTranscript({
    transcriptPath,
    message: params.message,
    label: params.label,
    content: params.content,
    idempotencyKey: params.idempotencyKey,
    abortMeta: params.abortMeta,
  });
}

/**
 * 🏷️ 【模块分类】: 中止局部回复采集 (Abort Partial Collection)
 * 💡 【核心职责】: 在中止运行前收集已经生成但尚未最终落盘的 assistant 文本。
 * ☕ 【Java 视角】: 类似取消 Future 前从缓冲区提取 partial result。
 *
 * @param params 参数对象；包含 active run 表、文本缓冲区、目标 runId 集合和中止来源。
 */
function collectSessionAbortPartials(params: {
  chatAbortControllers: Map<string, ChatAbortControllerEntry>;
  chatRunBuffers: Map<string, string>;
  runIds: ReadonlySet<string>;
  abortOrigin: AbortOrigin;
}): AbortedPartialSnapshot[] {
  const out: AbortedPartialSnapshot[] = [];
  for (const [runId, active] of params.chatAbortControllers) {
    if (!params.runIds.has(runId)) {
      continue;
    }
    const text = params.chatRunBuffers.get(runId);
    if (!text || !text.trim()) {
      continue;
    }
    out.push({
      runId,
      sessionId: active.sessionId,
      text,
      abortOrigin: params.abortOrigin,
    });
  }
  return out;
}

/**
 * 🏷️ 【模块分类】: 中止局部回复持久化 (Abort Partial Persistence)
 * 💡 【核心职责】: 将被中止运行的 partial assistant 文本写入 transcript，避免用户看不到已生成内容。
 * ☕ 【Java 视角】: 类似取消任务时把当前缓冲结果写入审计日志。
 *
 * @param params 参数对象；包含 Gateway 日志上下文、sessionKey 和 partial 快照数组。
 */
function persistAbortedPartials(params: {
  context: Pick<GatewayRequestContext, "logGateway">;
  sessionKey: string;
  snapshots: AbortedPartialSnapshot[];
}) {
  if (params.snapshots.length === 0) {
    return;
  }
  const { storePath, entry } = loadSessionEntry(params.sessionKey);
  for (const snapshot of params.snapshots) {
    const sessionId = entry?.sessionId ?? snapshot.sessionId ?? snapshot.runId;
    const appended = appendAssistantTranscriptMessage({
      message: snapshot.text,
      sessionId,
      storePath,
      sessionFile: entry?.sessionFile,
      createIfMissing: true,
      idempotencyKey: `${snapshot.runId}:assistant`,
      abortMeta: {
        aborted: true,
        origin: snapshot.abortOrigin,
        runId: snapshot.runId,
      },
    });
    if (!appended.ok) {
      params.context.logGateway.warn(
        `chat.abort transcript append failed: ${appended.error ?? "unknown error"}`,
      );
    }
  }
}

/**
 * 🏷️ 【模块分类】: 中止操作适配器 (Abort Ops Adapter)
 * 💡 【核心职责】: 从 GatewayRequestContext 中抽取 chat-abort 模块需要的可操作状态和回调。
 * ☕ 【Java 视角】: 类似把大 ServiceContext 适配成更窄的接口依赖。
 *
 * @param context Gateway 运行上下文；提供日志、广播、状态表和清理能力。
 */
function createChatAbortOps(context: GatewayRequestContext): ChatAbortOps {
  return {
    chatAbortControllers: context.chatAbortControllers,
    chatRunBuffers: context.chatRunBuffers,
    chatDeltaSentAt: context.chatDeltaSentAt,
    chatDeltaLastBroadcastLen: context.chatDeltaLastBroadcastLen,
    chatAbortedRuns: context.chatAbortedRuns,
    removeChatRun: context.removeChatRun,
    agentRunSeq: context.agentRunSeq,
    broadcast: context.broadcast,
    nodeSendToSession: context.nodeSendToSession,
  };
}

/**
 * 🏷️ 【模块分类】: 可选文本规范化 (Optional Text Normalization)
 * 💡 【核心职责】: 对可选字符串执行 trim，并把空字符串归一为 undefined。
 * ☕ 【Java 视角】: 类似 Optional.ofNullable(value).map(String::trim).filter(notBlank)。
 *
 * @param value 待规范化或检测的输入值。
 */
function normalizeOptionalText(value?: string | null): string | undefined {
  const trimmed = value?.trim();
  return trimmed || undefined;
}

/**
 * 🏷️ 【模块分类】: 显式 chat.send 来源规范化 (Explicit Origin Normalization)
 * 💡 【核心职责】: 校验和规范化 admin 注入的 originating route 字段。
 * ☕ 【Java 视角】: 类似请求 DTO 的跨字段校验器，部分字段出现时要求必填组合完整。
 *
 * @param params 参数对象；承载该方法所需的上下文、输入和回调配置。
 */
function normalizeExplicitChatSendOrigin(
  params: ChatSendExplicitOrigin,
): { ok: true; value?: ChatSendExplicitOrigin } | { ok: false; error: string } {
  const originatingChannel = normalizeOptionalText(params.originatingChannel);
  const originatingTo = normalizeOptionalText(params.originatingTo);
  const accountId = normalizeOptionalText(params.accountId);
  const messageThreadId = normalizeOptionalText(params.messageThreadId);
  const hasAnyExplicitOriginField = Boolean(
    originatingChannel || originatingTo || accountId || messageThreadId,
  );
  if (!hasAnyExplicitOriginField) {
    return { ok: true };
  }
  const normalizedChannel = normalizeMessageChannel(originatingChannel);
  if (!normalizedChannel) {
    return {
      ok: false,
      error: "originatingChannel is required when using originating route fields",
    };
  }
  if (!originatingTo) {
    return {
      ok: false,
      error: "originatingTo is required when using originating route fields",
    };
  }
  return {
    ok: true,
    value: {
      originatingChannel: normalizedChannel,
      originatingTo,
      ...(accountId ? { accountId } : {}),
      ...(messageThreadId ? { messageThreadId } : {}),
    },
  };
}

/**
 * 🏷️ 【模块分类】: 中止请求者解析 (Abort Requester Resolution)
 * 💡 【核心职责】: 从 Gateway client 信息中提取连接、设备和 admin 权限，用于中止授权。
 * ☕ 【Java 视角】: 类似从 SecurityContext/Session 中构建调用方身份对象。
 *
 * @param client Gateway 客户端信息；用于权限、设备和连接归属判断。
 */
function resolveChatAbortRequester(
  client: GatewayRequestHandlerOptions["client"],
): ChatAbortRequester {
  const scopes = Array.isArray(client?.connect?.scopes) ? client.connect.scopes : [];
  return {
    connId: normalizeOptionalText(client?.connId),
    deviceId: normalizeOptionalText(client?.connect?.device?.id),
    isAdmin: scopes.includes(ADMIN_SCOPE),
  };
}

/**
 * 🏷️ 【模块分类】: 中止权限判定 (Abort Authorization)
 * 💡 【核心职责】: 判断当前请求者是否有权中止指定 chat run。
 * ☕ 【Java 视角】: 类似基于 owner device/connection 或 ADMIN 角色的资源级权限判断。
 *
 * @param entry chat run 或会话相关记录；用于权限和归属判断。
 * @param requester 请求中止操作的调用方身份信息。
 */
function canRequesterAbortChatRun(
  entry: ChatAbortControllerEntry,
  requester: ChatAbortRequester,
): boolean {
  if (requester.isAdmin) {
    return true;
  }
  const ownerDeviceId = normalizeOptionalText(entry.ownerDeviceId);
  const ownerConnId = normalizeOptionalText(entry.ownerConnId);
  if (!ownerDeviceId && !ownerConnId) {
    return true;
  }
  if (ownerDeviceId && requester.deviceId && ownerDeviceId === requester.deviceId) {
    return true;
  }
  if (ownerConnId && requester.connId && ownerConnId === requester.connId) {
    return true;
  }
  return false;
}

/**
 * 🏷️ 【模块分类】: 会话可中止运行解析 (Authorized Run Resolution)
 * 💡 【核心职责】: 找出某个 session 下请求者有权限中止的所有 runId。
 * ☕ 【Java 视角】: 类似按 sessionId 过滤任务表后再做逐项 ACL 判断。
 *
 * @param params 参数对象；包含 active run 表、sessionKey 和请求者身份。
 */
function resolveAuthorizedRunIdsForSession(params: {
  chatAbortControllers: Map<string, ChatAbortControllerEntry>;
  sessionKey: string;
  requester: ChatAbortRequester;
}) {
  const authorizedRunIds: string[] = [];
  let matchedSessionRuns = 0;
  for (const [runId, active] of params.chatAbortControllers) {
    if (active.sessionKey !== params.sessionKey) {
      continue;
    }
    matchedSessionRuns += 1;
    if (canRequesterAbortChatRun(active, params.requester)) {
      authorizedRunIds.push(runId);
    }
  }
  return {
    matchedSessionRuns,
    authorizedRunIds,
  };
}

/**
 * 🏷️ 【模块分类】: 会话级中止编排 (Session Abort Orchestration)
 * 💡 【核心职责】: 中止一个 session 下可授权的运行，并持久化已生成 partial 回复。
 * ☕ 【Java 视角】: 类似批量取消 CompletableFuture 并补写 partial result 的服务层方法。
 *
 * 执行主线:
 * 1. 解析当前请求者有权中止的 runId。
 * 2. 中止前采集这些 run 的 partial assistant 文本。
 * 3. 调用 abortChatRunById 传播中止信号。
 * 4. 中止成功后把 partial 文本补写入 transcript。
 *
 * @param params 参数对象；包含 Gateway context、abort ops、sessionKey、中止来源和请求者身份。
 */
function abortChatRunsForSessionKeyWithPartials(params: {
  context: GatewayRequestContext;
  ops: ChatAbortOps;
  sessionKey: string;
  abortOrigin: AbortOrigin;
  stopReason?: string;
  requester: ChatAbortRequester;
}) {
  const { matchedSessionRuns, authorizedRunIds } = resolveAuthorizedRunIdsForSession({
    chatAbortControllers: params.context.chatAbortControllers,
    sessionKey: params.sessionKey,
    requester: params.requester,
  });
  if (authorizedRunIds.length === 0) {
    return {
      aborted: false,
      runIds: [],
      unauthorized: matchedSessionRuns > 0,
    };
  }
  const authorizedRunIdSet = new Set(authorizedRunIds);
  const snapshots = collectSessionAbortPartials({
    chatAbortControllers: params.context.chatAbortControllers,
    chatRunBuffers: params.context.chatRunBuffers,
    runIds: authorizedRunIdSet,
    abortOrigin: params.abortOrigin,
  });
  const runIds: string[] = [];
  for (const runId of authorizedRunIds) {
    const res = abortChatRunById(params.ops, {
      runId,
      sessionKey: params.sessionKey,
      stopReason: params.stopReason,
    });
    if (res.aborted) {
      runIds.push(runId);
    }
  }
  const res = { aborted: runIds.length > 0, runIds, unauthorized: false };
  if (res.aborted) {
    persistAbortedPartials({
      context: params.context,
      sessionKey: params.sessionKey,
      snapshots,
    });
  }
  return res;
}

/**
 * 🏷️ 【模块分类】: 聊天事件序号生成 (Chat Event Sequencing)
 * 💡 【核心职责】: 为同一个 runId 生成递增 seq，保证前端事件顺序可重建。
 * ☕ 【Java 视角】: 类似 Map<RunId, AtomicInteger> 的 per-run 序列号。
 *
 * @param context Gateway 运行上下文；提供日志、广播、状态表和清理能力。
 * @param runId 当前 chat run 的唯一标识。
 */
function nextChatSeq(context: { agentRunSeq: Map<string, number> }, runId: string) {
  const next = (context.agentRunSeq.get(runId) ?? 0) + 1;
  context.agentRunSeq.set(runId, next);
  return next;
}

/**
 * 🏷️ 【模块分类】: 聊天最终事件广播 (Chat Final Broadcast)
 * 💡 【核心职责】: 向 Gateway 广播和节点会话发送 chat final 事件，并清理序号状态。
 * ☕ 【Java 视角】: 类似 WebSocket/STOMP topic 发布最终消息。
 *
 * @param params 参数对象；包含广播上下文、runId、sessionKey 和可选最终消息。
 */
function broadcastChatFinal(params: {
  context: Pick<GatewayRequestContext, "broadcast" | "nodeSendToSession" | "agentRunSeq">;
  runId: string;
  sessionKey: string;
  message?: Record<string, unknown>;
}) {
  const seq = nextChatSeq({ agentRunSeq: params.context.agentRunSeq }, params.runId);
  const payload = {
    runId: params.runId,
    sessionKey: params.sessionKey,
    seq,
    state: "final" as const,
    message: projectChatDisplayMessage(params.message),
  };
  params.context.broadcast("chat", payload);
  params.context.nodeSendToSession(params.sessionKey, "chat", payload);
  params.context.agentRunSeq.delete(params.runId);
}

/**
 * 🏷️ 【模块分类】: BTW 回复载荷识别 (BTW Reply Payload Detection)
 * 💡 【核心职责】: 判断回复是否属于 side-question BTW 结果，并为 TypeScript 收窄类型。
 * ☕ 【Java 视角】: 类似带类型守卫效果的 instanceof + 字段校验。
 *
 * @param payload 单条回复载荷；可能包含文本、媒体、语音或控制字段。
 */
function isBtwReplyPayload(payload: ReplyPayload | undefined): payload is ReplyPayload & {
  btw: { question: string };
  text: string;
} {
  return (
    typeof payload?.btw?.question === "string" &&
    payload.btw.question.trim().length > 0 &&
    typeof payload.text === "string" &&
    payload.text.trim().length > 0
  );
}

/**
 * 🏷️ 【模块分类】: 旁路结果广播 (Side Result Broadcast)
 * 💡 【核心职责】: 广播 BTW 等不进入普通 assistant final 的旁路结果。
 * ☕ 【Java 视角】: 类似发布独立事件类型到 WebSocket channel。
 *
 * @param params 参数对象；包含广播上下文和 side result payload。
 */
function broadcastSideResult(params: {
  context: Pick<GatewayRequestContext, "broadcast" | "nodeSendToSession" | "agentRunSeq">;
  payload: SideResultPayload;
}) {
  const seq = nextChatSeq({ agentRunSeq: params.context.agentRunSeq }, params.payload.runId);
  params.context.broadcast("chat.side_result", {
    ...params.payload,
    seq,
  });
  params.context.nodeSendToSession(params.payload.sessionKey, "chat.side_result", {
    ...params.payload,
    seq,
  });
}

/**
 * 🏷️ 【模块分类】: 聊天错误事件广播 (Chat Error Broadcast)
 * 💡 【核心职责】: 向前端和节点会话广播 chat run 错误状态，并清理序号状态。
 * ☕ 【Java 视角】: 类似异步任务失败后推送错误事件并释放 per-run 状态。
 *
 * @param params 参数对象；包含广播上下文、runId、sessionKey 和错误消息。
 */
function broadcastChatError(params: {
  context: Pick<GatewayRequestContext, "broadcast" | "nodeSendToSession" | "agentRunSeq">;
  runId: string;
  sessionKey: string;
  errorMessage?: string;
}) {
  const seq = nextChatSeq({ agentRunSeq: params.context.agentRunSeq }, params.runId);
  const payload = {
    runId: params.runId,
    sessionKey: params.sessionKey,
    seq,
    state: "error" as const,
    errorMessage: params.errorMessage,
  };
  params.context.broadcast("chat", payload);
  params.context.nodeSendToSession(params.sessionKey, "chat", payload);
  params.context.agentRunSeq.delete(params.runId);
}

/**
 * 🏷️ 【模块分类】: Gateway Chat RPC 处理器注册表 (Gateway Chat RPC Handler Registry)
 * 💡 【核心职责】: 暴露 chat.history、chat.abort、chat.send、chat.inject 四类 Gateway RPC 方法。
 * ☕ 【Java 视角】: 类似一个按 method name 分发的 Controller/HandlerMapping。
 */
export const chatHandlers: GatewayRequestHandlers = {
  /**
   * 🏷️ 【模块分类】: chat.history RPC (Chat History RPC)
   * 💡 【核心职责】: 读取、裁剪并投影 session 历史消息，返回 WebChat 可消费的消息数组。
   * ☕ 【Java 视角】: 类似分页查询聊天记录的 REST Controller 方法。
   *
   * @param params chat.history RPC 原始入参；包含 sessionKey、limit 和 maxChars。
   * @param respond Gateway RPC 响应回调；返回历史消息、思考等级、fastMode 和 verboseLevel。
   * @param context Gateway 请求上下文；用于日志记录、广播状态和托管图片清理调度。
   */
  "chat.history": async ({ params, respond, context }) => {
    if (!validateChatHistoryParams(params)) {
      respond(
        false,
        undefined,
        errorShape(
          ErrorCodes.INVALID_REQUEST,
          `invalid chat.history params: ${formatValidationErrors(validateChatHistoryParams.errors)}`,
        ),
      );
      return;
    }
    const { sessionKey, limit, maxChars } = params as {
      sessionKey: string;
      limit?: number;
      maxChars?: number;
    };
    const { cfg, storePath, entry } = loadSessionEntry(sessionKey);
    const sessionId = entry?.sessionId;
    const sessionAgentId = resolveSessionAgentId({ sessionKey, config: cfg });
    const resolvedSessionModel = resolveSessionModelRef(cfg, entry, sessionAgentId);
    const hardMax = 1000;
    const defaultLimit = 200;
    const requested = typeof limit === "number" ? limit : defaultLimit;
    const max = Math.min(hardMax, requested);
    const maxHistoryBytes = getMaxChatHistoryMessagesBytes();
    const localMessages =
      sessionId && storePath
        ? readRecentSessionMessages(sessionId, storePath, entry?.sessionFile, {
            maxMessages: max,
            maxBytes: Math.max(maxHistoryBytes * 2, 1024 * 1024),
          })
        : [];
    const rawMessages = augmentChatHistoryWithCliSessionImports({
      entry,
      provider: resolvedSessionModel.provider,
      localMessages,
    });
    const effectiveMaxChars = resolveEffectiveChatHistoryMaxChars(cfg, maxChars);
    const normalized = augmentChatHistoryWithCanvasBlocks(
      projectRecentChatDisplayMessages(rawMessages, {
        maxChars: effectiveMaxChars,
        maxMessages: max,
      }),
    );
    const perMessageHardCap = Math.min(CHAT_HISTORY_MAX_SINGLE_MESSAGE_BYTES, maxHistoryBytes);
    const replaced = replaceOversizedChatHistoryMessages({
      messages: normalized,
      maxSingleMessageBytes: perMessageHardCap,
    });
    scheduleChatHistoryManagedImageCleanup({ sessionKey, context });
    const capped = capArrayByJsonBytes(replaced.messages, maxHistoryBytes).items;
    const bounded = enforceChatHistoryFinalBudget({ messages: capped, maxBytes: maxHistoryBytes });
    const placeholderCount = replaced.replacedCount + bounded.placeholderCount;
    if (placeholderCount > 0) {
      chatHistoryPlaceholderEmitCount += placeholderCount;
      logLargePayload({
        surface: "gateway.chat.history",
        action: "truncated",
        bytes: jsonUtf8Bytes(normalized),
        limitBytes: maxHistoryBytes,
        count: placeholderCount,
        reason: "chat_history_budget",
      });
      context.logGateway.debug(
        `chat.history omitted oversized payloads placeholders=${placeholderCount} total=${chatHistoryPlaceholderEmitCount}`,
      );
    }
    let thinkingLevel = entry?.thinkingLevel;
    if (!thinkingLevel) {
      thinkingLevel = resolveGatewaySessionThinkingDefault({
        cfg,
        agentId: sessionAgentId,
        provider: resolvedSessionModel.provider,
        model: resolvedSessionModel.model,
      });
    }
    const verboseLevel = entry?.verboseLevel ?? cfg.agents?.defaults?.verboseDefault;
    respond(true, {
      sessionKey,
      sessionId,
      messages: bounded.messages,
      thinkingLevel,
      fastMode: entry?.fastMode,
      verboseLevel,
    });
  },
  /**
   * 🏷️ 【模块分类】: chat.abort RPC (Chat Abort RPC)
   * 💡 【核心职责】: 按 runId 或 sessionKey 中止正在运行的 chat，并保存已生成 partial。
   * ☕ 【Java 视角】: 类似取消后台任务的 Controller endpoint。
   *
   * @param params chat.abort RPC 原始入参；包含 sessionKey 和可选 runId。
   * @param respond Gateway RPC 响应回调；返回是否中止、被中止的 runId 或权限错误。
   * @param context Gateway 请求上下文；提供 active run、缓冲区和广播状态。
   * @param client 当前 Gateway 客户端信息；用于判断是否有权中止目标 run。
   */
  "chat.abort": ({ params, respond, context, client }) => {
    if (!validateChatAbortParams(params)) {
      respond(
        false,
        undefined,
        errorShape(
          ErrorCodes.INVALID_REQUEST,
          `invalid chat.abort params: ${formatValidationErrors(validateChatAbortParams.errors)}`,
        ),
      );
      return;
    }
    const { sessionKey: rawSessionKey, runId } = params as {
      sessionKey: string;
      runId?: string;
    };

    const ops = createChatAbortOps(context);
    const requester = resolveChatAbortRequester(client);

    if (!runId) {
      const res = abortChatRunsForSessionKeyWithPartials({
        context,
        ops,
        sessionKey: rawSessionKey,
        abortOrigin: "rpc",
        stopReason: "rpc",
        requester,
      });
      if (res.unauthorized) {
        respond(false, undefined, errorShape(ErrorCodes.INVALID_REQUEST, "unauthorized"));
        return;
      }
      respond(true, { ok: true, aborted: res.aborted, runIds: res.runIds });
      return;
    }

    const active = context.chatAbortControllers.get(runId);
    if (!active) {
      respond(true, { ok: true, aborted: false, runIds: [] });
      return;
    }
    if (active.sessionKey !== rawSessionKey) {
      respond(
        false,
        undefined,
        errorShape(ErrorCodes.INVALID_REQUEST, "runId does not match sessionKey"),
      );
      return;
    }
    if (!canRequesterAbortChatRun(active, requester)) {
      respond(false, undefined, errorShape(ErrorCodes.INVALID_REQUEST, "unauthorized"));
      return;
    }

    const partialText = context.chatRunBuffers.get(runId);
    const res = abortChatRunById(ops, {
      runId,
      sessionKey: rawSessionKey,
      stopReason: "rpc",
    });
    if (res.aborted && partialText && partialText.trim()) {
      persistAbortedPartials({
        context,
        sessionKey: rawSessionKey,
        snapshots: [
          {
            runId,
            sessionId: active.sessionId,
            text: partialText,
            abortOrigin: "rpc",
          },
        ],
      });
    }
    respond(true, {
      ok: true,
      aborted: res.aborted,
      runIds: res.aborted ? [runId] : [],
    });
  },
  /**
   * 🏷️ 【模块分类】: chat.send RPC (Chat Send RPC)
   * 💡 【核心职责】: 接收用户输入、附件和来源上下文，启动 agent 调度并异步广播结果。
   * ☕ 【Java 视角】: 类似提交异步任务的 Controller：先返回 runId，再通过 WebSocket 推送进度和最终结果。
   *
   * 执行主线:
   * 1. 入口 DTO/schema 校验，防止非法 RPC 请求进入后续业务流程。
   * 2. 敏感系统字段和显式来源路由做 admin scope 权限校验。
   * 3. 清洗 message、systemProvenanceReceipt，并规范化附件结构。
   * 4. 入口非空校验，拒绝“无正文且无附件”的空请求。
   * 5. sessionKey 规范化，加载配置 cfg 和会话 entry。
   * 6. 检查 session 是否绑定到已删除 agent。
   * 7. 解析附件/媒体，必要时预暂存到 agent sandbox。
   * 8. 构建 MsgContext，注册 AbortController，创建回复 dispatcher。
   * 9. 调用 dispatchInboundMessage，把请求交给 auto-reply/agent 引擎。
   * 10. 在 Promise then/catch/finally 中写 transcript、广播 final/error，并清理运行状态。
   *
   * @param params chat.send RPC 原始入参；通过 validateChatSendParams 后才会被当作 ChatSendRequest 使用。
   * @param respond Gateway RPC 响应回调；用于返回 accepted、INVALID_REQUEST 或 UNAVAILABLE 等结果。
   * @param context Gateway 请求上下文；承载配置加载、广播、去重、运行状态、日志和 abort 控制器等运行期能力。
   * @param client 当前 Gateway 客户端信息；用于 admin scope 权限判断、设备/连接归属和工具事件订阅。
   */
  // 步骤1：接收用户 chat.send RPC 请求，解析消息内容
  //todo 它在校验“这条消息是否伪装/代表某个外部渠道来源”，并把这组路由字段整理成后面可安全使用的结构。
  "chat.send": async ({ params, respond, context, client }) => {
    const incomingParamsForLog = params as {
      sessionKey?: unknown;
      message?: unknown;
      attachments?: unknown;
      idempotencyKey?: unknown;
    };
    const _sk = typeof incomingParamsForLog.sessionKey === "string" ? incomingParamsForLog.sessionKey : "invalid";
    const _rid = typeof incomingParamsForLog.idempotencyKey === "string" ? incomingParamsForLog.idempotencyKey : "missing";
    const _mc = typeof incomingParamsForLog.message === "string" ? incomingParamsForLog.message.length : 0;
    const _ac = Array.isArray(incomingParamsForLog.attachments) ? incomingParamsForLog.attachments.length : 0;
    context.logGateway.info(
        //todo暂不打印runId=${_rid}因为中间有大量换行，待核查
      `[gateway] [webchat-step1-rpc][步骤1-接收请求] chat.send received / 收到 chat.send 请求（前端 WebChat 发起对话入口，Gateway 开始处理） sessionKey=${_sk} messageChars=${_mc} attachmentCount=${_ac}`,
    );
    //入口 DTO/schema 校验,防止非法 RPC 请求进入后续业务流程
    //校验的是 chat.send RPC 入参结构,大概等价于 Java 里的：@Valid ChatSendRequest request
    if (!validateChatSendParams(params)) {
      respond(
        false,
        undefined,
        errorShape(
          ErrorCodes.INVALID_REQUEST,
          `invalid chat.send params: ${formatValidationErrors(validateChatSendParams.errors)}`,
        ),
      );
      return;
    }
    //把 unknown/宽泛的 RPC params 当成已通过 schema 校验的 TypeScript 类型来使用
    //类比 Java：ChatSendRequest p = (ChatSendRequest) params;
    //TypeScript 的 as 不会运行时转换数据，只是告诉编译器：“前面已经校验过了，你现在可以把它当成这个结构用。
    const p = params as {
      sessionKey: string;
      message: string;
      thinking?: string;
      deliver?: boolean;
      originatingChannel?: string;
      originatingTo?: string;
      originatingAccountId?: string;
      originatingThreadId?: string;
      attachments?: Array<{
        type?: string;
        mimeType?: string;
        fileName?: string;
        content?: unknown;
      }>;
      timeoutMs?: number;
      systemInputProvenance?: InputProvenance;
      systemProvenanceReceipt?: string;
      idempotencyKey: string;
    };
    //显式来源路由参数的业务校验和规范化
    //简单说：originatingChannel / originatingTo / originatingAccountId / originatingThreadId 这组字段表示：
    // 这条 chat.send 请求是代表某个外部聊天渠道发来的，后续回复可能要投递回那个渠道。
    const explicitOriginResult = normalizeExplicitChatSendOrigin({
      originatingChannel: p.originatingChannel,
      originatingTo: p.originatingTo,
      accountId: p.originatingAccountId,
      messageThreadId: p.originatingThreadId,
    });
    /** 类比 Java，大概是：
     * OriginResult result = normalizeExplicitOrigin(request);
     * if (!result.ok()) {
     *     return badRequest(result.error());
     * }
     */
    if (!explicitOriginResult.ok) {
      respond(false, undefined, errorShape(ErrorCodes.INVALID_REQUEST, explicitOriginResult.error));
      return;
    }
    /**
     * 类比 Java：
     * if (request.hasSystemFields() && !currentUser.hasRole("ADMIN")) {
     *     return badRequest("requires admin scope");
     * }
     */
    //这段还是 chat.send 的入口安检层，还没真正派发给 Agent。可以分成 5 步看。
    //1.管理员权限拦截
    //意思是：如果请求里带了这些“系统级字段”：systemInputProvenance,systemProvenanceReceipt,originating route fields
    // 那调用方必须有 admin scope。
    if (
      (p.systemInputProvenance || p.systemProvenanceReceipt || explicitOriginResult.value) &&
      !canInjectSystemProvenance(client)
    ) {
      respond(
        false,
        undefined,
        errorShape(
          ErrorCodes.INVALID_REQUEST,
          p.systemInputProvenance || p.systemProvenanceReceipt
            ? "system provenance fields require admin scope"
            : "originating route fields require admin scope",
        ),
      );
      return;
    }
    /**
     * 这里处理用户输入文本：
     *
     * Unicode 规范化
     * 拒绝 \0 null byte
     * 移除不允许的控制字符
     * 保留正常文本、换行、tab
     * 失败就返回：
     *
     * INVALID_REQUEST
     * 类比 Java：
     *
     * SanitizeResult result = sanitize(request.getMessage());
     * if (!result.ok()) return badRequest(result.error());
     */
    //清洗用户消息正文 这是对可选的 systemProvenanceReceipt 再做一次字符串级规范化。
    const sanitizedMessageResult = sanitizeChatSendMessageInput(p.message);
    if (!sanitizedMessageResult.ok) {
      respond(
        false,
        undefined,
        errorShape(ErrorCodes.INVALID_REQUEST, sanitizedMessageResult.error),
      );
      return;
    }
    const systemReceiptResult = normalizeOptionalChatSystemReceipt(p.systemProvenanceReceipt);
    if (!systemReceiptResult.ok) {
      respond(false, undefined, errorShape(ErrorCodes.INVALID_REQUEST, systemReceiptResult.error));
      return;
    }
    /**
     * 这里开始把原始 p.xxx 转成后续稳定使用的变量。
     * 你可以理解成 Java 里的：
     *
     * String inboundMessage = sanitized.message();
     * InputProvenance provenance = normalize(request.getSystemInputProvenance());
     * String receipt = systemReceipt.receipt();
     */
    //生成后续流程要用的标准变量
    const inboundMessage = sanitizedMessageResult.message;
    const systemInputProvenance = normalizeInputProvenance(p.systemInputProvenance);
    const systemProvenanceReceipt = systemReceiptResult.receipt;
    /**
     * 这里做三个准备：
     *
     * stopCommand：判断用户是不是发了“停止生成”命令
     * normalizedAttachments：把 RPC 传来的附件结构转成 chat 内部统一附件结构
     * rawMessage：去掉首尾空白后的正文，用于后面判断是否为空、日志、解析
     */
    //识别 stop 命令 + 规范化附件
    const stopCommand = isChatStopCommandText(inboundMessage);
    const normalizedAttachments = normalizeRpcAttachmentsToChatAttachments(p.attachments);
    const rawMessage = inboundMessage.trim();
    // Step 1.1: log sanitized inbound metadata without printing user content.
    // 步骤1.1：打印清洗后的入站元信息，不打印用户正文内容。
    context.logGateway.debug(
      `[gateway] [webchat-step1-rpc][步骤1-请求清洗] chat.send sanitized / 请求已清洗（Unicode规范化、null byte过滤、附件归一化） runId=${p.idempotencyKey} sessionKey=${p.sessionKey} rawMessageChars=${rawMessage.length} attachmentCount=${normalizedAttachments.length} stopCommand=${String(stopCommand)}`,
    );
    /**
     * 这是空请求拦截：消息正文为空 && 附件也为空 => 拒绝
     * 类比java:
     * if (StringUtils.isBlank(message) && attachments.isEmpty()) {
     *     return badRequest("message or attachment required");
     * }
     */
    //开始从“输入清洗”进入 会话解析 / 配置加载层。
    if (!rawMessage && normalizedAttachments.length === 0) {
      respond(
        false,
        undefined,
        errorShape(ErrorCodes.INVALID_REQUEST, "message or attachment required"),
      );
      return;
    }
    /**
     * cfg：OpenClaw 配置对象
     * entry：session 记录，可能包含 sessionId、模型、渠道、历史文件等
     * canonicalKey：规范化后的 sessionKey
     * 类比 Java：
     *
     * SessionLoadResult result = sessionService.load(rawSessionKey);
     *
     * OpenClawConfig cfg = result.config();
     * SessionEntry entry = result.entry();
     * String sessionKey = result.canonicalKey();
     */
    //这里是关键。loadSessionEntry 会根据 sessionKey 加载当前会话相关信息：
    const rawSessionKey = p.sessionKey;
    const { cfg, entry, canonicalKey: sessionKey } = loadSessionEntry(rawSessionKey);
    context.logGateway.debug(
      `[gateway] [webchat-step1-rpc][步骤1-加载会话配置] load session/config / 加载会话和配置（根据 sessionKey 查找 agent、模型、渠道绑定） runId=${p.idempotencyKey} rawSessionKey=${rawSessionKey} sessionKey=${sessionKey} hasEntry=${String(Boolean(entry))}`,
    );
    /**
     * OpenClaw 支持多 agent。某些 sessionKey 可能带 agent 信息，比如逻辑上对应：
     * agentA:main
     * agentB:some-session
     * 如果配置里已经没有这个 agent，但用户还拿旧 sessionKey 发请求，就要拒绝。
     */
    //检查这个 sessionKey 指向的 agent 是否已经从配置里删除了。
    //这段在确认请求不是空消息，然后用 sessionKey 加载 Gateway 配置和会话记录，并拒绝已经指向“被删除 agent”的旧会话请求。
    const deletedAgentId = resolveDeletedAgentIdFromSessionKey(cfg, sessionKey);
    /**
     * 类比 Java：
     * String deletedAgentId = resolveDeletedAgentIdFromSessionKey(cfg, sessionKey);
     * if (deletedAgentId != null) {
     *     return badRequest("Agent no longer exists in configuration");
     * }
     */
    if (deletedAgentId !== null) {
      respond(
        false,
        undefined,
        errorShape(
          ErrorCodes.INVALID_REQUEST,
          `Agent "${deletedAgentId}" no longer exists in configuration`,
        ),
      );
      return;
    }
    const agentId = resolveSessionAgentId({
      sessionKey,
      config: cfg,
    });
    context.logGateway.info(
      `[gateway] [webchat-step1-rpc][步骤1-入口处理完成] request ready / 入参校验、会话加载、Agent 解析完成（准备进入附件解析/分发阶段） runId=${p.idempotencyKey} sessionKey=${sessionKey} agentId=${agentId} messageChars=${rawMessage.length} attachmentCount=${normalizedAttachments.length} stopCommand=${String(stopCommand)}`,
    );
    let parsedMessage = inboundMessage;
    let parsedImages: ChatImageContent[] = [];
    let imageOrder: PromptImageOrderEntry[] = [];
    let offloadedRefs: OffloadedRef[] = [];
    let mediaPathOffloadPaths: string[] = [];
    let mediaPathOffloadTypes: string[] = [];
    let mediaPathOffloadWorkspaceDir: string | undefined;
    const timeoutMs = resolveAgentTimeoutMs({
      cfg,
      overrideMs: p.timeoutMs,
    });
    const now = Date.now();
    const clientRunId = p.idempotencyKey;

    const sendPolicy = resolveSendPolicy({
      cfg,
      entry,
      sessionKey,
      channel: entry?.channel,
      chatType: entry?.chatType,
    });
    if (sendPolicy === "deny") {
      respond(
        false,
        undefined,
        errorShape(ErrorCodes.INVALID_REQUEST, "send blocked by session policy"),
      );
      return;
    }

    if (stopCommand) {
      const res = abortChatRunsForSessionKeyWithPartials({
        context,
        ops: createChatAbortOps(context),
        sessionKey: rawSessionKey,
        abortOrigin: "stop-command",
        stopReason: "stop",
        requester: resolveChatAbortRequester(client),
      });
      if (res.unauthorized) {
        respond(false, undefined, errorShape(ErrorCodes.INVALID_REQUEST, "unauthorized"));
        return;
      }
      respond(true, { ok: true, aborted: res.aborted, runIds: res.runIds });
      return;
    }

    const cached = context.dedupe.get(`chat:${clientRunId}`);
    if (cached) {
      respond(cached.ok, cached.payload, cached.error, {
        cached: true,
      });
      return;
    }

    const activeExisting = context.chatAbortControllers.get(clientRunId);
    if (activeExisting) {
      respond(true, { runId: clientRunId, status: "in_flight" as const }, undefined, {
        cached: true,
        runId: clientRunId,
      });
      return;
    }
    const explicitOriginTargetsPlugin = explicitOriginTargetsPluginBinding(
      explicitOriginResult.value,
    );
    if (normalizedAttachments.length > 0) {
      const modelRef = resolveSessionModelRef(cfg, entry, agentId);
      const supportsSessionModelImages = await resolveGatewayModelSupportsImages({
        loadGatewayModelCatalog: context.loadGatewayModelCatalog,
        provider: modelRef.provider,
        model: modelRef.model,
      });
      context.logGateway.info(
        `[gateway] [webchat-step2-attach][步骤2-解析附件] parse attachments start / 开始解析附件（将用户上传的文件转为 Agent 可引用的媒体资源） runId=${clientRunId} sessionKey=${sessionKey} agentId=${agentId} attachmentCount=${normalizedAttachments.length} provider=${modelRef.provider} model=${modelRef.model} supportsSessionModelImages=${String(supportsSessionModelImages)}`,
      );
      // Bound plugin sessions own the real recipient model, so keep image
      // attachments even when the parent OpenClaw session model is text-only.
      // [中文]: 绑定到插件的会话由插件拥有真实接收模型，因此即使父级 OpenClaw session 模型是纯文本，也要保留图片附件。
      const supportsImages =
        supportsSessionModelImages ||
        explicitOriginTargetsAcpSession(explicitOriginResult.value) ||
        explicitOriginTargetsPlugin;
      const routeImageOffloadsAsMediaPaths = !supportsImages;
      try {
        const parsed = await parseMessageWithAttachments(inboundMessage, normalizedAttachments, {
          maxBytes: resolveChatAttachmentMaxBytes(cfg),
          log: context.logGateway,
          supportsImages,
          // chat.send routes selected offloadedRefs into ctx.MediaPaths below
          // so the auto-reply stage pipeline can surface them to the agent.
          // [中文]: chat.send 会在下面把选中的 offloadedRefs 放入 ctx.MediaPaths，使 auto-reply 阶段管线能把它们暴露给 agent。
          acceptNonImage: true,
        });
        parsedMessage = stripTrailingOffloadedMediaMarkers(
          parsed.message,
          routeImageOffloadsAsMediaPaths
            ? parsed.offloadedRefs.filter((ref) => ref.mimeType.startsWith("image/"))
            : [],
        );
        parsedImages = parsed.images;
        imageOrder = routeImageOffloadsAsMediaPaths ? [] : parsed.imageOrder;
        offloadedRefs = parsed.offloadedRefs;
        ({
          paths: mediaPathOffloadPaths,
          types: mediaPathOffloadTypes,
          workspaceDir: mediaPathOffloadWorkspaceDir,
        } = await prestageMediaPathOffloads({
          offloadedRefs,
          // Text-only image offloads need ctx.MediaPaths so media-understanding
          // can describe them via agents.defaults.imageModel. Vision-capable
          // image offloads stay as prompt refs for native image loading.
          // [中文]: 纯文本模型的图片 offload 需要进入 ctx.MediaPaths，让媒体理解通过 agents.defaults.imageModel 描述它们；支持视觉的模型则把图片 offload 保持为原生图片加载用的 prompt refs。
          includeImageRefs: routeImageOffloadsAsMediaPaths,
          cfg,
          sessionKey,
          agentId,
        }));
        context.logGateway.info(
          `[gateway] [webchat-step2-attach][步骤2-解析附件完成] parse attachments complete / 附件解析完成（图片、文件 offload 已就绪） runId=${clientRunId} sessionKey=${sessionKey} agentId=${agentId} imageCount=${parsedImages.length} imageOrderCount=${imageOrder.length} offloadedRefCount=${offloadedRefs.length} mediaPathCount=${mediaPathOffloadPaths.length}`,
        );
      } catch (err) {
        context.logGateway.warn(
          `[gateway] [webchat-step2-attach][步骤2-解析附件失败] parse attachments failed / 附件解析失败 runId=${clientRunId} sessionKey=${sessionKey} agentId=${agentId} error=${formatForLog(err)}`,
        );
        respond(
          false,
          undefined,
          errorShape(
            err instanceof MediaOffloadError ? ErrorCodes.UNAVAILABLE : ErrorCodes.INVALID_REQUEST,
            String(err),
          ),
        );
        return;
      }
    }

    try {
      // Step 3: register an abortable chat run before the async Agent work starts.
      // 步骤3：注册可中止的 chat run，后续 stop/超时/清理都依赖这里的运行状态。
      context.logGateway.info(
        `[gateway] [webchat-step3-run][步骤3-注册运行状态] register chat run / 注册可中止运行（绑定 AbortController 用于停止/超时/清理） runId=${clientRunId} sessionKey=${sessionKey} agentId=${agentId} timeoutMs=${timeoutMs}`,
      );
      const activeRunAbort = registerChatAbortController({
        chatAbortControllers: context.chatAbortControllers,
        runId: clientRunId,
        sessionId: entry?.sessionId ?? clientRunId,
        sessionKey: rawSessionKey,
        timeoutMs,
        now,
        ownerConnId: normalizeOptionalText(client?.connId),
        ownerDeviceId: normalizeOptionalText(client?.connect?.device?.id),
        kind: "chat-send",
      });
      if (!activeRunAbort.registered) {
        context.logGateway.info(
          `[gateway] [webchat-step3-run][步骤3-重复运行] duplicate run in flight / 重复 runId 已在运行（幂等保护，拒绝重复请求） runId=${clientRunId} sessionKey=${sessionKey} agentId=${agentId}`,
        );
        respond(true, { runId: clientRunId, status: "in_flight" as const }, undefined, {
          cached: true,
          runId: clientRunId,
        });
        return;
      }
      context.addChatRun(clientRunId, {
        sessionKey,
        clientRunId,
      });
      const ackPayload = {
        runId: clientRunId,
        status: "started" as const,
      };
      respond(true, ackPayload, undefined, { runId: clientRunId });
      context.logGateway.info(
        `[gateway] [webchat-step3-run][步骤3-运行已注册] run registered and acked / 已注册运行状态并告知前端开始处理（respond accepted） runId=${clientRunId} sessionKey=${sessionKey} agentId=${agentId} timeoutMs=${timeoutMs}`,
      );
      const persistedImagesPromise = persistChatSendImages({
        images: parsedImages,
        imageOrder,
        offloadedRefs,
        client,
        logGateway: context.logGateway,
      });
      const pluginBoundMediaFields =
        explicitOriginTargetsPlugin && parsedImages.length > 0
          ? resolveChatSendTranscriptMediaFields(await persistedImagesPromise)
          : {};

      const trimmedMessage = parsedMessage.trim();
      const injectThinking = Boolean(
        p.thinking && trimmedMessage && !trimmedMessage.startsWith("/"),
      );
      const commandBody = injectThinking ? `/think ${p.thinking} ${parsedMessage}` : parsedMessage;
      const messageForAgent = systemProvenanceReceipt
        ? [systemProvenanceReceipt, parsedMessage].filter(Boolean).join("\n\n")
        : parsedMessage;
      const clientInfo = client?.connect?.client;
      const {
        originatingChannel,
        originatingTo,
        accountId,
        messageThreadId,
        explicitDeliverRoute,
      } = resolveChatSendOriginatingRoute({
        client: clientInfo,
        deliver: p.deliver,
        entry,
        explicitOrigin: explicitOriginResult.value,
        hasConnectedClient: client?.connect !== undefined,
        mainKey: cfg.session?.mainKey,
        sessionKey,
      });
      // Inject timestamp so agents know the current date/time.
      // Only BodyForAgent gets the timestamp — Body stays raw for UI display.
      // See: https://github.com/moltbot/moltbot/issues/3658
      // [中文]: 注入时间戳，让 agent 知道当前日期/时间。只有 BodyForAgent 会带时间戳，Body 保持原始内容用于 UI 展示。参考：https://github.com/moltbot/moltbot/issues/3658
      const stampedMessage = injectTimestamp(messageForAgent, timestampOptsFromConfig(cfg));

      // Step 4: build the MsgContext consumed by auto-reply and the Agent runtime.
      // 步骤4：组装 MsgContext，这是交给 auto-reply 和 Agent 运行时的请求对象。
      const ctx: MsgContext = {
        Body: messageForAgent,
        BodyForAgent: stampedMessage,
        BodyForCommands: commandBody,
        RawBody: parsedMessage,
        CommandBody: commandBody,
        InputProvenance: systemInputProvenance,
        SessionKey: sessionKey,
        Provider: INTERNAL_MESSAGE_CHANNEL,
        Surface: INTERNAL_MESSAGE_CHANNEL,
        OriginatingChannel: originatingChannel,
        OriginatingTo: originatingTo,
        ExplicitDeliverRoute: explicitDeliverRoute,
        AccountId: accountId,
        MessageThreadId: messageThreadId,
        ChatType: "direct",
        CommandAuthorized: true,
        MessageSid: clientRunId,
        SenderId: clientInfo?.id,
        SenderName: clientInfo?.displayName,
        SenderUsername: clientInfo?.displayName,
        GatewayClientScopes: client?.connect?.scopes ?? [],
        ...pluginBoundMediaFields,
      };
      if (mediaPathOffloadPaths.length > 0) {
        // Inject offloads via the same MsgContext fields the channel
        // path uses so buildInboundMediaNote renders a real `[media attached:
        // <workspace-relative-path>]` line into the agent prompt. Marker
        // blocks the dispatch pipeline from re-running stageSandboxMedia; see
        // prestageMediaPathOffloads.
        // [中文]: 通过渠道路径同样使用的 MsgContext 字段注入 offload，让 buildInboundMediaNote 在 agent prompt 中渲染真实的 `[media attached: <workspace-relative-path>]` 行。标记会阻止调度管线再次运行 stageSandboxMedia；见 prestageMediaPathOffloads。
        ctx.MediaPath = mediaPathOffloadPaths[0];
        ctx.MediaPaths = mediaPathOffloadPaths;
        ctx.MediaType = mediaPathOffloadTypes[0];
        ctx.MediaTypes = mediaPathOffloadTypes;
        ctx.MediaWorkspaceDir = mediaPathOffloadWorkspaceDir;
        ctx.MediaStaged = true;
      }
      context.logGateway.debug(
        `[gateway] [webchat-step4-context][步骤4-组装Agent请求对象] build MsgContext / 组装 Agent 请求上下文（Body/BodyForAgent/Channel/MediaPath） runId=${clientRunId} sessionKey=${sessionKey} agentId=${agentId} provider=${ctx.Provider} chatType=${ctx.ChatType} hasOriginatingRoute=${String(Boolean(originatingChannel || originatingTo || explicitDeliverRoute))} hasMediaPaths=${String(mediaPathOffloadPaths.length > 0)}`,
      );

      const { onModelSelected, ...replyPipeline } = createChannelReplyPipeline({
        cfg,
        agentId,
        channel: INTERNAL_MESSAGE_CHANNEL,
      });
      const onWebchatModelSelected: typeof onModelSelected = (modelCtx) => {
        context.logGateway.info(
          `[gateway] [webchat-step7-model][步骤7-模型已选择] model selected / Agent 已选择模型（onModelSelected 回调通知 Gateway，晚于 Agent 内部模型选定是正常异步时序） runId=${clientRunId} sessionKey=${sessionKey} agentId=${agentId} provider=${modelCtx.provider} model=${modelCtx.model} thinkLevel=${modelCtx.thinkLevel ?? "none"}`,
        );
        onModelSelected(modelCtx);
      };
      context.logGateway.info(
        `[gateway] [webchat-step4-context][步骤4-请求对象准备完成] context and reply pipeline ready / Agent 请求对象和回复管线（dispatcher）准备完成 runId=${clientRunId} sessionKey=${sessionKey} agentId=${agentId} provider=${ctx.Provider} channel=${INTERNAL_MESSAGE_CHANNEL} hasMediaPaths=${String(mediaPathOffloadPaths.length > 0)}`,
      );
      const deliveredReplies: Array<{ payload: ReplyPayload; kind: "block" | "final" }> = [];
      let appendedWebchatAgentMedia = false;
      let userTranscriptUpdatePromise: Promise<void> | null = null;
      const emitUserTranscriptUpdate = async () => {
        if (userTranscriptUpdatePromise) {
          await userTranscriptUpdatePromise;
          return;
        }
        userTranscriptUpdatePromise = (async () => {
          const { storePath: latestStorePath, entry: latestEntry } = loadSessionEntry(sessionKey);
          const resolvedSessionId = latestEntry?.sessionId ?? entry?.sessionId;
          if (!resolvedSessionId) {
            return;
          }
          const transcriptPath = resolveTranscriptPath({
            sessionId: resolvedSessionId,
            storePath: latestStorePath,
            sessionFile: latestEntry?.sessionFile ?? entry?.sessionFile,
            agentId,
          });
          if (!transcriptPath) {
            return;
          }
          const persistedImages = await persistedImagesPromise;
          emitSessionTranscriptUpdate({
            sessionFile: transcriptPath,
            sessionKey,
            message: buildChatSendTranscriptMessage({
              message: parsedMessage,
              savedImages: persistedImages,
              timestamp: now,
            }),
          });
        })();
        await userTranscriptUpdatePromise;
      };
      let transcriptMediaRewriteDone = false;
      const rewriteUserTranscriptMedia = async () => {
        if (transcriptMediaRewriteDone) {
          return;
        }
        const { storePath: latestStorePath, entry: latestEntry } = loadSessionEntry(sessionKey);
        const resolvedSessionId = latestEntry?.sessionId ?? entry?.sessionId;
        if (!resolvedSessionId) {
          return;
        }
        const transcriptPath = resolveTranscriptPath({
          sessionId: resolvedSessionId,
          storePath: latestStorePath,
          sessionFile: latestEntry?.sessionFile ?? entry?.sessionFile,
          agentId,
        });
        if (!transcriptPath) {
          return;
        }
        transcriptMediaRewriteDone = true;
        await rewriteChatSendUserTurnMediaPaths({
          transcriptPath,
          sessionKey,
          message: parsedMessage,
          savedImages: await persistedImagesPromise,
        });
      };
      const appendWebchatAgentMediaTranscriptIfNeeded = async (payload: ReplyPayload) => {
        if (!agentRunStarted || appendedWebchatAgentMedia || !isMediaBearingPayload(payload)) {
          return;
        }
        const transcriptPayload = stripVisibleTextFromTtsSupplement(payload);
        const { storePath: latestStorePath, entry: latestEntry } = loadSessionEntry(sessionKey);
        const sessionId = latestEntry?.sessionId ?? entry?.sessionId ?? clientRunId;
        const resolvedTranscriptPath = resolveTranscriptPath({
          sessionId,
          storePath: latestStorePath,
          sessionFile: latestEntry?.sessionFile ?? entry?.sessionFile,
          agentId,
        });
        const mediaLocalRoots = appendLocalMediaParentRoots(
          getAgentScopedMediaLocalRoots(cfg, agentId),
          resolvedTranscriptPath ? [resolvedTranscriptPath] : undefined,
        );
        const assistantContent = await buildAssistantDisplayContentFromReplyPayloads({
          sessionKey,
          payloads: [transcriptPayload],
          managedImageLocalRoots: mediaLocalRoots,
          includeSensitiveMedia: transcriptPayload.sensitiveMedia !== true,
          onLocalAudioAccessDenied: (message) => {
            context.logGateway.warn(`webchat audio embedding denied local path: ${message}`);
          },
          onManagedImagePrepareError: (message) => {
            context.logGateway.warn(`webchat image embedding skipped attachment: ${message}`);
          },
        });
        const mediaMessage = await buildWebchatAssistantMediaMessage([transcriptPayload], {
          localRoots: mediaLocalRoots,
          onLocalAudioAccessDenied: (message) => {
            context.logGateway.warn(`webchat audio embedding denied local path: ${message}`);
          },
        });
        const persistedAssistantContent = replaceAssistantContentTextBlocks(
          assistantContent,
          mediaMessage,
        );
        const persistedContentForAppend = hasAssistantDisplayMediaContent(persistedAssistantContent)
          ? persistedAssistantContent
          : undefined;
        const transcriptReply =
          mediaMessage?.transcriptText ??
          extractAssistantDisplayTextFromContent(assistantContent) ??
          buildTranscriptReplyText([transcriptPayload]);
        if (!transcriptReply && !persistedAssistantContent?.length && !assistantContent?.length) {
          return;
        }
        const appended = appendAssistantTranscriptMessage({
          message: transcriptReply,
          ...(persistedContentForAppend?.length ? { content: persistedContentForAppend } : {}),
          sessionId,
          storePath: latestStorePath,
          sessionFile: latestEntry?.sessionFile,
          agentId,
          createIfMissing: true,
          idempotencyKey: `${clientRunId}:assistant-media`,
        });
        if (appended.ok) {
          if (appended.messageId && assistantContent?.length) {
            await attachManagedOutgoingImagesToMessage({
              messageId: appended.messageId,
              blocks: assistantContent,
            });
          }
          appendedWebchatAgentMedia = true;
          context.logGateway.info(
            `[gateway] [webchat-step9-media-transcript][步骤9-写入媒体回复] append media assistant transcript / 写入媒体类助手回复到 transcript（TTS/图片等媒体内容） runId=${clientRunId} sessionKey=${sessionKey} agentId=${agentId} messageId=${appended.messageId ?? "missing"}`,
          );
          return;
        }
        context.logGateway.warn(
          `webchat transcript append failed for media reply: ${appended.error ?? "unknown error"}`,
        );
      };
      const dispatcher = createReplyDispatcher({
        ...replyPipeline,
        onError: (err) => {
          context.logGateway.warn(`webchat dispatch failed: ${formatForLog(err)}`);
        },
        deliver: async (payload, info) => {
          if (info.kind === "final" || info.kind === "tool" || isMediaBearingPayload(payload)) {
            context.logGateway.info(
              `[gateway] [webchat-step8-reply][步骤8-收到回复片段] reply payload received / 收到 Agent 流式回复片段（LLM 输出通过 dispatcher 回调到 gateway） runId=${clientRunId} sessionKey=${sessionKey} agentId=${agentId} kind=${info.kind} hasText=${String(Boolean(payload.text?.trim()))} hasMedia=${String(isMediaBearingPayload(payload))} isReasoning=${String(payload.isReasoning === true)}`,
            );
          }
          switch (info.kind) {
            case "block":
            case "final":
              deliveredReplies.push({ payload, kind: info.kind });
              await appendWebchatAgentMediaTranscriptIfNeeded(payload);
              break;
            case "tool":
              // Tool results that carry audio (e.g. the TTS tool) must be promoted
              // to "final" so the downstream audio extraction path can pick them up.
              // Strip text to avoid leaking tool summary into the combined reply.
              // [中文]: 携带音频的工具结果（例如 TTS 工具）必须提升为 "final"，下游音频提取路径才能拿到它们。这里剥离文本，避免工具摘要泄露进组合回复。
              if (isMediaBearingPayload(payload)) {
                deliveredReplies.push({
                  payload: { ...payload, text: undefined },
                  kind: "final",
                });
              }
              break;
          }
        },
      });

      // Step 1.2: surface accepted inbound turns immediately so transcript subscribers
      // (gateway watchers, MCP bridges, external channel backends) do not wait
      // on model startup, completion, or failure paths before seeing the user turn.
      // 步骤1.2：立即暴露已接受的入站回合，让 transcript 订阅者（Gateway watcher、MCP bridge、外部渠道后端）不用等待模型启动、完成或失败路径，就能看到用户回合。
      context.logGateway.info(
        `[gateway] [webchat-step5-transcript][步骤5-立即显示用户消息] eager user turn emit start / 立即把用户消息显示到 transcript（不等 LLM 启动，直接让前端看到用户发言） runId=${clientRunId} sessionKey=${sessionKey} agentId=${agentId} imageCount=${parsedImages.length} offloadedRefCount=${offloadedRefs.length}`,
      );
      void emitUserTranscriptUpdate()
        .then(() => {
          context.logGateway.debug(
            `[gateway] [webchat-step5-transcript][步骤5-立即显示用户消息完成] eager user turn emit complete / 用户消息已显示到 transcript runId=${clientRunId} sessionKey=${sessionKey} agentId=${agentId}`,
          );
        })
        .catch((transcriptErr) => {
          context.logGateway.warn(
            `[gateway] [webchat-step5-transcript][步骤5-立即显示用户消息失败] eager user turn emit failed / 用户消息显示失败 runId=${clientRunId} sessionKey=${sessionKey} agentId=${agentId} error=${formatForLog(transcriptErr)}`,
          );
        });

      let agentRunStarted = false;
      // Step 2: dispatch the message into the Agent scheduling pipeline.
      // 步骤2：将消息分发到 Agent 调度管线，进入 auto-reply 模块。
      context.logGateway.info(
        `[gateway] [webchat-step6-dispatch][步骤6-分发到Agent] dispatch inbound start / 开始分发入站消息（调用 dispatchInboundMessage 进入 auto-reply 引擎） runId=${clientRunId} sessionKey=${sessionKey} agentId=${agentId} imageCount=${parsedImages.length} imageOrderCount=${imageOrder.length} mediaPathCount=${mediaPathOffloadPaths.length}`,
      );
      void dispatchInboundMessage({
        ctx,
        cfg,
        dispatcher,
        replyOptions: {
          runId: clientRunId,
          abortSignal: activeRunAbort.controller.signal,
          images: parsedImages.length > 0 ? parsedImages : undefined,
          imageOrder: imageOrder.length > 0 ? imageOrder : undefined,
          onAgentRunStart: (runId) => {
            agentRunStarted = true;
            void emitUserTranscriptUpdate();
            const connId = typeof client?.connId === "string" ? client.connId : undefined;
            const wantsToolEvents = hasGatewayClientCap(
              client?.connect?.caps,
              GATEWAY_CLIENT_CAPS.TOOL_EVENTS,
            );
            context.logGateway.info(
              `[gateway] [webchat-step6-dispatch][步骤6-Agent运行开始] agent run started / Agent 已开始运行（底层嵌入式 Agent 引擎已启动） runId=${runId} clientRunId=${clientRunId} sessionKey=${sessionKey} agentId=${agentId} connId=${connId ?? "none"} wantsToolEvents=${String(wantsToolEvents)}`,
            );
            if (connId && wantsToolEvents) {
              context.registerToolEventRecipient(runId, connId);
              // Register for any other active runs *in the same session* so
              // late-joining clients (e.g. page refresh mid-response) receive
              // in-progress tool events without leaking cross-session data.
              // [中文]: 也为同一 session 中的其他 active run 注册接收者，使后加入的客户端（例如响应中途刷新页面）能收到进行中的工具事件，同时不泄露跨 session 数据。
              for (const [activeRunId, active] of context.chatAbortControllers) {
                if (activeRunId !== runId && active.sessionKey === p.sessionKey) {
                  context.registerToolEventRecipient(activeRunId, connId);
                }
              }
            }
          },
          onModelSelected: onWebchatModelSelected,
        },
      })
        .then(async () => {
          context.logGateway.debug(
            `[gateway] [webchat-step6-dispatch][步骤6-分发完成] dispatch inbound complete / 入站消息分发完成 runId=${clientRunId} sessionKey=${sessionKey} agentId=${agentId} agentRunStarted=${String(agentRunStarted)} deliveredReplyCount=${deliveredReplies.length}`,
          );
          // Step 7: rewrite temporary user media references after dispatch settles.
          // 步骤7：调度结束后，把用户消息里的临时媒体引用改写成最终可回放的引用。
          if (parsedImages.length > 0 || offloadedRefs.length > 0) {
            context.logGateway.info(
              `[gateway] [webchat-step10-media-rewrite][步骤10-改写用户媒体引用] rewrite user media start / 开始改写用户消息中的临时媒体引用为最终可回放的引用 runId=${clientRunId} sessionKey=${sessionKey} agentId=${agentId}`,
            );
          }
          await rewriteUserTranscriptMedia();
          if (parsedImages.length > 0 || offloadedRefs.length > 0) {
            context.logGateway.info(
              `[gateway] [webchat-step10-media-rewrite][步骤10-改写媒体引用完成] rewrite user media complete / 用户消息媒体引用改写完成 runId=${clientRunId} sessionKey=${sessionKey} agentId=${agentId}`,
            );
          }
          if (!agentRunStarted) {
            context.logGateway.debug(
              `[gateway] [webchat-step11-finalize][步骤11-处理无Agent直接回复] finalize non-agent reply / 处理未启动 Agent 的直接回复（如 BTW 旁路回复） runId=${clientRunId} sessionKey=${sessionKey} agentId=${agentId} deliveredReplyCount=${deliveredReplies.length}`,
            );
            await emitUserTranscriptUpdate();
            const btwReplies = deliveredReplies
              .map((entry) => entry.payload)
              .filter(isBtwReplyPayload);
            const btwText = btwReplies
              .map((payload) => payload.text.trim())
              .filter(Boolean)
              .join("\n\n")
              .trim();
            if (btwReplies.length > 0 && btwText) {
              context.logGateway.info(
                `[gateway] [webchat-step13-broadcast][步骤13-广播BTW结果] broadcast btw result / 广播 BTW 侧边结果给 WebChat 前端 runId=${clientRunId} sessionKey=${sessionKey} agentId=${agentId} btwReplyCount=${btwReplies.length}`,
              );
              broadcastSideResult({
                context,
                payload: {
                  kind: "btw",
                  runId: clientRunId,
                  sessionKey,
                  question: btwReplies[0].btw.question.trim(),
                  text: btwText,
                  isError: btwReplies.some((payload) => payload.isError),
                  ts: Date.now(),
                },
              });
              broadcastChatFinal({
                context,
                runId: clientRunId,
                sessionKey,
              });
              context.logGateway.info(
                `[gateway] [webchat-step13-broadcast][步骤13-广播最终状态] broadcast chat final / 广播聊天最终状态给所有订阅者（无消息体） runId=${clientRunId} sessionKey=${sessionKey} agentId=${agentId} hasMessage=false`,
              );
            } else {
              const finalPayloads = appendedWebchatAgentMedia
                ? []
                : deliveredReplies
                    .filter((entry) => entry.kind === "final")
                    .map((entry) => entry.payload);
              context.logGateway.info(
                `[gateway] [webchat-step11-finalize][步骤11-组装助手回复] build assistant reply / 组装助手最终回复（从 deliveredReplies 提取 final 类 payload） runId=${clientRunId} sessionKey=${sessionKey} agentId=${agentId} finalPayloadCount=${finalPayloads.length} appendedWebchatAgentMedia=${String(appendedWebchatAgentMedia)}`,
              );
              const { storePath: latestStorePath, entry: latestEntry } =
                loadSessionEntry(sessionKey);
              const sessionId = latestEntry?.sessionId ?? entry?.sessionId ?? clientRunId;
              const resolvedTranscriptPath = resolveTranscriptPath({
                sessionId,
                storePath: latestStorePath,
                sessionFile: latestEntry?.sessionFile ?? entry?.sessionFile,
                agentId,
              });
              const mediaLocalRoots = appendLocalMediaParentRoots(
                getAgentScopedMediaLocalRoots(cfg, agentId),
                resolvedTranscriptPath ? [resolvedTranscriptPath] : undefined,
              );
              const assistantContent = await buildAssistantDisplayContentFromReplyPayloads({
                sessionKey,
                payloads: finalPayloads,
                managedImageLocalRoots: mediaLocalRoots,
                includeSensitiveMedia: false,
                onLocalAudioAccessDenied: (message) => {
                  context.logGateway.warn(`webchat audio embedding denied local path: ${message}`);
                },
                onManagedImagePrepareError: (message) => {
                  context.logGateway.warn(`webchat image embedding skipped attachment: ${message}`);
                },
              });
              const mediaMessage = await buildWebchatAssistantMediaMessage(finalPayloads, {
                localRoots: mediaLocalRoots,
                onLocalAudioAccessDenied: (message) => {
                  context.logGateway.warn(`webchat audio embedding denied local path: ${message}`);
                },
              });
              const hasSensitiveMedia = hasSensitiveMediaPayload(finalPayloads);
              const persistedAssistantContent = replaceAssistantContentTextBlocks(
                hasSensitiveMedia
                  ? await buildAssistantDisplayContentFromReplyPayloads({
                      sessionKey,
                      payloads: finalPayloads,
                      managedImageLocalRoots: mediaLocalRoots,
                      includeSensitiveMedia: false,
                      onLocalAudioAccessDenied: (message) => {
                        context.logGateway.warn(
                          `webchat audio embedding denied local path: ${message}`,
                        );
                      },
                      onManagedImagePrepareError: (message) => {
                        context.logGateway.warn(
                          `webchat image embedding skipped attachment: ${message}`,
                        );
                      },
                    })
                  : assistantContent,
                mediaMessage,
              );
              const persistedContentForAppend = hasAssistantDisplayMediaContent(
                persistedAssistantContent,
              )
                ? persistedAssistantContent
                : undefined;
              const broadcastAssistantContent = hasAssistantDisplayMediaContent(assistantContent)
                ? assistantContent
                : hasAssistantDisplayMediaContent(mediaMessage?.content)
                  ? mediaMessage?.content
                  : assistantContent;
              const displayReply =
                extractAssistantDisplayTextFromContent(assistantContent) ??
                buildTranscriptReplyText(finalPayloads);
              const transcriptReply =
                mediaMessage?.transcriptText ||
                buildTranscriptReplyText(finalPayloads) ||
                displayReply;
              let message: Record<string, unknown> | undefined;
              if (
                transcriptReply ||
                persistedContentForAppend?.length ||
                assistantContent?.length
              ) {
                context.logGateway.info(
                  `[gateway] [webchat-step12-transcript][步骤12-写入助手回复] append assistant transcript / 写入助手回复到 transcript 文件 runId=${clientRunId} sessionKey=${sessionKey} agentId=${agentId} hasTranscriptText=${String(Boolean(transcriptReply))} persistedContentBlocks=${persistedContentForAppend?.length ?? 0}`,
                );
                const appended = appendAssistantTranscriptMessage({
                  message: transcriptReply,
                  ...(persistedContentForAppend?.length
                    ? { content: persistedContentForAppend }
                    : {}),
                  sessionId,
                  storePath: latestStorePath,
                  sessionFile: latestEntry?.sessionFile,
                  agentId,
                  createIfMissing: true,
                });
                if (appended.ok) {
                  if (appended.messageId && assistantContent?.length) {
                    await attachManagedOutgoingImagesToMessage({
                      messageId: appended.messageId,
                      blocks: assistantContent,
                    });
                  }
                  message = broadcastAssistantContent?.length
                    ? { ...appended.message, content: broadcastAssistantContent }
                    : appended.message;
                  context.logGateway.info(
                    `[gateway] [webchat-step12-transcript][步骤12-写入助手回复完成] append assistant transcript complete / 助手回复写入 transcript 完成 runId=${clientRunId} sessionKey=${sessionKey} agentId=${agentId} messageId=${appended.messageId ?? "missing"} broadcastContentBlocks=${broadcastAssistantContent?.length ?? 0}`,
                  );
                } else {
                  context.logGateway.warn(
                    `[gateway] [webchat-step12-transcript][步骤12-写入助手回复失败] append assistant transcript failed / 助手回复写入 transcript 失败 runId=${clientRunId} sessionKey=${sessionKey} agentId=${agentId} error=${appended.error ?? "unknown error"}`,
                  );
                  const fallbackAssistantContent =
                    stripManagedOutgoingAssistantContentBlocks(persistedAssistantContent) ??
                    stripManagedOutgoingAssistantContentBlocks(assistantContent);
                  const fallbackText =
                    extractAssistantDisplayText(fallbackAssistantContent) ?? displayReply;
                  const now = Date.now();
                  message = {
                    role: "assistant",
                    ...(fallbackAssistantContent?.length
                      ? { content: fallbackAssistantContent }
                      : fallbackText
                        ? { content: [{ type: "text", text: fallbackText }] }
                        : {}),
                    ...(fallbackText ? { text: fallbackText } : {}),
                    timestamp: now,
                    // Keep this compatible with Pi stopReason enums even though this message isn't
                    // persisted to the transcript due to the append failure.
                    // [中文]: 即使这条消息因为追加失败没有持久化到 transcript，也保持和 Pi stopReason 枚举兼容。
                    stopReason: "stop",
                    usage: { input: 0, output: 0, totalTokens: 0 },
                  };
                }
              }
              broadcastChatFinal({
                context,
                runId: clientRunId,
                sessionKey,
                message,
              });
              context.logGateway.info(
                `[gateway] [webchat-step13-broadcast][步骤13-广播最终状态] broadcast chat final / 广播聊天最终状态给所有订阅者 runId=${clientRunId} sessionKey=${sessionKey} agentId=${agentId} hasMessage=${String(Boolean(message))}`,
              );
            }
          } else {
            context.logGateway.debug(
              `[gateway] [webchat-step11-finalize][步骤11-Agent流式已完成] finalize agent reply / Agent 已运行完毕，流式回复已由运行管线处理 runId=${clientRunId} sessionKey=${sessionKey} agentId=${agentId} deliveredReplyCount=${deliveredReplies.length}`,
            );
            void emitUserTranscriptUpdate();
          }
          if (!context.chatAbortedRuns.has(clientRunId)) {
            context.logGateway.debug(
              `[gateway] [webchat-step14-dedupe][步骤14-记录去重缓存] record success dedupe / 记录本次请求成功结果到去重缓存（防止重复提交） runId=${clientRunId} sessionKey=${sessionKey} agentId=${agentId}`,
            );
            setGatewayDedupeEntry({
              dedupe: context.dedupe,
              key: `chat:${clientRunId}`,
              entry: {
                ts: Date.now(),
                ok: true,
                payload: { runId: clientRunId, status: "ok" as const },
              },
            });
          }
        })
        .catch((err) => {
          context.logGateway.warn(
            `[gateway] [webchat-step6-dispatch][步骤6-分发失败] dispatch inbound failed / 入站消息分发失败 runId=${clientRunId} sessionKey=${sessionKey} agentId=${agentId} agentRunStarted=${String(agentRunStarted)} error=${formatForLog(err)}`,
          );
          void rewriteUserTranscriptMedia().catch((rewriteErr) => {
            context.logGateway.warn(
              `webchat transcript media rewrite failed after error: ${formatForLog(rewriteErr)}`,
            );
          });
          void emitUserTranscriptUpdate().catch((transcriptErr) => {
            context.logGateway.warn(
              `webchat user transcript update failed after error: ${formatForLog(transcriptErr)}`,
            );
          });
          const error = errorShape(ErrorCodes.UNAVAILABLE, String(err));
          setGatewayDedupeEntry({
            dedupe: context.dedupe,
            key: `chat:${clientRunId}`,
            entry: {
              ts: Date.now(),
              ok: false,
              payload: {
                runId: clientRunId,
                status: "error" as const,
                summary: String(err),
              },
              error,
            },
          });
          broadcastChatError({
            context,
            runId: clientRunId,
            sessionKey,
            errorMessage: String(err),
          });
          context.logGateway.warn(
            `[gateway] [webchat-step13-broadcast][步骤13-广播错误状态] broadcast chat error / 广播聊天错误状态给所有订阅者 runId=${clientRunId} sessionKey=${sessionKey} agentId=${agentId}`,
          );
        })
        .finally(() => {
          context.logGateway.info(
            `[gateway] [webchat-step15-cleanup][步骤15-清理运行状态] cleanup chat run / 清理本次运行状态（移除 AbortController、从运行列表注销） runId=${clientRunId} sessionKey=${sessionKey} agentId=${agentId}`,
          );
          activeRunAbort.cleanup();
          context.removeChatRun(clientRunId, clientRunId, sessionKey);
        });
    } catch (err) {
      context.chatAbortControllers.delete(clientRunId);
      context.removeChatRun(clientRunId, clientRunId, sessionKey);
      const error = errorShape(ErrorCodes.UNAVAILABLE, String(err));
      const payload = {
        runId: clientRunId,
        status: "error" as const,
        summary: String(err),
      };
      setGatewayDedupeEntry({
        dedupe: context.dedupe,
        key: `chat:${clientRunId}`,
        entry: {
          ts: Date.now(),
          ok: false,
          payload,
          error,
        },
      });
      respond(false, payload, error, {
        runId: clientRunId,
        error: formatForLog(err),
      });
    }
  },
  /**
   * 🏷️ 【模块分类】: chat.inject RPC (Chat Inject RPC)
   * 💡 【核心职责】: 管理端向指定 session transcript 注入 assistant 消息，并立即广播给 WebChat。
   * ☕ 【Java 视角】: 类似后台管理接口直接追加一条系统生成消息并触发 WebSocket 刷新。
   *
   * @param params chat.inject RPC 原始入参；包含 sessionKey、message 和可选 label。
   * @param respond Gateway RPC 响应回调；返回注入是否成功和新写入的 messageId。
   * @param context Gateway 请求上下文；用于向 WebChat 和节点会话广播注入后的消息。
   */
  "chat.inject": async ({ params, respond, context }) => {
    if (!validateChatInjectParams(params)) {
      respond(
        false,
        undefined,
        errorShape(
          ErrorCodes.INVALID_REQUEST,
          `invalid chat.inject params: ${formatValidationErrors(validateChatInjectParams.errors)}`,
        ),
      );
      return;
    }
    const p = params as {
      sessionKey: string;
      message: string;
      label?: string;
    };

    // Load session to find transcript file
    // [中文]: 加载 session 以定位 transcript 文件。
    const rawSessionKey = p.sessionKey;
    const { cfg, storePath, entry, canonicalKey: sessionKey } = loadSessionEntry(rawSessionKey);
    const sessionId = entry?.sessionId;
    if (!sessionId || !storePath) {
      respond(false, undefined, errorShape(ErrorCodes.INVALID_REQUEST, "session not found"));
      return;
    }

    const appended = appendAssistantTranscriptMessage({
      message: p.message,
      label: p.label,
      sessionId,
      storePath,
      sessionFile: entry?.sessionFile,
      agentId: resolveSessionAgentId({ sessionKey, config: cfg }),
      createIfMissing: true,
    });
    if (!appended.ok || !appended.messageId || !appended.message) {
      respond(
        false,
        undefined,
        errorShape(
          ErrorCodes.UNAVAILABLE,
          `failed to write transcript: ${appended.error ?? "unknown error"}`,
        ),
      );
      return;
    }

    // Broadcast to webchat for immediate UI update
    // [中文]: 广播到 WebChat，让 UI 立即更新。
    const message = projectChatDisplayMessage(appended.message, {
      maxChars: resolveEffectiveChatHistoryMaxChars(cfg),
    });
    const chatPayload = {
      runId: `inject-${appended.messageId}`,
      sessionKey,
      seq: 0,
      state: "final" as const,
      message,
    };
    context.broadcast("chat", chatPayload);
    context.nodeSendToSession(sessionKey, "chat", chatPayload);

    respond(true, { ok: true, messageId: appended.messageId });
  },
};
