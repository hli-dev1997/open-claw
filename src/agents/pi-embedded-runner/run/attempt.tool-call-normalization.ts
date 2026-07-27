import type { AgentMessage, StreamFn } from "@mariozechner/pi-agent-core";
import { parseStreamingJson, streamSimple } from "@mariozechner/pi-ai";
import { formatNodeLog, previewRedactedLogValue } from "../../../logging/node-log.js";
import { visitObjectContentBlocks } from "../../../shared/message-content-blocks.js";
import { normalizeLowercaseStringOrEmpty } from "../../../shared/string-coerce.js";
import { validateAnthropicTurns, validateGeminiTurns } from "../../pi-embedded-helpers.js";
import { sanitizeToolUseResultPairing } from "../../session-transcript-repair.js";
import {
  extractToolCallsFromAssistant,
  sanitizeToolCallIdsForCloudCodeAssist,
  type ToolCallIdMode,
} from "../../tool-call-id.js";
import { hasUnredactedSessionsSpawnAttachments } from "../../tool-call-shared.js";
import { normalizeToolName } from "../../tool-policy.js";
import { shouldAllowProviderOwnedThinkingReplay } from "../../transcript-policy.js";
import type { TranscriptPolicy } from "../../transcript-policy.js";
import { log } from "../logger.js";
import { wrapStreamObjectEvents } from "./stream-wrapper.js";

type UnknownToolLoopGuardState = {
  lastUnknownToolName?: string;
  count: number;
  countedMessages: WeakSet<object>;
};

type ToolCallNodeLogContext = {
  runId?: string;
  sessionKey?: string;
};

function resolveCaseInsensitiveAllowedToolName(
  rawName: string,
  allowedToolNames?: Set<string>,
): string | null {
  if (!allowedToolNames || allowedToolNames.size === 0) {
    return null;
  }
  const folded = normalizeLowercaseStringOrEmpty(rawName);
  let caseInsensitiveMatch: string | null = null;
  for (const name of allowedToolNames) {
    if (normalizeLowercaseStringOrEmpty(name) !== folded) {
      continue;
    }
    if (caseInsensitiveMatch && caseInsensitiveMatch !== name) {
      return null;
    }
    caseInsensitiveMatch = name;
  }
  return caseInsensitiveMatch;
}

function resolveExactAllowedToolName(
  rawName: string,
  allowedToolNames?: Set<string>,
): string | null {
  if (!allowedToolNames || allowedToolNames.size === 0) {
    return null;
  }
  if (allowedToolNames.has(rawName)) {
    return rawName;
  }
  const normalized = normalizeToolName(rawName);
  if (allowedToolNames.has(normalized)) {
    return normalized;
  }
  return (
    resolveCaseInsensitiveAllowedToolName(rawName, allowedToolNames) ??
    resolveCaseInsensitiveAllowedToolName(normalized, allowedToolNames)
  );
}

function buildStructuredToolNameCandidates(rawName: string): string[] {
  const trimmed = rawName.trim();
  if (!trimmed) {
    return [];
  }

  const candidates: string[] = [];
  const seen = new Set<string>();
  const addCandidate = (value: string) => {
    const candidate = value.trim();
    if (!candidate || seen.has(candidate)) {
      return;
    }
    seen.add(candidate);
    candidates.push(candidate);
  };

  addCandidate(trimmed);
  addCandidate(normalizeToolName(trimmed));

  const normalizedDelimiter = trimmed.replace(/\//g, ".");
  addCandidate(normalizedDelimiter);
  addCandidate(normalizeToolName(normalizedDelimiter));

  const segments = normalizedDelimiter
    .split(".")
    .map((segment) => segment.trim())
    .filter(Boolean);
  if (segments.length > 1) {
    for (let index = 1; index < segments.length; index += 1) {
      const suffix = segments.slice(index).join(".");
      addCandidate(suffix);
      addCandidate(normalizeToolName(suffix));
    }
  }

  return candidates;
}

function resolveStructuredAllowedToolName(
  rawName: string,
  allowedToolNames?: Set<string>,
): string | null {
  if (!allowedToolNames || allowedToolNames.size === 0) {
    return null;
  }

  const candidateNames = buildStructuredToolNameCandidates(rawName);
  for (const candidate of candidateNames) {
    if (allowedToolNames.has(candidate)) {
      return candidate;
    }
  }

  for (const candidate of candidateNames) {
    const caseInsensitiveMatch = resolveCaseInsensitiveAllowedToolName(candidate, allowedToolNames);
    if (caseInsensitiveMatch) {
      return caseInsensitiveMatch;
    }
  }

  return null;
}

function inferToolNameFromToolCallId(
  rawId: string | undefined,
  allowedToolNames?: Set<string>,
): string | null {
  if (!rawId || !allowedToolNames || allowedToolNames.size === 0) {
    return null;
  }
  const id = rawId.trim();
  if (!id) {
    return null;
  }

  const candidateTokens = new Set<string>();
  const addToken = (value: string) => {
    const trimmed = value.trim();
    if (!trimmed) {
      return;
    }
    candidateTokens.add(trimmed);
    candidateTokens.add(trimmed.replace(/[:._/-]\d+$/, ""));
    candidateTokens.add(trimmed.replace(/\d+$/, ""));

    const normalizedDelimiter = trimmed.replace(/\//g, ".");
    candidateTokens.add(normalizedDelimiter);
    candidateTokens.add(normalizedDelimiter.replace(/[:._-]\d+$/, ""));
    candidateTokens.add(normalizedDelimiter.replace(/\d+$/, ""));

    for (const prefixPattern of [/^functions?[._-]?/i, /^tools?[._-]?/i]) {
      const stripped = normalizedDelimiter.replace(prefixPattern, "");
      if (stripped !== normalizedDelimiter) {
        candidateTokens.add(stripped);
        candidateTokens.add(stripped.replace(/[:._-]\d+$/, ""));
        candidateTokens.add(stripped.replace(/\d+$/, ""));
      }
    }
  };

  const preColon = id.split(":")[0] ?? id;
  for (const seed of [id, preColon]) {
    addToken(seed);
  }

  let singleMatch: string | null = null;
  for (const candidate of candidateTokens) {
    const matched = resolveStructuredAllowedToolName(candidate, allowedToolNames);
    if (!matched) {
      continue;
    }
    if (singleMatch && singleMatch !== matched) {
      return null;
    }
    singleMatch = matched;
  }

  return singleMatch;
}

function looksLikeMalformedToolNameCounter(rawName: string): boolean {
  const normalizedDelimiter = rawName.trim().replace(/\//g, ".");
  return (
    /^(?:functions?|tools?)[._-]?/i.test(normalizedDelimiter) &&
    /(?:[:._-]\d+|\d+)$/.test(normalizedDelimiter)
  );
}

// 工具意图解析：标准化 LLM 返回的 tool_use/function_call 名称并分派执行器。
// 注意：此函数被流处理+历史修复双路径调用，日志移到上层调用点（stream wrapper）避免历史遍历刷屏
function normalizeToolCallNameForDispatch(
  rawName: string,
  allowedToolNames?: Set<string>,
  rawToolCallId?: string,
): string {
  const trimmed = rawName.trim();
  if (!trimmed) {
    return inferToolNameFromToolCallId(rawToolCallId, allowedToolNames) ?? rawName;
  }
  if (!allowedToolNames || allowedToolNames.size === 0) {
    return trimmed;
  }

  const exact = resolveExactAllowedToolName(trimmed, allowedToolNames);
  if (exact) {
    return exact;
  }
  const inferredFromName = inferToolNameFromToolCallId(trimmed, allowedToolNames);
  if (inferredFromName) {
    return inferredFromName;
  }

  if (looksLikeMalformedToolNameCounter(trimmed)) {
    return trimmed;
  }

  return resolveStructuredAllowedToolName(trimmed, allowedToolNames) ?? trimmed;
}

// 流式工具意图解析：识别 LLM 返回的 content block 中是否包含
// function_call/tool_use/toolCall 标识，触发工具分发逻辑
// 注意：此函数被内层流循环大量调用，日志移到上层调用点以避免碎片重复
function isToolCallBlockType(type: unknown): boolean {
  return type === "toolCall" || type === "toolUse" || type === "functionCall";
}

function normalizePromptJsonToolArguments(value: unknown): Record<string, unknown> | undefined {
  if (value && typeof value === "object" && !Array.isArray(value)) {
    return value as Record<string, unknown>;
  }
  if (typeof value === "string") {
    const parsed = parseStreamingJson(value);
    return parsed && typeof parsed === "object" && !Array.isArray(parsed)
      ? (parsed as Record<string, unknown>)
      : undefined;
  }
  return undefined;
}

function normalizePromptJsonToolCall(
  value: unknown,
  nameHint?: string,
): PromptJsonToolCall | undefined {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return undefined;
  }
  const record = value as Record<string, unknown>;
  const candidate =
    record.tool_call && typeof record.tool_call === "object"
      ? (record.tool_call as Record<string, unknown>)
      : record;
  const name =
    typeof candidate.name === "string"
      ? candidate.name.trim()
      : typeof candidate.tool === "string"
        ? candidate.tool.trim()
        : nameHint?.trim() || "";
  if (!name) {
    return undefined;
  }
  const hintedPayload = nameHint && candidate === record ? record : {};
  const args = normalizePromptJsonToolArguments(
    candidate.arguments ?? candidate.input ?? hintedPayload,
  );
  if (!args) {
    return undefined;
  }
  return { name, arguments: args };
}

function parsePromptJsonToolCallText(text: string): PromptJsonToolCall | undefined {
  const trimmed = text.trim();
  if (!trimmed) {
    return undefined;
  }
  const tagged = [...trimmed.matchAll(/<tool_call\b([^>]*)>\s*([\s\S]*?)\s*<\/tool_call>/gi)]
    .map((match) => ({
      text: match[2]?.trim(),
      nameHint: parsePromptJsonToolCallTagNameHint(match[1] ?? ""),
    }))
    .filter((value): value is { text: string; nameHint?: string } => Boolean(value.text));
  const openTagMatch = [...trimmed.matchAll(/<tool_call\b([^>]*)>\s*([\s\S]*)$/gi)].at(-1);
  const openTagged = openTagMatch
    ? {
        text: openTagMatch[2]?.trim(),
        nameHint: parsePromptJsonToolCallTagNameHint(openTagMatch[1] ?? ""),
      }
    : undefined;
  // 解决tool兼容问题：兼容模型可能输出说明文字、重复 <tool_call> 起始标签或漏掉 </tool_call>，这里按候选 payload 逐个解析。
  const candidates = [...tagged.reverse(), openTagged, { text: trimmed }].filter(
    (value): value is { text: string; nameHint?: string } => Boolean(value?.text),
  );
  for (const candidate of candidates) {
    for (const normalizedCandidate of buildPromptJsonToolCallJsonCandidates(candidate.text)) {
      const toolCall = normalizePromptJsonToolCall(
        parseStreamingJson(normalizedCandidate),
        candidate.nameHint,
      );
      if (toolCall) {
        return toolCall;
      }
    }
  }
  return undefined;
}

function parsePromptJsonToolCallTagNameHint(attributes: string): string | undefined {
  const match = attributes.match(/\b(?:name|tool)\s*=\s*["']?([^"'\s>]+)["']?/i);
  return match?.[1]?.trim() || undefined;
}

function buildPromptJsonToolCallJsonCandidates(text: string): string[] {
  const normalized = text
    .replace(/^(?:\s*<tool_call\b[^>]*>\s*)+/i, "")
    .replace(/^```(?:json)?\s*/i, "")
    .replace(/\s*```$/i, "")
    .trim();
  const candidates = [normalized];
  // 解决tool兼容问题：兼容模型有时把 JSON 包在说明文字或代码块里，只提取完整对象再解析。
  for (const jsonObject of extractBalancedJsonObjects(normalized)) {
    candidates.push(jsonObject);
  }
  return [...new Set(candidates.filter(Boolean))];
}

function extractBalancedJsonObjects(text: string): string[] {
  const results: string[] = [];
  let start = -1;
  let depth = 0;
  let inString = false;
  let escaped = false;
  for (let index = 0; index < text.length; index += 1) {
    const char = text[index];
    if (inString) {
      if (escaped) {
        escaped = false;
      } else if (char === "\\") {
        escaped = true;
      } else if (char === '"') {
        inString = false;
      }
      continue;
    }
    if (char === '"') {
      inString = true;
      continue;
    }
    if (char === "{") {
      if (depth === 0) {
        start = index;
      }
      depth += 1;
      continue;
    }
    if (char !== "}" || depth === 0) {
      continue;
    }
    depth -= 1;
    if (depth === 0 && start >= 0) {
      results.push(text.slice(start, index + 1));
      start = -1;
    }
  }
  return results;
}

function normalizePromptJsonAliasKey(value: string): string {
  return value
    .trim()
    .toLowerCase()
    .replace(/[\s.-]+/g, "_");
}

function coercePromptJsonWeatherAliasArguments(
  args: Record<string, unknown>,
  fallbackQuery?: string,
): Record<string, unknown> {
  const query =
    typeof args.query === "string" && args.query.trim()
      ? args.query.trim()
      : typeof args.location === "string" && args.location.trim()
        ? `${args.location.trim()} weather`
        : typeof args.city === "string" && args.city.trim()
          ? `${args.city.trim()} weather`
          : fallbackQuery?.trim() || "current weather";
  return { query };
}

function coercePromptJsonWebSearchArguments(
  args: Record<string, unknown>,
  fallbackQuery?: string,
): Record<string, unknown> {
  const query = typeof args.query === "string" && args.query.trim() ? args.query.trim() : "";
  if (query) {
    return { ...args, query };
  }
  const fallback = fallbackQuery?.trim();
  // 解决tool兼容问题：prompt-json 文本兜底路径也要补齐 web_search.query，避免模型漏参后触发 query required。
  return fallback ? { ...args, query: fallback } : args;
}

function resolvePromptJsonTextToolCallName(
  toolCall: PromptJsonToolCall,
  allowedToolNames?: Set<string>,
  aliasFallbackQuery?: string,
): PromptJsonToolCall | undefined {
  const resolvedName = resolveExactAllowedToolName(toolCall.name, allowedToolNames);
  if (!allowedToolNames || resolvedName) {
    const name = resolvedName ?? toolCall.name;
    return {
      ...toolCall,
      name,
      arguments:
        name === "web_search"
          ? coercePromptJsonWebSearchArguments(toolCall.arguments, aliasFallbackQuery)
          : toolCall.arguments,
    };
  }
  const aliasKey = normalizePromptJsonAliasKey(toolCall.name);
  if (
    allowedToolNames.has("web_search") &&
    (aliasKey === "weather" || aliasKey === "weather_search" || aliasKey === "forecast")
  ) {
    return {
      name: "web_search",
      arguments: coercePromptJsonWeatherAliasArguments(toolCall.arguments, aliasFallbackQuery),
    };
  }
  return undefined;
}

function promptJsonTextFromUnknownContent(content: unknown): string {
  if (typeof content === "string") {
    return content;
  }
  if (!Array.isArray(content)) {
    return "";
  }
  return content
    .map((block) => {
      if (
        block &&
        typeof block === "object" &&
        (block as { type?: unknown }).type === "text" &&
        typeof (block as { text?: unknown }).text === "string"
      ) {
        return (block as { text: string }).text;
      }
      return "";
    })
    .filter(Boolean)
    .join("\n");
}

function getPromptJsonAliasFallbackQueryFromContext(context: unknown): string | undefined {
  const messages = (context as { messages?: unknown })?.messages;
  if (!Array.isArray(messages)) {
    return undefined;
  }
  for (let index = messages.length - 1; index >= 0; index -= 1) {
    const message = messages[index] as { role?: unknown; content?: unknown } | undefined;
    if (message?.role !== "user") {
      continue;
    }
    const text = promptJsonTextFromUnknownContent(message.content).trim();
    if (text) {
      return text;
    }
  }
  return undefined;
}

type PromptJsonToolErrorBlock = {
  toolName: string;
  text: string;
};

function getPromptJsonToolNameFromUnknownMessage(message: unknown): string {
  return typeof (message as { toolName?: unknown } | undefined)?.toolName === "string"
    ? (message as { toolName: string }).toolName
    : "";
}

function collectPromptJsonToolErrorBlocksFromContext(context: unknown): PromptJsonToolErrorBlock[] {
  const messages = (context as { messages?: unknown })?.messages;
  if (!Array.isArray(messages)) {
    return [];
  }
  const results: PromptJsonToolErrorBlock[] = [];
  for (const message of messages) {
    if (!message || typeof message !== "object") {
      continue;
    }
    const record = message as { role?: unknown; isError?: unknown; content?: unknown };
    if (record.role !== "toolResult" || record.isError !== true) {
      continue;
    }
    results.push({
      toolName: getPromptJsonToolNameFromUnknownMessage(message),
      text: promptJsonTextFromUnknownContent(record.content),
    });
  }
  return results;
}

function getPromptJsonBlockedToolRetryMessage(
  toolCall: PromptJsonToolCall,
  priorErrors: PromptJsonToolErrorBlock[],
): string | undefined {
  const hasPriorError = (toolName: string, pattern: RegExp) =>
    priorErrors.some((entry) => entry.toolName === toolName && pattern.test(entry.text));
  // 解决工具错误循环问题：兼容模型可能忽略工具错误继续输出同类 <tool_call>，这里把确定失败的 web 工具循环改成可见文本。
  if (
    toolCall.name === "web_search" &&
    hasPriorError("web_search", /SearXNG base URL is not configured|query required/i)
  ) {
    return "web_search 当前无法继续执行：搜索服务未配置或缺少有效查询。我会停止重复调用该工具，并基于已有信息回复。";
  }
  if (
    toolCall.name === "web_fetch" &&
    hasPriorError("web_fetch", /Blocked: resolves to private\/internal\/special-use IP address/i)
  ) {
    return "web_fetch 当前无法继续执行：目标地址被安全策略拦截为内部或特殊用途地址。我会停止重复抓取该地址，并基于已有信息回复。";
  }
  return undefined;
}

// 核心执行链路断点25：转换单条 assistant message 中的工具调用文本；观察 text block、parsed toolCall、message blocks；掌握标准：能说明一条模型消息如何被改写成工具调用消息。
function convertPromptJsonTextToolCallInMessage(
  message: unknown,
  allowedToolNames?: Set<string>,
  logContext?: { provider?: unknown; model?: unknown; source: string },
  aliasFallbackQuery?: string,
  priorToolErrors?: PromptJsonToolErrorBlock[],
): boolean {
  // 解决tool兼容问题：有些路径会把 <tool_call> 当普通 assistant 文本返回，这里兜底转成可执行 toolCall。
  if (!message || typeof message !== "object") {
    return false;
  }
  const record = message as { role?: unknown; content?: unknown };
  if (record.role !== "assistant" || !Array.isArray(record.content)) {
    return false;
  }
  const textBlocks = record.content.filter(
    (block): block is { type: "text"; text: string } =>
      Boolean(block) &&
      typeof block === "object" &&
      (block as { type?: unknown }).type === "text" &&
      typeof (block as { text?: unknown }).text === "string",
  );
  if (textBlocks.length !== record.content.length) {
    return false;
  }
  const text = textBlocks.map((block) => block.text).join("\n");
  const toolCall = parsePromptJsonToolCallText(text);
  if (!toolCall) {
    if (/<\s*tool_call\b/i.test(text)) {
      log.warn(
        `prompt-json assistant text contained tool_call but parsing failed: source=${logContext?.source ?? "unknown"} provider=${String(logContext?.provider ?? "unknown")} model=${String(logContext?.model ?? "unknown")}`,
      );
    }
    return false;
  }
  const resolvedToolCall = resolvePromptJsonTextToolCallName(
    toolCall,
    allowedToolNames,
    aliasFallbackQuery,
  );
  if (!resolvedToolCall) {
    log.warn(
      `prompt-json assistant text tool call is not registered locally: source=${logContext?.source ?? "unknown"} provider=${String(logContext?.provider ?? "unknown")} model=${String(logContext?.model ?? "unknown")} tool=${toolCall.name}`,
    );
    return false;
  }
  if (resolvedToolCall.name !== toolCall.name) {
    log.info(
      `prompt-json assistant text tool alias normalized: source=${logContext?.source ?? "unknown"} provider=${String(logContext?.provider ?? "unknown")} model=${String(logContext?.model ?? "unknown")} tool=${toolCall.name} normalizedTool=${resolvedToolCall.name}`,
    );
  }
  const retryBlockMessage = getPromptJsonBlockedToolRetryMessage(
    resolvedToolCall,
    priorToolErrors ?? [],
  );
  if (retryBlockMessage) {
    log.warn(
      `prompt-json assistant text blocked repeated failing tool call: source=${logContext?.source ?? "unknown"} provider=${String(logContext?.provider ?? "unknown")} model=${String(logContext?.model ?? "unknown")} tool=${resolvedToolCall.name}`,
    );
    record.content = [{ type: "text", text: retryBlockMessage }];
    return true;
  }
  record.content = [
    {
      type: "toolCall",
      id: `call_prompt_json_${Math.random().toString(36).slice(2, 12)}`,
      name: resolvedToolCall.name,
      arguments: resolvedToolCall.arguments,
    },
  ];
  log.info(
    `prompt-json assistant text converted to structured tool call: source=${logContext?.source ?? "unknown"} provider=${String(logContext?.provider ?? "unknown")} model=${String(logContext?.model ?? "unknown")} tool=${resolvedToolCall.name}`,
  );
  return true;
}

const REPLAY_TOOL_CALL_NAME_MAX_CHARS = 64;

type ReplayToolCallBlock = {
  type?: unknown;
  id?: unknown;
  name?: unknown;
  input?: unknown;
  arguments?: unknown;
};

type PromptJsonToolCall = {
  name: string;
  arguments: Record<string, unknown>;
};

type ReplayToolCallSanitizeReport = {
  messages: AgentMessage[];
  droppedAssistantMessages: number;
};

type AnthropicToolResultContentBlock = {
  type?: unknown;
  toolUseId?: unknown;
  toolCallId?: unknown;
  tool_use_id?: unknown;
  tool_call_id?: unknown;
};

function isThinkingLikeReplayBlock(block: unknown): boolean {
  if (!block || typeof block !== "object") {
    return false;
  }
  const type = (block as { type?: unknown }).type;
  return type === "thinking" || type === "redacted_thinking";
}

function isReplaySafeThinkingTurn(content: unknown[], allowedToolNames?: Set<string>): boolean {
  const seenToolCallIds = new Set<string>();
  for (const block of content) {
    if (!isReplayToolCallBlock(block)) {
      continue;
    }
    const replayBlock = block;
    const toolCallId = typeof replayBlock.id === "string" ? replayBlock.id.trim() : "";
    if (
      !replayToolCallHasInput(replayBlock) ||
      !toolCallId ||
      seenToolCallIds.has(toolCallId) ||
      hasUnredactedSessionsSpawnAttachments(replayBlock)
    ) {
      return false;
    }
    seenToolCallIds.add(toolCallId);
    const rawName = typeof replayBlock.name === "string" ? replayBlock.name : "";
    const resolvedName = resolveReplayToolCallName(rawName, toolCallId, allowedToolNames);
    if (!resolvedName || replayBlock.name !== resolvedName) {
      return false;
    }
  }
  return true;
}

function isReplayToolCallBlock(block: unknown): block is ReplayToolCallBlock {
  if (!block || typeof block !== "object") {
    return false;
  }
  return isToolCallBlockType((block as { type?: unknown }).type);
}

function replayToolCallHasInput(block: ReplayToolCallBlock): boolean {
  const hasInput = "input" in block ? block.input !== undefined && block.input !== null : false;
  const hasArguments =
    "arguments" in block ? block.arguments !== undefined && block.arguments !== null : false;
  return hasInput || hasArguments;
}

function replayToolCallNonEmptyString(value: unknown): value is string {
  return typeof value === "string" && value.trim().length > 0;
}

function resolveReplayToolCallName(
  rawName: string,
  rawId: string,
  allowedToolNames?: Set<string>,
): string | null {
  if (rawName.length > REPLAY_TOOL_CALL_NAME_MAX_CHARS * 2) {
    return null;
  }
  const normalized = normalizeToolCallNameForDispatch(rawName, allowedToolNames, rawId);
  const trimmed = normalized.trim();
  if (!trimmed || trimmed.length > REPLAY_TOOL_CALL_NAME_MAX_CHARS || /\s/.test(trimmed)) {
    return null;
  }
  if (!allowedToolNames || allowedToolNames.size === 0) {
    return trimmed;
  }
  return resolveExactAllowedToolName(trimmed, allowedToolNames);
}

function sanitizeReplayToolCallInputs(
  messages: AgentMessage[],
  allowedToolNames?: Set<string>,
  allowProviderOwnedThinkingReplay?: boolean,
): ReplayToolCallSanitizeReport {
  let changed = false;
  let droppedAssistantMessages = 0;
  const out: AgentMessage[] = [];
  const claimedReplaySafeToolCallIds = new Set<string>();

  for (const message of messages) {
    if (!message || typeof message !== "object" || message.role !== "assistant") {
      out.push(message);
      continue;
    }
    if (!Array.isArray(message.content)) {
      out.push(message);
      continue;
    }
    if (
      allowProviderOwnedThinkingReplay &&
      message.content.some((block) => isThinkingLikeReplayBlock(block)) &&
      message.content.some((block) => isReplayToolCallBlock(block))
    ) {
      const replaySafeToolCalls = extractToolCallsFromAssistant(message);
      if (
        isReplaySafeThinkingTurn(message.content, allowedToolNames) &&
        replaySafeToolCalls.every((toolCall) => !claimedReplaySafeToolCallIds.has(toolCall.id))
      ) {
        for (const toolCall of replaySafeToolCalls) {
          claimedReplaySafeToolCallIds.add(toolCall.id);
        }
        out.push(message);
      } else {
        changed = true;
        droppedAssistantMessages += 1;
      }
      continue;
    }

    const nextContent: typeof message.content = [];
    let messageChanged = false;

    for (const block of message.content) {
      if (!isReplayToolCallBlock(block)) {
        nextContent.push(block);
        continue;
      }
      const replayBlock = block as ReplayToolCallBlock;

      if (!replayToolCallHasInput(replayBlock) || !replayToolCallNonEmptyString(replayBlock.id)) {
        changed = true;
        messageChanged = true;
        continue;
      }

      const rawName = typeof replayBlock.name === "string" ? replayBlock.name : "";
      const resolvedName = resolveReplayToolCallName(rawName, replayBlock.id, allowedToolNames);
      if (!resolvedName) {
        changed = true;
        messageChanged = true;
        continue;
      }

      if (replayBlock.name !== resolvedName) {
        nextContent.push({ ...(block as object), name: resolvedName } as typeof block);
        changed = true;
        messageChanged = true;
        continue;
      }
      nextContent.push(block);
    }

    if (messageChanged) {
      changed = true;
      if (nextContent.length > 0) {
        out.push({ ...message, content: nextContent });
      } else {
        droppedAssistantMessages += 1;
      }
      continue;
    }

    out.push(message);
  }

  return {
    messages: changed ? out : messages,
    droppedAssistantMessages,
  };
}

function extractAnthropicReplayToolResultIds(block: AnthropicToolResultContentBlock): string[] {
  const ids: string[] = [];
  for (const value of [block.toolUseId, block.toolCallId, block.tool_use_id, block.tool_call_id]) {
    if (typeof value !== "string") {
      continue;
    }
    const trimmed = value.trim();
    if (!trimmed || ids.includes(trimmed)) {
      continue;
    }
    ids.push(trimmed);
  }
  return ids;
}

function isSignedThinkingReplayAssistantSpan(message: AgentMessage | undefined): boolean {
  if (!message || typeof message !== "object" || message.role !== "assistant") {
    return false;
  }
  const content = (message as { content?: unknown }).content;
  if (!Array.isArray(content)) {
    return false;
  }
  return (
    content.some((block) => isThinkingLikeReplayBlock(block)) &&
    content.some((block) => isReplayToolCallBlock(block))
  );
}

function sanitizeAnthropicReplayToolResults(
  messages: AgentMessage[],
  options?: {
    disallowEmbeddedUserToolResultsForSignedThinkingReplay?: boolean;
  },
): AgentMessage[] {
  let changed = false;
  const out: AgentMessage[] = [];
  const disallowEmbeddedUserToolResultsForSignedThinkingReplay =
    options?.disallowEmbeddedUserToolResultsForSignedThinkingReplay === true;

  for (let index = 0; index < messages.length; index += 1) {
    const message = messages[index];
    if (!message || typeof message !== "object" || message.role !== "user") {
      out.push(message);
      continue;
    }
    if (!Array.isArray(message.content)) {
      out.push(message);
      continue;
    }

    const previous = messages[index - 1];
    const shouldStripEmbeddedToolResults =
      disallowEmbeddedUserToolResultsForSignedThinkingReplay &&
      isSignedThinkingReplayAssistantSpan(previous);
    const validToolUseIds = new Set<string>();
    if (previous && typeof previous === "object" && previous.role === "assistant") {
      const previousContent = (previous as { content?: unknown }).content;
      if (Array.isArray(previousContent)) {
        for (const block of previousContent) {
          if (!block || typeof block !== "object") {
            continue;
          }
          const typedBlock = block as { type?: unknown; id?: unknown };
          if (!isToolCallBlockType(typedBlock.type) || typeof typedBlock.id !== "string") {
            continue;
          }
          const trimmedId = typedBlock.id.trim();
          if (trimmedId) {
            validToolUseIds.add(trimmedId);
          }
        }
      }
    }

    const nextContent = message.content.filter((block) => {
      if (!block || typeof block !== "object") {
        return true;
      }
      const typedBlock = block as AnthropicToolResultContentBlock;
      if (typedBlock.type !== "toolResult" && typedBlock.type !== "tool") {
        return true;
      }
      if (shouldStripEmbeddedToolResults) {
        changed = true;
        return false;
      }
      const resultIds = extractAnthropicReplayToolResultIds(typedBlock);
      if (resultIds.length === 0) {
        changed = true;
        return false;
      }
      return validToolUseIds.size > 0 && resultIds.some((id) => validToolUseIds.has(id));
    });

    if (nextContent.length === message.content.length) {
      out.push(message);
      continue;
    }

    changed = true;
    if (nextContent.length > 0) {
      out.push({ ...message, content: nextContent });
      continue;
    }

    out.push({
      ...message,
      content: [{ type: "text", text: "[tool results omitted]" }],
    } as AgentMessage);
  }

  return changed ? out : messages;
}

function assistantTurnHasReplayToolCall(message: AgentMessage): boolean {
  if (!message || typeof message !== "object" || message.role !== "assistant") {
    return false;
  }
  const content = (message as { content?: unknown }).content;
  if (!Array.isArray(content)) {
    return false;
  }
  return content.some((block) => isReplayToolCallBlock(block));
}

function stripTrailingAssistantPrefillTurns(messages: AgentMessage[]): AgentMessage[] {
  let end = messages.length;
  while (end > 0) {
    const message = messages[end - 1];
    if (!message || typeof message !== "object" || message.role !== "assistant") {
      break;
    }
    if (assistantTurnHasReplayToolCall(message)) {
      break;
    }
    end -= 1;
  }
  return end === messages.length ? messages : messages.slice(0, end);
}

function normalizeToolCallIdsInMessage(message: unknown): void {
  if (!message || typeof message !== "object") {
    return;
  }
  const content = (message as { content?: unknown }).content;
  if (!Array.isArray(content)) {
    return;
  }

  const usedIds = new Set<string>();
  for (const block of content) {
    if (!block || typeof block !== "object") {
      continue;
    }
    const typedBlock = block as { type?: unknown; id?: unknown };
    if (!isToolCallBlockType(typedBlock.type) || typeof typedBlock.id !== "string") {
      continue;
    }
    const trimmedId = typedBlock.id.trim();
    if (!trimmedId) {
      continue;
    }
    usedIds.add(trimmedId);
  }

  let fallbackIndex = 1;
  const assignedIds = new Set<string>();
  for (const block of content) {
    if (!block || typeof block !== "object") {
      continue;
    }
    const typedBlock = block as { type?: unknown; id?: unknown };
    if (!isToolCallBlockType(typedBlock.type)) {
      continue;
    }
    if (typeof typedBlock.id === "string") {
      const trimmedId = typedBlock.id.trim();
      if (trimmedId) {
        if (!assignedIds.has(trimmedId)) {
          if (typedBlock.id !== trimmedId) {
            typedBlock.id = trimmedId;
          }
          assignedIds.add(trimmedId);
          continue;
        }
      }
    }

    let fallbackId = "";
    while (!fallbackId || usedIds.has(fallbackId) || assignedIds.has(fallbackId)) {
      fallbackId = `call_auto_${fallbackIndex++}`;
    }
    typedBlock.id = fallbackId;
    usedIds.add(fallbackId);
    assignedIds.add(fallbackId);
  }
}

function trimWhitespaceFromToolCallNamesInMessage(
  message: unknown,
  allowedToolNames?: Set<string>,
): void {
  visitObjectContentBlocks(message, (block) => {
    const typedBlock = block as { type?: unknown; name?: unknown; id?: unknown };
    if (!isToolCallBlockType(typedBlock.type)) {
      return;
    }
    const rawId = typeof typedBlock.id === "string" ? typedBlock.id : undefined;
    if (typeof typedBlock.name === "string") {
      const normalized = normalizeToolCallNameForDispatch(typedBlock.name, allowedToolNames, rawId);
      if (normalized !== typedBlock.name) {
        typedBlock.name = normalized;
      }
      return;
    }
    const inferred = inferToolNameFromToolCallId(rawId, allowedToolNames);
    if (inferred) {
      typedBlock.name = inferred;
    }
  });
  normalizeToolCallIdsInMessage(message);
}

function classifyToolCallMessage(
  message: unknown,
  allowedToolNames?: Set<string>,
):
  | { kind: "none" }
  | { kind: "allowed" }
  | { kind: "incomplete" }
  | { kind: "unknown"; toolName: string } {
  if (!message || typeof message !== "object" || !allowedToolNames || allowedToolNames.size === 0) {
    return { kind: "none" };
  }
  const content = (message as { content?: unknown }).content;
  if (!Array.isArray(content)) {
    return { kind: "none" };
  }

  let unknownToolName: string | undefined;
  let sawToolCall = false;
  let sawAllowedToolCall = false;
  let sawIncompleteToolCall = false;
  for (const block of content) {
    if (!block || typeof block !== "object") {
      continue;
    }
    const typedBlock = block as { type?: unknown; name?: unknown };
    if (!isToolCallBlockType(typedBlock.type)) {
      continue;
    }
    sawToolCall = true;
    const rawName = typeof typedBlock.name === "string" ? typedBlock.name.trim() : "";
    if (!rawName) {
      sawIncompleteToolCall = true;
      continue;
    }
    if (resolveExactAllowedToolName(rawName, allowedToolNames)) {
      sawAllowedToolCall = true;
      continue;
    }
    const normalizedUnknownToolName = normalizeToolName(rawName);
    if (!unknownToolName) {
      unknownToolName = normalizedUnknownToolName;
      continue;
    }
    if (unknownToolName !== normalizedUnknownToolName) {
      sawIncompleteToolCall = true;
    }
  }

  if (!sawToolCall) {
    return { kind: "none" };
  }
  if (sawAllowedToolCall) {
    return { kind: "allowed" };
  }
  if (sawIncompleteToolCall) {
    return { kind: "incomplete" };
  }
  return unknownToolName ? { kind: "unknown", toolName: unknownToolName } : { kind: "incomplete" };
}

function rewriteUnknownToolLoopMessage(message: unknown, toolName: string): void {
  if (!message || typeof message !== "object") {
    return;
  }
  (message as { content?: unknown }).content = [
    {
      type: "text",
      text: `I can't use the tool "${toolName}" here because it isn't available. I need to stop retrying it and answer without that tool.`,
    },
  ];
}

function guardUnknownToolLoopInMessage(
  message: unknown,
  state: UnknownToolLoopGuardState,
  params: {
    allowedToolNames?: Set<string>;
    threshold?: number;
    countAttempt: boolean;
    resetOnAllowedTool?: boolean;
    resetOnMissingUnknownTool?: boolean;
  },
): boolean {
  const threshold = params.threshold;
  if (threshold === undefined || threshold <= 0) {
    return false;
  }

  const toolCallState = classifyToolCallMessage(message, params.allowedToolNames);
  if (toolCallState.kind === "allowed") {
    if (params.resetOnAllowedTool === true) {
      state.lastUnknownToolName = undefined;
      state.count = 0;
    }
    return false;
  }
  if (toolCallState.kind !== "unknown") {
    if (params.countAttempt && params.resetOnMissingUnknownTool !== false) {
      state.lastUnknownToolName = undefined;
      state.count = 0;
    }
    return false;
  }
  const unknownToolName = toolCallState.toolName;

  if (!params.countAttempt) {
    if (state.lastUnknownToolName === unknownToolName && state.count > threshold) {
      rewriteUnknownToolLoopMessage(message, unknownToolName);
    }
    return false;
  }

  if (message && typeof message === "object") {
    if (state.countedMessages.has(message)) {
      if (state.lastUnknownToolName === unknownToolName && state.count > threshold) {
        rewriteUnknownToolLoopMessage(message, unknownToolName);
      }
      return true;
    }
    state.countedMessages.add(message);
  }

  if (state.lastUnknownToolName === unknownToolName) {
    state.count += 1;
  } else {
    state.lastUnknownToolName = unknownToolName;
    state.count = 1;
  }

  if (state.count > threshold) {
    rewriteUnknownToolLoopMessage(message, unknownToolName);
  }
  return true;
}

function wrapStreamTrimToolCallNames(
  stream: ReturnType<typeof streamSimple>,
  allowedToolNames?: Set<string>,
  options?: {
    unknownToolThreshold?: number;
    state?: UnknownToolLoopGuardState;
    runId?: string;
    sessionKey?: string;
  },
): ReturnType<typeof streamSimple> {
  const unknownToolGuardState = options?.state ?? {
    count: 0,
    countedMessages: new WeakSet<object>(),
  };
  let streamAttemptAlreadyCounted = false;
  const originalResult = stream.result.bind(stream);
  stream.result = async () => {
    const message = await originalResult();
    trimWhitespaceFromToolCallNamesInMessage(message, allowedToolNames);
    guardUnknownToolLoopInMessage(message, unknownToolGuardState, {
      allowedToolNames,
      threshold: options?.unknownToolThreshold,
      countAttempt: !streamAttemptAlreadyCounted,
      resetOnAllowedTool: true,
    });
    if (message && typeof message === "object") {
      const content = (message as { content?: unknown[] }).content;
      if (Array.isArray(content)) {
        const toolBlocks = content.filter(
          (block) =>
            block &&
            typeof block === "object" &&
            isToolCallBlockType((block as { type?: unknown }).type),
        );
        if (toolBlocks.length > 0) {
          const toolNames = toolBlocks
            .map((block) => {
              const rawName = (block as { name?: unknown }).name;
              return typeof rawName === "string" && rawName.trim() ? rawName.trim() : "unknown";
            })
            .join(",");
          console.log(
            formatNodeLog({
              id: "tool.batch.detect",
              name: "检测工具调用",
              summary: "本轮模型请求执行工具",
              fields: {
                runId: options?.runId,
                sessionKey: options?.sessionKey,
                toolCalls: toolBlocks.length,
                tools: toolNames,
              },
            }),
          );
          console.log(
            formatNodeLog({
              id: "tool.batch.start",
              name: "开始工具批次",
              summary: "执行当前 assistant message 请求的一组工具",
              fields: {
                runId: options?.runId,
                sessionKey: options?.sessionKey,
                toolCalls: toolBlocks.length,
                tools: toolNames,
              },
            }),
          );
          for (const toolBlock of toolBlocks) {
            const tb = toolBlock as {
              name?: string;
              id?: string;
              input?: unknown;
              arguments?: unknown;
            };
            const paramsRaw = tb.input ?? tb.arguments;
            const paramsSerialized =
              typeof paramsRaw === "string"
                ? paramsRaw
                : (() => {
                    try {
                      return JSON.stringify(paramsRaw);
                    } catch {
                      return String(paramsRaw);
                    }
                  })();
            console.log(
              formatNodeLog({
                id: "model.tool_choice",
                name: "模型选择工具",
                summary: "LLM 返回 tool_call，准备执行本地工具",
                fields: {
                  runId: options?.runId,
                  sessionKey: options?.sessionKey,
                  tool: tb.name ?? "unknown",
                  callId: tb.id ?? "unknown",
                  paramsPreview: previewRedactedLogValue(paramsRaw ?? "", 120),
                  paramsChars: paramsSerialized?.length ?? 0,
                },
              }),
            );
          }
        }
      }
    }
    return message;
  };

  wrapStreamObjectEvents(stream, (event) => {
    trimWhitespaceFromToolCallNamesInMessage(event.partial, allowedToolNames);
    trimWhitespaceFromToolCallNamesInMessage(event.message, allowedToolNames);
    if (event.message && typeof event.message === "object") {
      const countedStreamAttempt = guardUnknownToolLoopInMessage(
        event.message,
        unknownToolGuardState,
        {
          allowedToolNames,
          threshold: options?.unknownToolThreshold,
          countAttempt: !streamAttemptAlreadyCounted,
          resetOnAllowedTool: true,
          resetOnMissingUnknownTool: false,
        },
      );
      streamAttemptAlreadyCounted ||= countedStreamAttempt;
    }
    guardUnknownToolLoopInMessage(event.partial, unknownToolGuardState, {
      allowedToolNames,
      threshold: options?.unknownToolThreshold,
      countAttempt: false,
    });
  });

  return stream;
}

export function wrapStreamFnTrimToolCallNames(
  baseFn: StreamFn,
  allowedToolNames?: Set<string>,
  guardOptions?: { unknownToolThreshold?: number } & ToolCallNodeLogContext,
): StreamFn {
  const unknownToolGuardState: UnknownToolLoopGuardState = {
    count: 0,
    countedMessages: new WeakSet<object>(),
  };
  return (model, context, streamOptions) => {
    const maybeStream = baseFn(model, context, streamOptions);
    if (maybeStream && typeof maybeStream === "object" && "then" in maybeStream) {
      return Promise.resolve(maybeStream).then((stream) =>
        wrapStreamTrimToolCallNames(stream, allowedToolNames, {
          unknownToolThreshold: guardOptions?.unknownToolThreshold,
          state: unknownToolGuardState,
          runId: guardOptions?.runId,
          sessionKey: guardOptions?.sessionKey,
        }),
      );
    }
    return wrapStreamTrimToolCallNames(maybeStream, allowedToolNames, {
      unknownToolThreshold: guardOptions?.unknownToolThreshold,
      state: unknownToolGuardState,
      runId: guardOptions?.runId,
      sessionKey: guardOptions?.sessionKey,
    });
  };
}

// 核心执行链路断点24：包装 streamFn 并转换 prompt-json 工具调用；观察 allowedToolNames、baseFn 输出、转换后的 message；掌握标准：能说明兼容层如何让 runner 识别公司 API 返回的工具调用。
export function wrapStreamFnConvertPromptJsonToolText(
  baseFn: StreamFn,
  allowedToolNames?: Set<string>,
): StreamFn {
  return (model, context, streamOptions) => {
    const compat = (model as { compat?: { toolCallMode?: unknown } }).compat;
    // 解决tool兼容问题：只对 prompt-json completions 包装，避免影响原生支持 tools 的模型。
    if (
      (model as { api?: unknown }).api !== "openai-completions" ||
      compat?.toolCallMode !== "prompt-json"
    ) {
      return baseFn(model, context, streamOptions);
    }
    const aliasFallbackQuery = getPromptJsonAliasFallbackQueryFromContext(context);
    const priorToolErrors = collectPromptJsonToolErrorBlocksFromContext(context);
    const wrap = (stream: ReturnType<typeof streamSimple>): ReturnType<typeof streamSimple> => {
      const originalResult = stream.result.bind(stream);
      stream.result = async () => {
        const message = await originalResult();
        convertPromptJsonTextToolCallInMessage(
          message,
          allowedToolNames,
          {
            provider: (model as { provider?: unknown }).provider,
            model: (model as { id?: unknown }).id,
            source: "result",
          },
          aliasFallbackQuery,
          priorToolErrors,
        );
        return message;
      };
      wrapStreamObjectEvents(stream, (event) => {
        convertPromptJsonTextToolCallInMessage(
          event.partial,
          allowedToolNames,
          {
            provider: (model as { provider?: unknown }).provider,
            model: (model as { id?: unknown }).id,
            source: "partial",
          },
          aliasFallbackQuery,
          priorToolErrors,
        );
        convertPromptJsonTextToolCallInMessage(
          event.message,
          allowedToolNames,
          {
            provider: (model as { provider?: unknown }).provider,
            model: (model as { id?: unknown }).id,
            source: "message",
          },
          aliasFallbackQuery,
          priorToolErrors,
        );
      });
      return stream;
    };
    const maybeStream = baseFn(model, context, streamOptions);
    if (maybeStream && typeof maybeStream === "object" && "then" in maybeStream) {
      return Promise.resolve(maybeStream).then(wrap);
    }
    return wrap(maybeStream);
  };
}

export function sanitizeReplayToolCallIdsForStream(params: {
  messages: AgentMessage[];
  mode: ToolCallIdMode;
  allowedToolNames?: Set<string>;
  preserveNativeAnthropicToolUseIds?: boolean;
  preserveReplaySafeThinkingToolCallIds?: boolean;
  repairToolUseResultPairing?: boolean;
}): AgentMessage[] {
  const sanitized = sanitizeToolCallIdsForCloudCodeAssist(params.messages, params.mode, {
    preserveNativeAnthropicToolUseIds: params.preserveNativeAnthropicToolUseIds,
    preserveReplaySafeThinkingToolCallIds: params.preserveReplaySafeThinkingToolCallIds,
    allowedToolNames: params.allowedToolNames,
  });
  if (!params.repairToolUseResultPairing) {
    return sanitized;
  }
  return sanitizeToolUseResultPairing(sanitized);
}

export function wrapStreamFnSanitizeMalformedToolCalls(
  baseFn: StreamFn,
  allowedToolNames?: Set<string>,
  transcriptPolicy?: Pick<
    TranscriptPolicy,
    "validateGeminiTurns" | "validateAnthropicTurns" | "preserveSignatures" | "dropThinkingBlocks"
  >,
): StreamFn {
  return (model, context, options) => {
    const ctx = context as unknown as { messages?: unknown };
    const messages = ctx?.messages;
    if (!Array.isArray(messages)) {
      return baseFn(model, context, options);
    }
    const allowProviderOwnedThinkingReplay = shouldAllowProviderOwnedThinkingReplay({
      modelApi: (model as { api?: unknown })?.api as string | null | undefined,
      policy: {
        validateAnthropicTurns: transcriptPolicy?.validateAnthropicTurns === true,
        preserveSignatures: transcriptPolicy?.preserveSignatures === true,
        dropThinkingBlocks: transcriptPolicy?.dropThinkingBlocks === true,
      },
    });
    const sanitized = sanitizeReplayToolCallInputs(
      messages as AgentMessage[],
      allowedToolNames,
      allowProviderOwnedThinkingReplay,
    );
    const replayInputsChanged = sanitized.messages !== messages;
    let nextMessages = replayInputsChanged
      ? sanitizeToolUseResultPairing(sanitized.messages)
      : sanitized.messages;
    let strippedTrailingAssistantPrefill = false;
    if (transcriptPolicy?.validateAnthropicTurns) {
      nextMessages = sanitizeAnthropicReplayToolResults(nextMessages, {
        disallowEmbeddedUserToolResultsForSignedThinkingReplay: allowProviderOwnedThinkingReplay,
      });
    }
    if (transcriptPolicy?.validateAnthropicTurns || transcriptPolicy?.validateGeminiTurns) {
      const beforeStrip = nextMessages;
      nextMessages = stripTrailingAssistantPrefillTurns(nextMessages);
      strippedTrailingAssistantPrefill ||= nextMessages !== beforeStrip;
    }
    if (nextMessages === messages) {
      return baseFn(model, context, options);
    }
    if (
      sanitized.droppedAssistantMessages > 0 ||
      transcriptPolicy?.validateAnthropicTurns ||
      strippedTrailingAssistantPrefill
    ) {
      if (transcriptPolicy?.validateGeminiTurns) {
        nextMessages = validateGeminiTurns(nextMessages);
      }
      if (transcriptPolicy?.validateAnthropicTurns) {
        nextMessages = validateAnthropicTurns(nextMessages);
      }
    }
    const nextContext = {
      ...(context as unknown as Record<string, unknown>),
      messages: nextMessages,
    } as unknown;
    return baseFn(model, nextContext as typeof context, options);
  };
}
