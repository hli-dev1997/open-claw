import { randomUUID } from "node:crypto";
import type { StreamFn } from "@mariozechner/pi-agent-core";
import {
  calculateCost,
  createAssistantMessageEventStream,
  getEnvApiKey,
  parseStreamingJson,
  type Api,
  type Context,
  type Model,
} from "@mariozechner/pi-ai";
import { convertMessages } from "@mariozechner/pi-ai/openai-completions";
import OpenAI, { AzureOpenAI } from "openai";
import type { ChatCompletion, ChatCompletionChunk } from "openai/resources/chat/completions.js";
import type {
  FunctionTool,
  ResponseCreateParamsStreaming,
  ResponseFunctionCallOutputItemList,
  ResponseInput,
  ResponseInputMessageContentList,
} from "openai/resources/responses/responses.js";
import type { ModelCompatConfig } from "../config/types.models.js";
import { createSubsystemLogger } from "../logging/subsystem.js";
import type { ProviderRuntimeModel } from "../plugins/provider-runtime-model.types.js";
import { resolveProviderTransportTurnStateWithPlugin } from "../plugins/provider-runtime.js";
import { buildCopilotDynamicHeaders, hasCopilotVisionInput } from "./copilot-dynamic-headers.js";
import { detectOpenAICompletionsCompat } from "./openai-completions-compat.js";
import { flattenCompletionMessagesToStringContent } from "./openai-completions-string-content.js";
import { resolveOpenAIReasoningEffortMap } from "./openai-reasoning-compat.js";
import {
  normalizeOpenAIReasoningEffort,
  resolveOpenAIReasoningEffortForModel,
  type OpenAIApiReasoningEffort,
  type OpenAIReasoningEffort,
} from "./openai-reasoning-effort.js";
import {
  applyOpenAIResponsesPayloadPolicy,
  resolveOpenAIResponsesPayloadPolicy,
} from "./openai-responses-payload-policy.js";
import {
  findOpenAIStrictToolSchemaDiagnostics,
  normalizeOpenAIStrictToolParameters,
  resolveOpenAIStrictToolFlagForInventory,
  resolveOpenAIStrictToolSetting,
} from "./openai-tool-schema.js";
import { resolveProviderRequestPolicyConfig } from "./provider-request-config.js";
import {
  buildGuardedModelFetch,
  resolveModelRequestTimeoutMs,
} from "./provider-transport-fetch.js";
import { stripSystemPromptCacheBoundary } from "./system-prompt-cache-boundary.js";
import { transformTransportMessages } from "./transport-message-transform.js";
import { mergeTransportMetadata, sanitizeTransportPayloadText } from "./transport-stream-shared.js";

const DEFAULT_AZURE_OPENAI_API_VERSION = "2024-12-01-preview";
const OPENAI_CODEX_RESPONSES_EMPTY_INPUT_TEXT = " ";
const log = createSubsystemLogger("openai-transport");

type BaseStreamOptions = {
  temperature?: number;
  maxTokens?: number;
  signal?: AbortSignal;
  apiKey?: string;
  cacheRetention?: "none" | "short" | "long";
  sessionId?: string;
  onPayload?: (payload: unknown, model: Model<Api>) => unknown;
  headers?: Record<string, string>;
};

type OpenAIResponsesOptions = BaseStreamOptions & {
  reasoning?: OpenAIReasoningEffort;
  reasoningEffort?: OpenAIReasoningEffort;
  reasoningSummary?: "auto" | "detailed" | "concise" | null;
  serviceTier?: ResponseCreateParamsStreaming["service_tier"];
};

type OpenAICompletionsOptions = BaseStreamOptions & {
  toolChoice?:
    | "auto"
    | "none"
    | "required"
    | {
        type: "function";
        function: {
          name: string;
        };
      };
  reasoning?: OpenAIReasoningEffort;
  reasoningEffort?: OpenAIReasoningEffort;
};

type OpenAIModeCompatInput = Omit<ModelCompatConfig, "thinkingFormat"> & {
  thinkingFormat?: string;
};

type OpenAIModeModel = Omit<Model<Api>, "compat"> & {
  compat?: OpenAIModeCompatInput | null;
};

type MutableAssistantOutput = {
  role: "assistant";
  content: Array<Record<string, unknown>>;
  api: Api;
  provider: string;
  model: string;
  usage: {
    input: number;
    output: number;
    cacheRead: number;
    cacheWrite: number;
    totalTokens: number;
    cost: { input: number; output: number; cacheRead: number; cacheWrite: number; total: number };
  };
  stopReason: string;
  timestamp: number;
  responseId?: string;
  errorMessage?: string;
};

export { sanitizeTransportPayloadText } from "./transport-stream-shared.js";

function stringifyUnknown(value: unknown, fallback = ""): string {
  if (typeof value === "string") {
    return value;
  }
  if (typeof value === "number" || typeof value === "boolean") {
    return String(value);
  }
  return fallback;
}

function stringifyJsonLike(value: unknown, fallback = ""): string {
  if (typeof value === "string") {
    return value;
  }
  if (value && typeof value === "object") {
    return JSON.stringify(value);
  }
  if (typeof value === "number" || typeof value === "boolean") {
    return String(value);
  }
  return fallback;
}

function getServiceTierCostMultiplier(serviceTier: ResponseCreateParamsStreaming["service_tier"]) {
  switch (serviceTier) {
    case "flex":
      return 0.5;
    case "priority":
      return 2;
    default:
      return 1;
  }
}

function applyServiceTierPricing(
  usage: MutableAssistantOutput["usage"],
  serviceTier?: ResponseCreateParamsStreaming["service_tier"],
): void {
  const multiplier = getServiceTierCostMultiplier(serviceTier);
  if (multiplier === 1) {
    return;
  }
  usage.cost.input *= multiplier;
  usage.cost.output *= multiplier;
  usage.cost.cacheRead *= multiplier;
  usage.cost.cacheWrite *= multiplier;
  usage.cost.total =
    usage.cost.input + usage.cost.output + usage.cost.cacheRead + usage.cost.cacheWrite;
}

export function resolveAzureOpenAIApiVersion(env = process.env): string {
  return env.AZURE_OPENAI_API_VERSION?.trim() || DEFAULT_AZURE_OPENAI_API_VERSION;
}

function shortHash(value: string): string {
  let hash = 0;
  for (let i = 0; i < value.length; i += 1) {
    hash = (hash * 31 + value.charCodeAt(i)) | 0;
  }
  return Math.abs(hash).toString(36);
}

function encodeTextSignatureV1(id: string, phase?: "commentary" | "final_answer"): string {
  return JSON.stringify({ v: 1, id, ...(phase ? { phase } : {}) });
}

function parseTextSignature(
  signature: string | undefined,
): { id: string; phase?: "commentary" | "final_answer" } | undefined {
  if (!signature) {
    return undefined;
  }
  if (signature.startsWith("{")) {
    try {
      const parsed = JSON.parse(signature) as { v?: unknown; id?: unknown; phase?: unknown };
      if (parsed.v === 1 && typeof parsed.id === "string") {
        return parsed.phase === "commentary" || parsed.phase === "final_answer"
          ? { id: parsed.id, phase: parsed.phase }
          : { id: parsed.id };
      }
    } catch {
      // Keep legacy plain-string behavior below.
    }
  }
  return { id: signature };
}

function convertResponsesMessages(
  model: Model<Api>,
  context: Context,
  allowedToolCallProviders: Set<string>,
  options?: { includeSystemPrompt?: boolean; supportsDeveloperRole?: boolean },
): ResponseInput {
  const messages: ResponseInput = [];
  const normalizeIdPart = (part: string) => {
    const sanitized = part.replace(/[^a-zA-Z0-9_-]/g, "_");
    const normalized = sanitized.length > 64 ? sanitized.slice(0, 64) : sanitized;
    return normalized.replace(/_+$/, "");
  };
  const buildForeignResponsesItemId = (itemId: string) => {
    const normalized = `fc_${shortHash(itemId)}`;
    return normalized.length > 64 ? normalized.slice(0, 64) : normalized;
  };
  const normalizeToolCallId = (
    id: string,
    _targetModel: Model<Api>,
    source: { provider: string; api: Api },
  ) => {
    if (!allowedToolCallProviders.has(model.provider)) {
      return normalizeIdPart(id);
    }
    if (!id.includes("|")) {
      return normalizeIdPart(id);
    }
    const [callId, itemId] = id.split("|");
    const normalizedCallId = normalizeIdPart(callId);
    const isForeignToolCall = source.provider !== model.provider || source.api !== model.api;
    let normalizedItemId = isForeignToolCall
      ? buildForeignResponsesItemId(itemId)
      : normalizeIdPart(itemId);
    if (!normalizedItemId.startsWith("fc_")) {
      normalizedItemId = normalizeIdPart(`fc_${normalizedItemId}`);
    }
    return `${normalizedCallId}|${normalizedItemId}`;
  };
  const transformedMessages = transformTransportMessages(
    context.messages,
    model,
    normalizeToolCallId,
  );
  const includeSystemPrompt = options?.includeSystemPrompt ?? true;
  if (includeSystemPrompt && context.systemPrompt) {
    messages.push({
      role: model.reasoning && options?.supportsDeveloperRole !== false ? "developer" : "system",
      content: sanitizeTransportPayloadText(stripSystemPromptCacheBoundary(context.systemPrompt)),
    });
  }
  let msgIndex = 0;
  for (const msg of transformedMessages) {
    if (msg.role === "user") {
      if (typeof msg.content === "string") {
        messages.push({
          role: "user",
          content: [{ type: "input_text", text: sanitizeTransportPayloadText(msg.content) }],
        });
      } else {
        const content = (
          msg.content.map((item) =>
            item.type === "text"
              ? { type: "input_text", text: sanitizeTransportPayloadText(item.text) }
              : {
                  type: "input_image",
                  detail: "auto",
                  image_url: `data:${item.mimeType};base64,${item.data}`,
                },
          ) as ResponseInputMessageContentList
        ).filter((item) => model.input.includes("image") || item.type !== "input_image");
        if (content.length > 0) {
          messages.push({ role: "user", content });
        }
      }
    } else if (msg.role === "assistant") {
      const output: ResponseInput = [];
      const isDifferentModel =
        msg.model !== model.id && msg.provider === model.provider && msg.api === model.api;
      for (const block of msg.content) {
        if (block.type === "thinking") {
          if (block.thinkingSignature) {
            output.push(JSON.parse(block.thinkingSignature));
          }
        } else if (block.type === "text") {
          let msgId = parseTextSignature(block.textSignature)?.id ?? `msg_${msgIndex}`;
          if (msgId.length > 64) {
            msgId = `msg_${shortHash(msgId)}`;
          }
          output.push({
            type: "message",
            role: "assistant",
            content: [
              {
                type: "output_text",
                text: sanitizeTransportPayloadText(block.text),
                annotations: [],
              },
            ],
            status: "completed",
            id: msgId,
            phase: parseTextSignature(block.textSignature)?.phase,
          });
        } else if (block.type === "toolCall") {
          const [callId, itemIdRaw] = block.id.split("|");
          const itemId = isDifferentModel && itemIdRaw?.startsWith("fc_") ? undefined : itemIdRaw;
          output.push({
            type: "function_call",
            id: itemId,
            call_id: callId,
            name: block.name,
            arguments:
              typeof block.arguments === "string"
                ? block.arguments
                : JSON.stringify(block.arguments ?? {}),
          });
        }
      }
      if (output.length > 0) {
        messages.push(...output);
      }
    } else if (msg.role === "toolResult") {
      const textResult = msg.content
        .filter((item) => item.type === "text")
        .map((item) => item.text)
        .join("\n");
      const hasImages = msg.content.some((item) => item.type === "image");
      const [callId] = msg.toolCallId.split("|");
      messages.push({
        type: "function_call_output",
        call_id: callId,
        output:
          hasImages && model.input.includes("image")
            ? ([
                ...(textResult
                  ? [{ type: "input_text", text: sanitizeTransportPayloadText(textResult) }]
                  : []),
                ...msg.content
                  .filter((item) => item.type === "image")
                  .map((item) => ({
                    type: "input_image",
                    detail: "auto",
                    image_url: `data:${item.mimeType};base64,${item.data}`,
                  })),
              ] as ResponseFunctionCallOutputItemList)
            : sanitizeTransportPayloadText(textResult || "(see attached image)"),
      });
    }
    msgIndex += 1;
  }
  return messages;
}

function convertResponsesTools(
  tools: NonNullable<Context["tools"]>,
  model: OpenAIModeModel,
  options?: { strict?: boolean | null },
): FunctionTool[] {
  const strict = resolveOpenAIStrictToolFlagWithDiagnostics(tools, options?.strict, {
    transport: "responses",
    model,
  });
  return tools.map((tool): FunctionTool => {
    const base = {
      type: "function" as const,
      name: tool.name,
      description: tool.description,
      parameters: normalizeOpenAIStrictToolParameters(tool.parameters, strict === true) as Record<
        string,
        unknown
      >,
    };
    return strict === undefined ? (base as FunctionTool) : { ...base, strict };
  });
}

function resolveOpenAIStrictToolFlagWithDiagnostics(
  tools: NonNullable<Context["tools"]>,
  strictSetting: boolean | null | undefined,
  context: { transport: "responses" | "completions"; model: OpenAIModeModel },
): boolean | undefined {
  const strict = resolveOpenAIStrictToolFlagForInventory(tools, strictSetting);
  if (strictSetting === true && strict === false && log.isEnabled("debug", "any")) {
    const diagnostics = findOpenAIStrictToolSchemaDiagnostics(tools);
    const sample = diagnostics.slice(0, 5).map((entry) => ({
      tool: entry.toolName ?? `tool[${entry.toolIndex}]`,
      violations: entry.violations.slice(0, 8),
    }));
    log.debug(
      `OpenAI ${context.transport} tool schema strict mode downgraded to strict=false for ` +
        `${context.model.provider ?? "unknown"}/${context.model.id ?? "unknown"} ` +
        `because ${diagnostics.length} tool schema(s) are not strict-compatible`,
      {
        transport: context.transport,
        provider: context.model.provider,
        model: context.model.id,
        incompatibleToolCount: diagnostics.length,
        sample,
      },
    );
  }
  return strict;
}

async function processResponsesStream(
  openaiStream: AsyncIterable<unknown>,
  output: MutableAssistantOutput,
  stream: { push(event: unknown): void },
  model: Model<Api>,
  options?: {
    serviceTier?: ResponseCreateParamsStreaming["service_tier"];
    applyServiceTierPricing?: (
      usage: MutableAssistantOutput["usage"],
      serviceTier?: ResponseCreateParamsStreaming["service_tier"],
    ) => void;
  },
) {
  let currentItem: Record<string, unknown> | null = null;
  let currentBlock: Record<string, unknown> | null = null;
  const blockIndex = () => output.content.length - 1;
  for await (const rawEvent of openaiStream) {
    const event = rawEvent as Record<string, unknown>;
    const type = stringifyUnknown(event.type);
    if (type === "response.created") {
      output.responseId = stringifyUnknown((event.response as { id?: string } | undefined)?.id);
    } else if (type === "response.output_item.added") {
      const item = event.item as Record<string, unknown>;
      if (item.type === "reasoning") {
        currentItem = item;
        currentBlock = { type: "thinking", thinking: "" };
        output.content.push(currentBlock);
        stream.push({ type: "thinking_start", contentIndex: blockIndex(), partial: output });
      } else if (item.type === "message") {
        currentItem = item;
        currentBlock = { type: "text", text: "" };
        output.content.push(currentBlock);
        stream.push({ type: "text_start", contentIndex: blockIndex(), partial: output });
      } else if (item.type === "function_call") {
        currentItem = item;
        currentBlock = {
          type: "toolCall",
          id: `${stringifyUnknown(item.call_id)}|${stringifyUnknown(item.id)}`,
          name: stringifyUnknown(item.name),
          arguments: {},
          partialJson: stringifyJsonLike(item.arguments),
        };
        output.content.push(currentBlock);
        stream.push({ type: "toolcall_start", contentIndex: blockIndex(), partial: output });
      }
    } else if (type === "response.reasoning_summary_text.delta") {
      if (currentItem?.type === "reasoning" && currentBlock?.type === "thinking") {
        currentBlock.thinking = `${stringifyUnknown(currentBlock.thinking)}${stringifyUnknown(event.delta)}`;
        stream.push({
          type: "thinking_delta",
          contentIndex: blockIndex(),
          delta: stringifyUnknown(event.delta),
          partial: output,
        });
      }
    } else if (type === "response.output_text.delta" || type === "response.refusal.delta") {
      if (currentItem?.type === "message" && currentBlock?.type === "text") {
        currentBlock.text = `${stringifyUnknown(currentBlock.text)}${stringifyUnknown(event.delta)}`;
        stream.push({
          type: "text_delta",
          contentIndex: blockIndex(),
          delta: stringifyUnknown(event.delta),
          partial: output,
        });
      }
    } else if (type === "response.function_call_arguments.delta") {
      if (currentItem?.type === "function_call" && currentBlock?.type === "toolCall") {
        currentBlock.partialJson = `${stringifyJsonLike(currentBlock.partialJson)}${stringifyJsonLike(event.delta)}`;
        currentBlock.arguments = parseStreamingJson(stringifyJsonLike(currentBlock.partialJson));
        stream.push({
          type: "toolcall_delta",
          contentIndex: blockIndex(),
          delta: stringifyJsonLike(event.delta),
          partial: output,
        });
      }
    } else if (type === "response.output_item.done") {
      const item = event.item as Record<string, unknown>;
      if (item.type === "reasoning" && currentBlock?.type === "thinking") {
        const summary = Array.isArray(item.summary)
          ? item.summary
              .map((part) => {
                const summaryPart = part as { text?: string };
                return summaryPart.text ?? "";
              })
              .join("\n\n")
          : "";
        currentBlock.thinking = summary;
        currentBlock.thinkingSignature = JSON.stringify(item);
        stream.push({
          type: "thinking_end",
          contentIndex: blockIndex(),
          content: stringifyUnknown(currentBlock.thinking),
          partial: output,
        });
        currentBlock = null;
      } else if (item.type === "message" && currentBlock?.type === "text") {
        const content = Array.isArray(item.content) ? item.content : [];
        currentBlock.text = content
          .map((part) => {
            const contentPart = part as { type?: string; text?: string; refusal?: string };
            return contentPart.type === "output_text"
              ? (contentPart.text ?? "")
              : (contentPart.refusal ?? "");
          })
          .join("");
        currentBlock.textSignature = encodeTextSignatureV1(
          stringifyUnknown(item.id),
          (item.phase as "commentary" | "final_answer" | undefined) ?? undefined,
        );
        stream.push({
          type: "text_end",
          contentIndex: blockIndex(),
          content: stringifyUnknown(currentBlock.text),
          partial: output,
        });
        currentBlock = null;
      } else if (item.type === "function_call") {
        const args =
          currentBlock?.type === "toolCall" && currentBlock.partialJson
            ? parseStreamingJson(stringifyJsonLike(currentBlock.partialJson, "{}"))
            : parseStreamingJson(stringifyJsonLike(item.arguments, "{}"));
        stream.push({
          type: "toolcall_end",
          contentIndex: blockIndex(),
          toolCall: {
            type: "toolCall",
            id: `${stringifyUnknown(item.call_id)}|${stringifyUnknown(item.id)}`,
            name: stringifyUnknown(item.name),
            arguments: args,
          },
          partial: output,
        });
        currentBlock = null;
      }
    } else if (type === "response.completed") {
      const response = event.response as Record<string, unknown> | undefined;
      if (typeof response?.id === "string") {
        output.responseId = response.id;
      }
      const usage = response?.usage as
        | {
            input_tokens?: number;
            output_tokens?: number;
            total_tokens?: number;
            input_tokens_details?: { cached_tokens?: number };
            service_tier?: ResponseCreateParamsStreaming["service_tier"];
            status?: string;
          }
        | undefined;
      if (usage) {
        const cachedTokens = usage.input_tokens_details?.cached_tokens || 0;
        output.usage = {
          input: (usage.input_tokens || 0) - cachedTokens,
          output: usage.output_tokens || 0,
          cacheRead: cachedTokens,
          cacheWrite: 0,
          totalTokens: usage.total_tokens || 0,
          cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 },
        };
      }
      calculateCost(model as never, output.usage as never);
      if (options?.applyServiceTierPricing) {
        options.applyServiceTierPricing(
          output.usage,
          (response?.service_tier as ResponseCreateParamsStreaming["service_tier"] | undefined) ??
            options.serviceTier,
        );
      }
      output.stopReason = mapResponsesStopReason(response?.status as string | undefined);
      if (
        output.content.some((block) => block.type === "toolCall") &&
        output.stopReason === "stop"
      ) {
        output.stopReason = "toolUse";
      }
    } else if (type === "error") {
      throw new Error(
        `Error Code ${stringifyUnknown(event.code, "unknown")}: ${stringifyUnknown(event.message, "Unknown error")}`,
      );
    } else if (type === "response.failed") {
      const response = event.response as
        | {
            error?: { code?: string; message?: string };
            incomplete_details?: { reason?: string };
          }
        | undefined;
      const msg = response?.error
        ? `${response.error.code || "unknown"}: ${response.error.message || "no message"}`
        : response?.incomplete_details?.reason
          ? `incomplete: ${response.incomplete_details.reason}`
          : "Unknown error (no error details in response)";
      throw new Error(msg);
    }
  }
}

function mapResponsesStopReason(status: string | undefined): string {
  if (!status) {
    return "stop";
  }
  switch (status) {
    case "completed":
      return "stop";
    case "incomplete":
      return "length";
    case "failed":
    case "cancelled":
      return "error";
    case "in_progress":
    case "queued":
      return "stop";
    default:
      throw new Error(`Unhandled stop reason: ${status}`);
  }
}

function buildOpenAIClientHeaders(
  model: Model<Api>,
  context: Context,
  optionHeaders?: Record<string, string>,
  turnHeaders?: Record<string, string>,
): Record<string, string> {
  const providerHeaders = { ...model.headers };
  if (model.provider === "github-copilot") {
    Object.assign(
      providerHeaders,
      buildCopilotDynamicHeaders({
        messages: context.messages,
        hasImages: hasCopilotVisionInput(context.messages),
      }),
    );
  }
  const callerHeaders = { ...optionHeaders, ...turnHeaders };
  const headers = resolveProviderRequestPolicyConfig({
    provider: model.provider,
    api: model.api,
    baseUrl: model.baseUrl,
    capability: "llm",
    transport: "stream",
    providerHeaders,
    callerHeaders: Object.keys(callerHeaders).length > 0 ? callerHeaders : undefined,
    precedence: "caller-wins",
  }).headers;
  return headers ?? {};
}

function resolveProviderTransportTurnState(
  model: Model<Api>,
  params: {
    sessionId?: string;
    turnId: string;
    attempt: number;
    transport: "stream" | "websocket";
  },
) {
  return resolveProviderTransportTurnStateWithPlugin({
    provider: model.provider,
    context: {
      provider: model.provider,
      modelId: model.id,
      model: model as ProviderRuntimeModel,
      sessionId: params.sessionId,
      turnId: params.turnId,
      attempt: params.attempt,
      transport: params.transport,
    },
  });
}

function resolveOpenAISdkTimeoutMs(model: Model<Api>): number | undefined {
  return resolveModelRequestTimeoutMs(model, undefined);
}

function buildOpenAISdkClientOptions(model: Model<Api>): { timeout?: number } {
  const timeout = resolveOpenAISdkTimeoutMs(model);
  return timeout === undefined ? {} : { timeout };
}

function buildOpenAISdkRequestOptions(
  model: Model<Api>,
  signal?: AbortSignal,
): { signal?: AbortSignal; timeout?: number } | undefined {
  const timeout = resolveOpenAISdkTimeoutMs(model);
  if (timeout === undefined && !signal) {
    return undefined;
  }
  return {
    ...(signal ? { signal } : {}),
    ...(timeout !== undefined ? { timeout } : {}),
  };
}

function createOpenAIResponsesClient(
  model: Model<Api>,
  context: Context,
  apiKey: string,
  optionHeaders?: Record<string, string>,
  turnHeaders?: Record<string, string>,
) {
  return new OpenAI({
    apiKey,
    baseURL: model.baseUrl,
    dangerouslyAllowBrowser: true,
    defaultHeaders: buildOpenAIClientHeaders(model, context, optionHeaders, turnHeaders),
    fetch: buildGuardedModelFetch(model),
    ...buildOpenAISdkClientOptions(model),
  });
}

export function createOpenAIResponsesTransportStreamFn(): StreamFn {
  return (model, context, options) => {
    const eventStream = createAssistantMessageEventStream();
    const stream = eventStream as unknown as { push(event: unknown): void; end(): void };
    void (async () => {
      const output: MutableAssistantOutput = {
        role: "assistant" as const,
        content: [],
        api: model.api,
        provider: model.provider,
        model: model.id,
        usage: {
          input: 0,
          output: 0,
          cacheRead: 0,
          cacheWrite: 0,
          totalTokens: 0,
          cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 },
        },
        stopReason: "stop",
        timestamp: Date.now(),
      };
      try {
        const apiKey = options?.apiKey || getEnvApiKey(model.provider) || "";
        const turnState = resolveProviderTransportTurnState(model, {
          sessionId: options?.sessionId,
          turnId: randomUUID(),
          attempt: 1,
          transport: "stream",
        });
        const client = createOpenAIResponsesClient(
          model,
          context,
          apiKey,
          options?.headers,
          turnState?.headers,
        );
        let params = buildOpenAIResponsesParams(
          model,
          context,
          options as OpenAIResponsesOptions,
          turnState?.metadata,
        );
        const nextParams = await options?.onPayload?.(params, model);
        if (nextParams !== undefined) {
          params = nextParams as typeof params;
        }
        if (!isOpenAICodexResponsesModel(model)) {
          params = mergeTransportMetadata(params, turnState?.metadata);
        }
        params = sanitizeOpenAICodexResponsesParams(
          model,
          params as Record<string, unknown>,
        ) as typeof params;
        const responseStream = (await client.responses.create(
          params as never,
          buildOpenAISdkRequestOptions(model, options?.signal),
        )) as unknown as AsyncIterable<unknown>;
        stream.push({ type: "start", partial: output as never });
        await processResponsesStream(responseStream, output, stream, model, {
          serviceTier: (options as OpenAIResponsesOptions | undefined)?.serviceTier,
          applyServiceTierPricing,
        });
        if (options?.signal?.aborted) {
          throw new Error("Request was aborted");
        }
        if (output.stopReason === "aborted" || output.stopReason === "error") {
          throw new Error("An unknown error occurred");
        }
        stream.push({ type: "done", reason: output.stopReason as never, message: output as never });
        stream.end();
      } catch (error) {
        output.stopReason = options?.signal?.aborted ? "aborted" : "error";
        output.errorMessage = error instanceof Error ? error.message : JSON.stringify(error);
        stream.push({ type: "error", reason: output.stopReason as never, error: output as never });
        stream.end();
      }
    })();
    return eventStream as unknown as ReturnType<StreamFn>;
  };
}

function resolveCacheRetention(cacheRetention: string | undefined): "short" | "long" | "none" {
  if (cacheRetention === "short" || cacheRetention === "long" || cacheRetention === "none") {
    return cacheRetention;
  }
  if (typeof process !== "undefined" && process.env.PI_CACHE_RETENTION === "long") {
    return "long";
  }
  return "short";
}

function getPromptCacheRetention(
  baseUrl: string | undefined,
  cacheRetention: "short" | "long" | "none",
) {
  if (cacheRetention !== "long") {
    return undefined;
  }
  return baseUrl?.includes("api.openai.com") ? "24h" : undefined;
}

function resolveOpenAIReasoningEffort(
  options: OpenAIResponsesOptions | undefined,
): OpenAIApiReasoningEffort {
  return normalizeOpenAIReasoningEffort(
    options?.reasoningEffort ?? options?.reasoning ?? "high",
  ) as OpenAIApiReasoningEffort;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value && typeof value === "object" && !Array.isArray(value));
}

function hasResponsesWebSearchTool(tools: unknown): boolean {
  if (!Array.isArray(tools)) {
    return false;
  }
  return tools.some((tool) => {
    if (!isRecord(tool)) {
      return false;
    }
    if (tool.type === "web_search") {
      return true;
    }
    if (tool.type === "function" && tool.name === "web_search") {
      return true;
    }
    const fn = tool.function;
    return isRecord(fn) && fn.name === "web_search";
  });
}

function raiseMinimalReasoningForResponsesWebSearch(params: {
  model: Model<Api>;
  effort: OpenAIApiReasoningEffort;
  tools: unknown;
}): OpenAIApiReasoningEffort {
  if (params.effort !== "minimal" || !hasResponsesWebSearchTool(params.tools)) {
    return params.effort;
  }
  for (const effort of ["low", "medium", "high"] as const) {
    const resolved = resolveOpenAIReasoningEffortForModel({
      model: params.model,
      effort,
    });
    if (resolved && resolved !== "none" && resolved !== "minimal") {
      return resolved;
    }
  }
  return params.effort;
}

function isOpenAICodexResponsesModel(model: Model<Api>): boolean {
  return model.provider === "openai-codex" && model.api === "openai-codex-responses";
}

function isNativeOpenAICodexResponsesBaseUrl(baseUrl?: string): boolean {
  const trimmed = typeof baseUrl === "string" ? baseUrl.trim() : "";
  if (!trimmed) {
    return false;
  }
  try {
    const url = new URL(trimmed);
    if (url.protocol !== "http:" && url.protocol !== "https:") {
      return false;
    }
    if (url.hostname.toLowerCase() !== "chatgpt.com") {
      return false;
    }
    const pathname = url.pathname.replace(/\/+$/u, "").toLowerCase();
    return [
      "/backend-api",
      "/backend-api/v1",
      "/backend-api/codex",
      "/backend-api/codex/v1",
    ].includes(pathname);
  } catch {
    return false;
  }
}

function usesNativeOpenAICodexResponsesBackend(model: Model<Api>): boolean {
  return isOpenAICodexResponsesModel(model) && isNativeOpenAICodexResponsesBaseUrl(model.baseUrl);
}

const OPENAI_CODEX_RESPONSES_UNSUPPORTED_PARAMS = [
  "max_output_tokens",
  "metadata",
  "prompt_cache_retention",
  "service_tier",
  "temperature",
] as const;

function sanitizeOpenAICodexResponsesParams<T extends Record<string, unknown>>(
  model: Model<Api>,
  params: T,
): T {
  if (!usesNativeOpenAICodexResponsesBackend(model)) {
    return params;
  }
  for (const key of OPENAI_CODEX_RESPONSES_UNSUPPORTED_PARAMS) {
    delete params[key];
  }
  return params;
}

function buildOpenAICodexResponsesInstructions(context: Context): string | undefined {
  if (!context.systemPrompt) {
    return undefined;
  }
  return sanitizeTransportPayloadText(stripSystemPromptCacheBoundary(context.systemPrompt));
}

function ensureOpenAICodexResponsesInput(messages: ResponseInput, context: Context): void {
  if (messages.length > 0 || !context.systemPrompt) {
    return;
  }
  const text = buildOpenAICodexResponsesInstructions(context);
  if (!text) {
    throw new Error(
      "OpenAI Codex Responses requires non-empty input when only systemPrompt is provided.",
    );
  }
  messages.push({
    role: "user",
    content: [{ type: "input_text", text: OPENAI_CODEX_RESPONSES_EMPTY_INPUT_TEXT }],
  });
}

export function buildOpenAIResponsesParams(
  model: Model<Api>,
  context: Context,
  options: OpenAIResponsesOptions | undefined,
  metadata?: Record<string, string>,
) {
  const isCodexResponses = isOpenAICodexResponsesModel(model);
  const compat = getCompat(model as OpenAIModeModel);
  const supportsDeveloperRole =
    typeof compat.supportsDeveloperRole === "boolean" ? compat.supportsDeveloperRole : undefined;
  const messages = convertResponsesMessages(
    model,
    context,
    new Set(["openai", "openai-codex", "opencode", "azure-openai-responses"]),
    { includeSystemPrompt: !isCodexResponses, supportsDeveloperRole },
  );
  if (isCodexResponses) {
    ensureOpenAICodexResponsesInput(messages, context);
  }
  const cacheRetention = resolveCacheRetention(options?.cacheRetention);
  const payloadPolicy = resolveOpenAIResponsesPayloadPolicy(model, {
    storeMode: "disable",
  });
  const params: OpenAIResponsesRequestParams = {
    model: model.id,
    input: messages,
    stream: true,
    prompt_cache_key: cacheRetention === "none" ? undefined : options?.sessionId,
    prompt_cache_retention: getPromptCacheRetention(model.baseUrl, cacheRetention),
    ...(isCodexResponses ? { instructions: buildOpenAICodexResponsesInstructions(context) } : {}),
    ...(metadata ? { metadata } : {}),
  };
  if (options?.maxTokens) {
    params.max_output_tokens = options.maxTokens;
  }
  if (options?.temperature !== undefined) {
    params.temperature = options.temperature;
  }
  if (options?.serviceTier !== undefined && payloadPolicy.allowsServiceTier) {
    params.service_tier = options.serviceTier;
  }
  if (context.tools) {
    params.tools = convertResponsesTools(context.tools, model as OpenAIModeModel, {
      strict: resolveOpenAIStrictToolSetting(model as OpenAIModeModel, {
        transport: "stream",
      }),
    });
  }
  if (model.reasoning) {
    if (options?.reasoningEffort || options?.reasoning || options?.reasoningSummary) {
      const requestedReasoningEffort = resolveOpenAIReasoningEffort(options);
      const resolvedReasoningEffort = resolveOpenAIReasoningEffortForModel({
        model,
        effort: requestedReasoningEffort,
      });
      const reasoningEffort = resolvedReasoningEffort
        ? raiseMinimalReasoningForResponsesWebSearch({
            model,
            effort: resolvedReasoningEffort,
            tools: params.tools,
          })
        : undefined;
      if (reasoningEffort) {
        params.reasoning = {
          effort: reasoningEffort,
          ...(reasoningEffort === "none" ? {} : { summary: options?.reasoningSummary || "auto" }),
        };
        if (reasoningEffort !== "none") {
          params.include = ["reasoning.encrypted_content"];
        }
      }
    } else if (model.provider !== "github-copilot") {
      const reasoningEffort = resolveOpenAIReasoningEffortForModel({
        model,
        effort: "none",
      });
      if (reasoningEffort) {
        params.reasoning = {
          effort: reasoningEffort,
        };
      }
    }
  }
  applyOpenAIResponsesPayloadPolicy(params as Record<string, unknown>, payloadPolicy);
  return sanitizeOpenAICodexResponsesParams(
    model,
    params as Record<string, unknown>,
  ) as typeof params;
}

export function createAzureOpenAIResponsesTransportStreamFn(): StreamFn {
  return (model, context, options) => {
    const eventStream = createAssistantMessageEventStream();
    const stream = eventStream as unknown as { push(event: unknown): void; end(): void };
    void (async () => {
      const output: MutableAssistantOutput = {
        role: "assistant" as const,
        content: [],
        api: "azure-openai-responses",
        provider: model.provider,
        model: model.id,
        usage: {
          input: 0,
          output: 0,
          cacheRead: 0,
          cacheWrite: 0,
          totalTokens: 0,
          cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 },
        },
        stopReason: "stop",
        timestamp: Date.now(),
      };
      try {
        const apiKey = options?.apiKey || getEnvApiKey(model.provider) || "";
        const turnState = resolveProviderTransportTurnState(model, {
          sessionId: options?.sessionId,
          turnId: randomUUID(),
          attempt: 1,
          transport: "stream",
        });
        const client = createAzureOpenAIClient(
          model,
          context,
          apiKey,
          options?.headers,
          turnState?.headers,
        );
        const deploymentName = resolveAzureDeploymentName(model);
        let params = buildAzureOpenAIResponsesParams(
          model,
          context,
          options as OpenAIResponsesOptions | undefined,
          deploymentName,
          turnState?.metadata,
        );
        const nextParams = await options?.onPayload?.(params, model);
        if (nextParams !== undefined) {
          params = nextParams as typeof params;
        }
        if (!isOpenAICodexResponsesModel(model)) {
          params = mergeTransportMetadata(params, turnState?.metadata);
        }
        params = sanitizeOpenAICodexResponsesParams(
          model,
          params as Record<string, unknown>,
        ) as typeof params;
        const responseStream = (await client.responses.create(
          params as never,
          buildOpenAISdkRequestOptions(model, options?.signal),
        )) as unknown as AsyncIterable<unknown>;
        stream.push({ type: "start", partial: output as never });
        await processResponsesStream(responseStream, output, stream, model);
        if (options?.signal?.aborted) {
          throw new Error("Request was aborted");
        }
        if (output.stopReason === "aborted" || output.stopReason === "error") {
          throw new Error("An unknown error occurred");
        }
        stream.push({ type: "done", reason: output.stopReason as never, message: output as never });
        stream.end();
      } catch (error) {
        output.stopReason = options?.signal?.aborted ? "aborted" : "error";
        output.errorMessage = error instanceof Error ? error.message : JSON.stringify(error);
        stream.push({ type: "error", reason: output.stopReason as never, error: output as never });
        stream.end();
      }
    })();
    return eventStream as unknown as ReturnType<StreamFn>;
  };
}

function normalizeAzureBaseUrl(baseUrl: string): string {
  return baseUrl.replace(/\/+$/, "");
}

function resolveAzureDeploymentName(model: Model<Api>): string {
  const deploymentMap = process.env.AZURE_OPENAI_DEPLOYMENT_NAME_MAP;
  if (deploymentMap) {
    for (const entry of deploymentMap.split(",")) {
      const [modelId, deploymentName] = entry.split("=", 2).map((value) => value?.trim());
      if (modelId === model.id && deploymentName) {
        return deploymentName;
      }
    }
  }
  return model.id;
}

function createAzureOpenAIClient(
  model: Model<Api>,
  context: Context,
  apiKey: string,
  optionHeaders?: Record<string, string>,
  turnHeaders?: Record<string, string>,
) {
  return new AzureOpenAI({
    apiKey,
    apiVersion: resolveAzureOpenAIApiVersion(),
    dangerouslyAllowBrowser: true,
    defaultHeaders: buildOpenAIClientHeaders(model, context, optionHeaders, turnHeaders),
    baseURL: normalizeAzureBaseUrl(model.baseUrl),
    fetch: buildGuardedModelFetch(model),
    ...buildOpenAISdkClientOptions(model),
  });
}

function buildAzureOpenAIResponsesParams(
  model: Model<Api>,
  context: Context,
  options: OpenAIResponsesOptions | undefined,
  deploymentName: string,
  metadata?: Record<string, string>,
) {
  const params = buildOpenAIResponsesParams(model, context, options, metadata);
  params.model = deploymentName;
  delete params.store;
  return params;
}

function hasToolHistory(messages: Context["messages"]): boolean {
  return messages.some(
    (message) =>
      message.role === "toolResult" ||
      (message.role === "assistant" && message.content.some((block) => block.type === "toolCall")),
  );
}

function stringifyPromptJsonShimToolArguments(value: unknown): string {
  return JSON.stringify(value && typeof value === "object" ? value : {});
}

function textFromPromptJsonShimContent(content: Context["messages"][number]["content"]): string {
  if (typeof content === "string") {
    return sanitizeTransportPayloadText(content);
  }
  return content
    .map((block) => {
      if (block.type === "text") {
        return sanitizeTransportPayloadText(block.text);
      }
      return "[image omitted]";
    })
    .filter(Boolean)
    .join("\n");
}

function serializePromptJsonShimToolCall(block: {
  name: string;
  arguments: Record<string, unknown>;
}): string {
  return `<tool_call>${JSON.stringify({
    name: block.name,
    arguments: block.arguments ?? {},
  })}</tool_call>`;
}

function buildPromptJsonShimToolResultText(
  message: Extract<Context["messages"][number], { role: "toolResult" }>,
) {
  const text = textFromPromptJsonShimContent(message.content);
  return [
    `<tool_result name="${message.toolName}" id="${message.toolCallId}" error="${message.isError ? "true" : "false"}">`,
    text || "(empty tool result)",
    "</tool_result>",
  ].join("\n");
}

// 核心执行链路断点20：构造 prompt-json 工具调用协议；观察 tools schema、system prompt 内容；掌握标准：能说明不支持原生 tool call 的模型如何通过 prompt 模拟工具调用。
function buildPromptJsonToolShimSystemPrompt(tools: NonNullable<Context["tools"]>): string {
  // 解决tool兼容问题：把本来要放到 request.tools 的 schema 组装进 prompt，让不支持 tools 字段的模型也能选择工具。
  const toolSchemas = tools.map((tool) => ({
    name: tool.name,
    description: tool.description,
    parameters: tool.parameters,
  }));
  const toolNames = tools.map((tool) => tool.name).join(", ");
  return [
    "## Tool Call Protocol",
    "This model endpoint does not receive native OpenAI tool schemas. OpenClaw will execute tools only when you emit the textual protocol below.",
    "When a tool is needed, respond with exactly one tool call and no extra text:",
    '<tool_call>{"name":"tool_name","arguments":{}}</tool_call>',
    "Use only the exact tool names listed in the schema. `arguments` must be a JSON object matching that tool schema.",
    `Available tool names: ${toolNames}`,
    "Do not invent generic tool names. For current weather, live facts, or web lookups, use `web_search` with a `query` argument when that tool is available; do not emit `weather`.",
    "For greetings, direct questions, and any user message that merits a visible answer but does not require a tool, answer normally in plain text. Do not output `NO_REPLY` for a normal direct user greeting.",
    "After a <tool_result> block returns useful search results, answer the user normally instead of fetching more pages. If a fetch/search tool result reports an error, use the available results to answer or explain the limitation instead of retrying the same lookup.",
    "After a tool result appears in a <tool_result> block, either answer the user normally or emit another <tool_call> block only when the result is insufficient and the new tool call is materially different.",
    "Available tool schemas:",
    JSON.stringify(toolSchemas),
  ].join("\n");
}

function convertPromptJsonToolShimMessages(
  model: OpenAIModeModel,
  context: Context,
  compat: ReturnType<typeof getCompat>,
): Array<Record<string, unknown>> {
  // 解决tool兼容问题：toolResult/assistant toolCall 在 prompt-json 模式下都转成文本标签，避免发送原生 tool 消息。
  const params: Array<Record<string, unknown>> = [];
  const useDeveloperRole = model.reasoning && compat.supportsDeveloperRole;
  const systemPromptParts = [
    context.systemPrompt ? sanitizeTransportPayloadText(context.systemPrompt) : "",
    context.tools && context.tools.length > 0
      ? buildPromptJsonToolShimSystemPrompt(context.tools)
      : "",
  ].filter(Boolean);
  if (systemPromptParts.length > 0) {
    params.push({
      role: useDeveloperRole ? "developer" : "system",
      content: systemPromptParts.join("\n\n"),
    });
  }
  for (const message of context.messages) {
    if (message.role === "user") {
      const content = textFromPromptJsonShimContent(message.content);
      if (content) {
        params.push({ role: "user", content });
      }
      continue;
    }
    if (message.role === "assistant") {
      const content = message.content
        .map((block) => {
          if (block.type === "text") {
            return sanitizeTransportPayloadText(block.text);
          }
          if (block.type === "toolCall") {
            return serializePromptJsonShimToolCall(block);
          }
          return "";
        })
        .filter(Boolean)
        .join("\n");
      if (content) {
        params.push({ role: "assistant", content });
      }
      continue;
    }
    params.push({ role: "user", content: buildPromptJsonShimToolResultText(message) });
  }
  return params;
}

function createOpenAICompletionsClient(
  model: Model<Api>,
  context: Context,
  apiKey: string,
  optionHeaders?: Record<string, string>,
) {
  const clientConfig = buildOpenAICompletionsClientConfig(model, context, optionHeaders);
  return new OpenAI({
    apiKey,
    baseURL: clientConfig.baseURL,
    dangerouslyAllowBrowser: true,
    defaultHeaders: clientConfig.defaultHeaders,
    defaultQuery: clientConfig.defaultQuery,
    fetch: buildGuardedModelFetch(model),
    ...buildOpenAISdkClientOptions(model),
  });
}

function isAzureOpenAICompatibleHost(hostname: string): boolean {
  return (
    hostname.endsWith(".openai.azure.com") ||
    hostname.endsWith(".services.ai.azure.com") ||
    hostname.endsWith(".cognitiveservices.azure.com")
  );
}

function buildOpenAICompletionsClientConfig(
  model: Model<Api>,
  context: Context,
  optionHeaders?: Record<string, string>,
): {
  baseURL: string;
  defaultHeaders: Record<string, string>;
  defaultQuery?: Record<string, string>;
} {
  const headers = buildOpenAIClientHeaders(model, context, optionHeaders);
  const defaultQuery: Record<string, string> = {};
  let baseURL = model.baseUrl;
  let isAzureHost = false;

  try {
    const parsed = new URL(model.baseUrl);
    isAzureHost = isAzureOpenAICompatibleHost(parsed.hostname.toLowerCase());
    parsed.searchParams.forEach((value, key) => {
      if (value) {
        defaultQuery[key] = value;
      }
    });
    parsed.search = "";
    baseURL = parsed.toString().replace(/\/$/, "");
  } catch {
    // Keep the configured base URL unchanged; the OpenAI SDK will surface invalid URLs.
  }

  if (isAzureHost) {
    const apiVersionHeader = Object.keys(headers).find(
      (key) => key.toLowerCase() === "api-version",
    );
    if (apiVersionHeader) {
      const apiVersion = headers[apiVersionHeader]?.trim();
      delete headers[apiVersionHeader];
      if (apiVersion && !defaultQuery["api-version"]) {
        defaultQuery["api-version"] = apiVersion;
      }
    }
  }

  return {
    baseURL,
    defaultHeaders: headers,
    defaultQuery: Object.keys(defaultQuery).length > 0 ? defaultQuery : undefined,
  };
}

// 核心执行链路断点18：OpenAI-compatible completions 请求入口；观察 model、context、compat、请求参数构造；掌握标准：能说明公司 API 调用从这里开始组装。
export function createOpenAICompletionsTransportStreamFn(): StreamFn {
  return (model, context, options) => {
    const eventStream = createAssistantMessageEventStream();
    const stream = eventStream as unknown as { push(event: unknown): void; end(): void };
    void (async () => {
      const output: MutableAssistantOutput = {
        role: "assistant" as const,
        content: [],
        api: model.api,
        provider: model.provider,
        model: model.id,
        usage: {
          input: 0,
          output: 0,
          cacheRead: 0,
          cacheWrite: 0,
          totalTokens: 0,
          cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 },
        },
        stopReason: "stop",
        timestamp: Date.now(),
      };
      try {
        const apiKey = options?.apiKey || getEnvApiKey(model.provider) || "";
        const client = createOpenAICompletionsClient(model, context, apiKey, options?.headers);
        let params = buildOpenAICompletionsParams(
          model as OpenAIModeModel,
          context,
          options as OpenAICompletionsOptions | undefined,
        );
        const nextParams = await options?.onPayload?.(params, model);
        if (nextParams !== undefined) {
          params = nextParams as typeof params;
        }
        const promptJsonToolShim =
          getCompat(model as OpenAIModeModel).toolCallMode === "prompt-json";
        if (promptJsonToolShim) {
          // 解决tool兼容问题：公司接口不接受 tools/tool_choice/stream_options，这里在 onPayload 后再次强制去掉。
          forcePromptJsonCompletionParams(params);
          log.info(
            `prompt-json completions request prepared: provider=${model.provider ?? "unknown"} model=${model.id ?? "unknown"} stream=${String(params.stream)} hasTools=${String("tools" in params)} hasToolChoice=${String("tool_choice" in params)} hasStreamOptions=${String("stream_options" in params)} messages=${Array.isArray(params.messages) ? params.messages.length : "unknown"}`,
          );
        }
        stream.push({ type: "start", partial: output as never });
        if (promptJsonToolShim) {
          // 解决tool兼容问题：prompt-json 使用非流式响应，避免厂商流式 tool_calls/data: 包装不稳定导致解析失败。
          const completion = (await client.chat.completions.create(
            params as never,
            buildOpenAISdkRequestOptions(model, options?.signal),
          )) as unknown as ChatCompletion;
          processOpenAICompletionsCompletion(
            completion,
            output,
            model,
            stream,
            context.tools,
            getPromptJsonAliasFallbackQuery(context),
            context.messages,
          );
        } else {
          const responseStream = (await client.chat.completions.create(
            params as never,
            buildOpenAISdkRequestOptions(model, options?.signal),
          )) as unknown as AsyncIterable<ChatCompletionChunk>;
          await processOpenAICompletionsStream(responseStream, output, model, stream);
        }
        if (options?.signal?.aborted) {
          throw new Error("Request was aborted");
        }
        stream.push({ type: "done", reason: output.stopReason as never, message: output as never });
        stream.end();
      } catch (error) {
        output.stopReason = options?.signal?.aborted ? "aborted" : "error";
        output.errorMessage = error instanceof Error ? error.message : JSON.stringify(error);
        stream.push({ type: "error", reason: output.stopReason as never, error: output as never });
        stream.end();
      }
    })();
    return eventStream as unknown as ReturnType<StreamFn>;
  };
}

type PromptJsonToolCall = {
  name: string;
  arguments: Record<string, unknown>;
};

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
      ? candidate.name
      : typeof candidate.tool === "string"
        ? candidate.tool
        : nameHint;
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

// 核心执行链路断点23：解析 prompt-json 工具调用文本；观察 tool name、arguments、解析失败分支；掌握标准：能说明文本格式的 tool_call 如何变成结构化调用。
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
  // 解决tool兼容问题：兼容模型有时把 JSON 包在说明文字或代码块里，只提取完整对象再解析，避免最终变成空回复。
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
  // 解决tool兼容问题：prompt-json 模型偶尔会按 schema 选中 web_search 但漏掉必填 query，使用最近用户消息兜底避免 query required。
  return fallback ? { ...args, query: fallback } : args;
}

function resolvePromptJsonToolCallForAvailableTools(
  toolCall: PromptJsonToolCall,
  tools?: Context["tools"],
  aliasFallbackQuery?: string,
): PromptJsonToolCall | undefined {
  const coerceKnownArguments = (candidate: PromptJsonToolCall): PromptJsonToolCall =>
    candidate.name === "web_search"
      ? {
          ...candidate,
          arguments: coercePromptJsonWebSearchArguments(candidate.arguments, aliasFallbackQuery),
        }
      : candidate;
  if (!tools || tools.some((tool) => tool.name === toolCall.name)) {
    return coerceKnownArguments(toolCall);
  }
  const availableNames = new Set(tools.map((tool) => tool.name));
  const aliasKey = normalizePromptJsonAliasKey(toolCall.name);
  if (
    availableNames.has("web_search") &&
    (aliasKey === "weather" || aliasKey === "weather_search" || aliasKey === "forecast")
  ) {
    return {
      name: "web_search",
      arguments: coercePromptJsonWeatherAliasArguments(toolCall.arguments, aliasFallbackQuery),
    };
  }
  return undefined;
}

type PromptJsonToolErrorBlock = {
  toolName: string;
  text: string;
};

function collectPromptJsonToolErrorBlocks(
  messages: Context["messages"],
): PromptJsonToolErrorBlock[] {
  const results: PromptJsonToolErrorBlock[] = [];
  for (const message of messages) {
    if (message.role !== "toolResult" || !message.isError) {
      continue;
    }
    results.push({
      toolName: message.toolName,
      text: textFromPromptJsonShimContent(message.content),
    });
  }
  return results;
}

function getPromptJsonBlockedToolRetryMessage(
  toolCall: PromptJsonToolCall,
  messages: Context["messages"],
): string | undefined {
  const priorErrors = collectPromptJsonToolErrorBlocks(messages);
  const hasPriorError = (toolName: string, pattern: RegExp) =>
    priorErrors.some((entry) => entry.toolName === toolName && pattern.test(entry.text));
  // 解决工具错误循环问题：日志显示兼容模型会在 web_search/web_fetch 明确报配置或安全拦截后继续重试，这里停止同类工具循环并返回可见说明。
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

function getPromptJsonAliasFallbackQuery(context: Context): string | undefined {
  for (let index = context.messages.length - 1; index >= 0; index -= 1) {
    const message = context.messages[index];
    if (message?.role !== "user") {
      continue;
    }
    const text = textFromPromptJsonShimContent(message.content).trim();
    if (text) {
      return text;
    }
  }
  return undefined;
}

// 核心执行链路断点21：强制 prompt-json completions 参数；观察 stream、tools、tool_choice、stream_options 是否被移除；掌握标准：能说明兼容公司 API 时为什么要禁用原生工具参数。
function forcePromptJsonCompletionParams(params: Record<string, unknown>): void {
  // 解决tool兼容问题：最终请求体只能保留文本协议需要的普通 chat 参数，不能带原生工具字段。
  params.stream = false;
  delete params.stream_options;
  delete params.tools;
  delete params.tool_choice;
}

function appendTextOutputDelta(
  output: MutableAssistantOutput,
  stream: { push(event: unknown): void },
  text: string,
): void {
  if (!text) {
    return;
  }
  const block = { type: "text" as const, text: "" };
  output.content.push(block);
  const contentIndex = output.content.length - 1;
  stream.push({ type: "text_start", contentIndex, partial: output });
  block.text += text;
  stream.push({
    type: "text_delta",
    contentIndex,
    delta: text,
    partial: output,
  });
}

function appendPromptJsonToolCallOutput(params: {
  output: MutableAssistantOutput;
  stream: { push(event: unknown): void };
  toolCall: PromptJsonToolCall;
  tools?: Context["tools"];
  aliasFallbackQuery?: string;
  retryBlockMessage?: string;
}): boolean {
  const resolvedToolCall = resolvePromptJsonToolCallForAvailableTools(
    params.toolCall,
    params.tools,
    params.aliasFallbackQuery,
  );
  if (!resolvedToolCall) {
    return false;
  }
  if (params.retryBlockMessage) {
    log.warn(
      `prompt-json completion blocked repeated failing tool call: tool=${resolvedToolCall.name}`,
    );
    appendTextOutputDelta(params.output, params.stream, params.retryBlockMessage);
    return true;
  }
  const partialArgs = stringifyPromptJsonShimToolArguments(resolvedToolCall.arguments);
  const block = {
    type: "toolCall" as const,
    id: `call_${randomUUID().replaceAll("-", "")}`,
    name: resolvedToolCall.name,
    arguments: resolvedToolCall.arguments,
    partialArgs,
  };
  params.output.content.push(block);
  const contentIndex = params.output.content.length - 1;
  params.stream.push({ type: "toolcall_start", contentIndex, partial: params.output });
  params.stream.push({
    type: "toolcall_delta",
    contentIndex,
    delta: partialArgs,
    partial: params.output,
  });
  params.output.stopReason = "toolUse";
  return true;
}

// 核心执行链路断点22：处理 OpenAI-compatible completion 响应；观察 choices、message.content、tool call 文本；掌握标准：能说明模型文本响应如何被识别为工具调用。
function processOpenAICompletionsCompletion(
  completion: ChatCompletion,
  output: MutableAssistantOutput,
  model: Model<Api>,
  stream: { push(event: unknown): void },
  tools?: Context["tools"],
  aliasFallbackQuery?: string,
  messages?: Context["messages"],
) {
  // 解决tool兼容问题：把模型返回的文本 <tool_call> 还原成本地结构化 toolCall，后续工具执行链路不用改。
  output.responseId ||= completion.id;
  if (completion.usage) {
    output.usage = parseTransportChunkUsage(completion.usage as never, model);
  }
  const choice = Array.isArray(completion.choices) ? completion.choices[0] : undefined;
  if (!choice) {
    return;
  }
  if (choice.finish_reason) {
    const finishReasonResult = mapStopReason(choice.finish_reason);
    output.stopReason = finishReasonResult.stopReason;
    if (finishReasonResult.errorMessage) {
      output.errorMessage = finishReasonResult.errorMessage;
    }
  }
  const content = typeof choice.message?.content === "string" ? choice.message.content : "";
  const toolCall = parsePromptJsonToolCallText(content);
  if (toolCall) {
    log.info(
      `prompt-json completion parsed text tool call: provider=${model.provider ?? "unknown"} model=${model.id ?? "unknown"} tool=${toolCall.name} contentChars=${content.length}`,
    );
    const resolvedToolCall = resolvePromptJsonToolCallForAvailableTools(
      toolCall,
      tools,
      aliasFallbackQuery,
    );
    if (resolvedToolCall && resolvedToolCall.name !== toolCall.name) {
      log.info(
        `prompt-json completion tool alias normalized: provider=${model.provider ?? "unknown"} model=${model.id ?? "unknown"} tool=${toolCall.name} normalizedTool=${resolvedToolCall.name}`,
      );
    }
    const retryBlockMessage =
      resolvedToolCall && messages
        ? getPromptJsonBlockedToolRetryMessage(resolvedToolCall, messages)
        : undefined;
    if (
      !appendPromptJsonToolCallOutput({
        output,
        stream,
        toolCall,
        tools,
        aliasFallbackQuery,
        retryBlockMessage,
      })
    ) {
      log.warn(
        `prompt-json completion text tool call is not registered locally: provider=${model.provider ?? "unknown"} model=${model.id ?? "unknown"} tool=${toolCall.name}`,
      );
      appendTextOutputDelta(output, stream, content);
    }
  } else {
    if (/<\s*tool_call\b/i.test(content)) {
      log.warn(
        `prompt-json completion contained tool_call text but parsing failed: provider=${model.provider ?? "unknown"} model=${model.id ?? "unknown"} contentChars=${content.length}`,
      );
      // 解决空回复问题：无法解析的文本工具调用会被可见文本过滤器清掉，这里给用户一个简短错误，避免渠道投递空消息。
      appendTextOutputDelta(
        output,
        stream,
        "模型返回了无法解析的工具调用，请重试或查看 gateway 日志中的 prompt-json parse warning。",
      );
      return;
    }
    appendTextOutputDelta(output, stream, content);
  }
  const hasToolCalls = output.content.some((block) => block.type === "toolCall");
  if (output.stopReason === "toolUse" && !hasToolCalls) {
    output.stopReason = "stop";
  }
}

async function processOpenAICompletionsStream(
  responseStream: AsyncIterable<ChatCompletionChunk>,
  output: MutableAssistantOutput,
  model: Model<Api>,
  stream: { push(event: unknown): void },
) {
  const MAX_POST_TOOL_CALL_BUFFER_BYTES = 256_000;
  const MAX_TOOL_CALL_ARGUMENT_BUFFER_BYTES = 256_000;
  const compat = getCompat(model as OpenAIModeModel);
  let currentBlock:
    | { type: "text"; text: string }
    | { type: "thinking"; thinking: string; thinkingSignature?: string }
    | {
        type: "toolCall";
        id: string;
        name: string;
        arguments: Record<string, unknown>;
        partialArgs: string;
        thoughtSignature?: string;
      }
    | null = null;
  let pendingPostToolCallDeltas: CompletionsReasoningDelta[] = [];
  let pendingPostToolCallBytes = 0;
  let currentToolCallArgumentBytes = 0;
  let isFlushingPendingPostToolCallDeltas = false;
  const blockIndex = () => output.content.length - 1;
  const measureUtf8Bytes = (text: string) => Buffer.byteLength(text, "utf8");
  const finishCurrentBlock = () => {
    if (!currentBlock) {
      return;
    }
    if (currentBlock.type === "toolCall") {
      currentBlock.arguments = parseStreamingJson(currentBlock.partialArgs);
      const completed = {
        ...currentBlock,
        arguments: parseStreamingJson(currentBlock.partialArgs),
      };
      output.content[blockIndex()] = completed;
    }
  };
  const queuePostToolCallDelta = (next: CompletionsReasoningDelta) => {
    const nextBytes = measureUtf8Bytes(next.text);
    if (pendingPostToolCallBytes + nextBytes > MAX_POST_TOOL_CALL_BUFFER_BYTES) {
      throw new Error("Exceeded post-tool-call delta buffer limit");
    }
    pendingPostToolCallBytes += nextBytes;
    const previous = pendingPostToolCallDeltas[pendingPostToolCallDeltas.length - 1];
    if (!previous || previous.kind !== next.kind) {
      pendingPostToolCallDeltas.push(next);
      return;
    }
    if (next.kind === "thinking" && previous.kind === "thinking") {
      if (previous.signature !== next.signature) {
        pendingPostToolCallDeltas.push(next);
        return;
      }
      previous.text += next.text;
      return;
    }
    previous.text += next.text;
  };
  const appendThinkingDeltaInternal = (reasoningDelta: { signature: string; text: string }) => {
    if (!currentBlock || currentBlock.type !== "thinking") {
      finishCurrentBlock();
      currentBlock = {
        type: "thinking",
        thinking: "",
        thinkingSignature: reasoningDelta.signature,
      };
      output.content.push(currentBlock);
      stream.push({ type: "thinking_start", contentIndex: blockIndex(), partial: output });
    }
    currentBlock.thinking += reasoningDelta.text;
    stream.push({
      type: "thinking_delta",
      contentIndex: blockIndex(),
      delta: reasoningDelta.text,
      partial: output,
    });
  };
  const appendTextDeltaInternal = (text: string) => {
    if (!currentBlock || currentBlock.type !== "text") {
      finishCurrentBlock();
      currentBlock = { type: "text", text: "" };
      output.content.push(currentBlock);
      stream.push({ type: "text_start", contentIndex: blockIndex(), partial: output });
    }
    currentBlock.text += text;
    stream.push({
      type: "text_delta",
      contentIndex: blockIndex(),
      delta: text,
      partial: output,
    });
  };
  const flushPendingPostToolCallDeltas = () => {
    if (
      isFlushingPendingPostToolCallDeltas ||
      currentBlock?.type === "toolCall" ||
      pendingPostToolCallDeltas.length === 0
    ) {
      return;
    }
    isFlushingPendingPostToolCallDeltas = true;
    const bufferedDeltas = pendingPostToolCallDeltas;
    pendingPostToolCallDeltas = [];
    pendingPostToolCallBytes = 0;
    for (const delta of bufferedDeltas) {
      if (delta.kind === "text") {
        appendTextDeltaInternal(delta.text);
      } else {
        appendThinkingDeltaInternal(delta);
      }
    }
    isFlushingPendingPostToolCallDeltas = false;
  };
  const appendThinkingDelta = (reasoningDelta: { signature: string; text: string }) => {
    flushPendingPostToolCallDeltas();
    appendThinkingDeltaInternal(reasoningDelta);
  };
  const appendTextDelta = (text: string) => {
    flushPendingPostToolCallDeltas();
    appendTextDeltaInternal(text);
  };
  for await (const rawChunk of responseStream as AsyncIterable<unknown>) {
    if (!rawChunk || typeof rawChunk !== "object") {
      continue;
    }
    const chunk = rawChunk as ChatCompletionChunk;
    output.responseId ||= chunk.id;
    if (chunk.usage) {
      output.usage = parseTransportChunkUsage(chunk.usage, model);
    }
    const choice = Array.isArray(chunk.choices) ? chunk.choices[0] : undefined;
    if (!choice) {
      continue;
    }
    const choiceUsage = (choice as unknown as { usage?: ChatCompletionChunk["usage"] }).usage;
    if (!chunk.usage && choiceUsage) {
      output.usage = parseTransportChunkUsage(choiceUsage, model);
    }
    if (choice.finish_reason) {
      const finishReasonResult = mapStopReason(choice.finish_reason);
      output.stopReason = finishReasonResult.stopReason;
      if (finishReasonResult.errorMessage) {
        output.errorMessage = finishReasonResult.errorMessage;
      }
    }
    if (!choice.delta) {
      continue;
    }
    if (choice.delta.content) {
      if (currentBlock?.type === "toolCall") {
        queuePostToolCallDelta({ kind: "text", text: choice.delta.content });
      } else {
        appendTextDelta(choice.delta.content);
      }
      continue;
    }
    const reasoningDeltas = getCompletionsReasoningDeltas(
      choice.delta as Record<string, unknown>,
      compat.visibleReasoningDetailTypes,
    );
    for (const reasoningDelta of reasoningDeltas) {
      if (currentBlock?.type === "toolCall") {
        queuePostToolCallDelta({ ...reasoningDelta });
        continue;
      }
      if (reasoningDelta.kind === "text") {
        appendTextDelta(reasoningDelta.text);
      } else {
        appendThinkingDelta(reasoningDelta);
      }
    }
    if (choice.delta.tool_calls && choice.delta.tool_calls.length > 0) {
      for (const toolCall of choice.delta.tool_calls) {
        if (
          !currentBlock ||
          currentBlock.type !== "toolCall" ||
          (toolCall.id && currentBlock.id !== toolCall.id)
        ) {
          const switchingToolCall = currentBlock?.type === "toolCall";
          finishCurrentBlock();
          if (switchingToolCall) {
            currentBlock = null;
            flushPendingPostToolCallDeltas();
          }
          const initialSig = extractGoogleThoughtSignature(toolCall);
          currentBlock = {
            type: "toolCall",
            id: toolCall.id || "",
            name: toolCall.function?.name || "",
            arguments: {},
            partialArgs: "",
            ...(initialSig ? { thoughtSignature: initialSig } : {}),
          };
          currentToolCallArgumentBytes = 0;
          output.content.push(currentBlock);
          stream.push({ type: "toolcall_start", contentIndex: blockIndex(), partial: output });
        }
        if (currentBlock.type !== "toolCall") {
          continue;
        }
        if (toolCall.id) {
          currentBlock.id = toolCall.id;
        }
        if (toolCall.function?.name) {
          currentBlock.name = toolCall.function.name;
        }
        const deltaSig = extractGoogleThoughtSignature(toolCall);
        if (deltaSig) {
          currentBlock.thoughtSignature = deltaSig;
        }
        if (toolCall.function?.arguments) {
          const nextArgumentBytes = measureUtf8Bytes(toolCall.function.arguments);
          if (
            currentToolCallArgumentBytes + nextArgumentBytes >
            MAX_TOOL_CALL_ARGUMENT_BUFFER_BYTES
          ) {
            throw new Error("Exceeded tool-call argument buffer limit");
          }
          currentToolCallArgumentBytes += nextArgumentBytes;
          currentBlock.partialArgs += toolCall.function.arguments;
          currentBlock.arguments = parseStreamingJson(currentBlock.partialArgs);
          stream.push({
            type: "toolcall_delta",
            contentIndex: blockIndex(),
            delta: toolCall.function.arguments,
            partial: output,
          });
        }
      }
    }
    flushPendingPostToolCallDeltas();
  }
  finishCurrentBlock();
  if (currentBlock?.type === "toolCall") {
    currentBlock = null;
  }
  flushPendingPostToolCallDeltas();
  const hasToolCalls = output.content.some((block) => block.type === "toolCall");
  if (output.stopReason === "toolUse" && !hasToolCalls) {
    output.stopReason = "stop";
  }
}

type CompletionsReasoningDelta =
  | {
      kind: "thinking";
      signature: string;
      text: string;
    }
  | {
      kind: "text";
      text: string;
    };

function getCompletionsReasoningDeltas(
  delta: Record<string, unknown>,
  visibleReasoningDetailTypes: readonly string[],
): CompletionsReasoningDelta[] {
  const output: CompletionsReasoningDelta[] = [];
  const pushDelta = (next: CompletionsReasoningDelta) => {
    const previous = output[output.length - 1];
    if (!previous || previous.kind !== next.kind) {
      output.push(next);
      return;
    }
    if (next.kind === "thinking" && previous.kind === "thinking") {
      if (previous.signature !== next.signature) {
        output.push(next);
        return;
      }
      previous.text += next.text;
      return;
    }
    previous.text += next.text;
  };
  const reasoningDetails = delta.reasoning_details;
  let usedReasoningThinkingDetails = false;
  if (Array.isArray(reasoningDetails)) {
    const visibleTypes = new Set(visibleReasoningDetailTypes);
    for (const item of reasoningDetails) {
      const detail = item as { type?: unknown; text?: unknown };
      if (typeof detail.text !== "string" || !detail.text) {
        continue;
      }
      if (detail.type === "reasoning.text") {
        usedReasoningThinkingDetails = true;
        pushDelta({ kind: "thinking", signature: "reasoning_details", text: detail.text });
        continue;
      }
      if (typeof detail.type === "string" && visibleTypes.has(detail.type)) {
        pushDelta({ kind: "text", text: detail.text });
      }
    }
  }
  if (!usedReasoningThinkingDetails) {
    const reasoningFields = ["reasoning_content", "reasoning", "reasoning_text"] as const;
    for (const field of reasoningFields) {
      const value = delta[field];
      if (typeof value === "string" && value.length > 0) {
        pushDelta({ kind: "thinking", signature: field, text: value });
        break;
      }
    }
  }
  return output;
}

function detectCompat(model: OpenAIModeModel) {
  const { defaults: compatDefaults } = detectOpenAICompletionsCompat(model);
  return {
    supportsStore: compatDefaults.supportsStore,
    supportsDeveloperRole: compatDefaults.supportsDeveloperRole,
    supportsReasoningEffort: compatDefaults.supportsReasoningEffort,
    reasoningEffortMap: {},
    supportsUsageInStreaming: compatDefaults.supportsUsageInStreaming,
    maxTokensField: compatDefaults.maxTokensField,
    requiresToolResultName: false,
    requiresAssistantAfterToolResult: false,
    requiresThinkingAsText: false,
    thinkingFormat: compatDefaults.thinkingFormat,
    visibleReasoningDetailTypes: compatDefaults.visibleReasoningDetailTypes,
    openRouterRouting: {},
    vercelGatewayRouting: {},
    supportsStrictMode: compatDefaults.supportsStrictMode,
    toolCallMode: "native",
  };
}

function getCompat(model: OpenAIModeModel): {
  supportsStore: boolean;
  supportsDeveloperRole: boolean;
  supportsReasoningEffort: boolean;
  reasoningEffortMap: Record<string, string>;
  supportsUsageInStreaming: boolean;
  maxTokensField: string;
  requiresToolResultName: boolean;
  requiresAssistantAfterToolResult: boolean;
  requiresThinkingAsText: boolean;
  thinkingFormat: string;
  openRouterRouting: Record<string, unknown>;
  vercelGatewayRouting: Record<string, unknown>;
  supportsStrictMode: boolean;
  supportsPromptCacheKey: boolean;
  requiresStringContent: boolean;
  visibleReasoningDetailTypes: string[];
  toolCallMode: "native" | "prompt-json";
} {
  const detected = detectCompat(model);
  const compat = model.compat ?? {};
  const supportsStore =
    typeof compat.supportsStore === "boolean" ? compat.supportsStore : detected.supportsStore;
  const supportsReasoningEffort =
    typeof compat.supportsReasoningEffort === "boolean"
      ? compat.supportsReasoningEffort
      : detected.supportsReasoningEffort;
  return {
    supportsStore,
    supportsDeveloperRole: compat.supportsDeveloperRole ?? detected.supportsDeveloperRole,
    supportsReasoningEffort,
    reasoningEffortMap: resolveOpenAIReasoningEffortMap(model, detected.reasoningEffortMap),
    supportsUsageInStreaming: compat.supportsUsageInStreaming ?? detected.supportsUsageInStreaming,
    maxTokensField: (compat.maxTokensField as string | undefined) ?? detected.maxTokensField,
    requiresToolResultName: compat.requiresToolResultName ?? detected.requiresToolResultName,
    requiresAssistantAfterToolResult:
      compat.requiresAssistantAfterToolResult ?? detected.requiresAssistantAfterToolResult,
    requiresThinkingAsText: compat.requiresThinkingAsText ?? detected.requiresThinkingAsText,
    thinkingFormat: compat.thinkingFormat ?? detected.thinkingFormat,
    openRouterRouting: (compat.openRouterRouting as Record<string, unknown> | undefined) ?? {},
    vercelGatewayRouting:
      (compat.vercelGatewayRouting as Record<string, unknown> | undefined) ??
      detected.vercelGatewayRouting,
    supportsStrictMode: compat.supportsStrictMode ?? detected.supportsStrictMode,
    supportsPromptCacheKey: compat.supportsPromptCacheKey === true,
    requiresStringContent: compat.requiresStringContent ?? false,
    visibleReasoningDetailTypes:
      compat.visibleReasoningDetailTypes ?? detected.visibleReasoningDetailTypes,
    toolCallMode: compat.toolCallMode === "prompt-json" ? "prompt-json" : "native",
  };
}

type OpenAIResponsesRequestParams = {
  model: string;
  input: ResponseInput;
  stream: true;
  instructions?: string;
  prompt_cache_key?: string;
  prompt_cache_retention?: "24h";
  metadata?: Record<string, string>;
  store?: boolean;
  max_output_tokens?: number;
  temperature?: number;
  service_tier?: ResponseCreateParamsStreaming["service_tier"];
  tools?: FunctionTool[];
  reasoning?:
    | { effort: OpenAIApiReasoningEffort }
    | {
        effort: OpenAIApiReasoningEffort;
        summary: NonNullable<OpenAIResponsesOptions["reasoningSummary"]>;
      };
  include?: string[];
};

function resolveOpenAICompletionsReasoningEffort(options: OpenAICompletionsOptions | undefined) {
  return options?.reasoningEffort ?? options?.reasoning ?? "high";
}

function convertTools(
  tools: NonNullable<Context["tools"]>,
  compat: ReturnType<typeof getCompat>,
  model: OpenAIModeModel,
) {
  const strict = resolveOpenAIStrictToolFlagWithDiagnostics(
    tools,
    resolveOpenAIStrictToolSetting(model, {
      transport: "stream",
      supportsStrictMode: compat?.supportsStrictMode,
    }),
    {
      transport: "completions",
      model,
    },
  );
  return tools.map((tool) => ({
    type: "function",
    function: {
      name: tool.name,
      description: tool.description,
      parameters: normalizeOpenAIStrictToolParameters(tool.parameters, strict === true),
      ...(strict === undefined ? {} : { strict }),
    },
  }));
}

function extractGoogleThoughtSignature(toolCall: unknown): string | undefined {
  const tc = toolCall as Record<string, unknown> | undefined;
  if (!tc) {
    return undefined;
  }
  const extra = (tc.extra_content as Record<string, unknown> | undefined)?.google as
    | Record<string, unknown>
    | undefined;
  const fromExtra = extra?.thought_signature;
  if (typeof fromExtra === "string" && fromExtra.length > 0) {
    return fromExtra;
  }
  const fromFunction = (tc.function as { thought_signature?: unknown } | undefined)
    ?.thought_signature;
  return typeof fromFunction === "string" && fromFunction.length > 0 ? fromFunction : undefined;
}

function isGoogleOpenAICompatModel(model: OpenAIModeModel): boolean {
  const endpointClass = detectOpenAICompletionsCompat(model as Model<"openai-completions">)
    .capabilities.endpointClass;
  return (
    model.provider === "google" ||
    endpointClass === "google-generative-ai" ||
    endpointClass === "google-vertex"
  );
}

function injectToolCallThoughtSignatures(
  outgoingMessages: unknown[],
  context: Context,
  model: OpenAIModeModel,
): void {
  if (!isGoogleOpenAICompatModel(model)) {
    return;
  }
  const sigById = new Map<string, string>();
  for (const msg of context.messages ?? []) {
    if ((msg as { role?: string }).role !== "assistant") {
      continue;
    }
    const source = msg as { api?: string; provider?: string; model?: string; content?: unknown };
    if (
      source.api !== model.api ||
      source.provider !== model.provider ||
      source.model !== model.id
    ) {
      continue;
    }
    if (!Array.isArray(source.content)) {
      continue;
    }
    for (const block of source.content as Array<Record<string, unknown>>) {
      if (block.type !== "toolCall") {
        continue;
      }
      const id = block.id;
      const sig = block.thoughtSignature;
      if (typeof id === "string" && typeof sig === "string" && sig.length > 0) {
        sigById.set(id, sig);
      }
    }
  }
  if (sigById.size === 0) {
    return;
  }
  for (const message of outgoingMessages) {
    const toolCalls = (message as { tool_calls?: unknown }).tool_calls;
    if (!Array.isArray(toolCalls)) {
      continue;
    }
    for (const toolCall of toolCalls as Array<Record<string, unknown>>) {
      const id = toolCall.id;
      if (typeof id !== "string") {
        continue;
      }
      const sig = sigById.get(id);
      if (!sig) {
        continue;
      }
      const extra =
        toolCall.extra_content && typeof toolCall.extra_content === "object"
          ? (toolCall.extra_content as Record<string, unknown>)
          : {};
      toolCall.extra_content = extra;
      const google =
        extra.google && typeof extra.google === "object"
          ? (extra.google as Record<string, unknown>)
          : {};
      extra.google = google;
      google.thought_signature = sig;
    }
  }
}

// 核心执行链路断点19：构造 OpenAI-compatible 请求 payload；观察 messages、stream、tools、tool_choice、extra_body；掌握标准：能说明最终发给公司 API 的 JSON 为什么长这样。
export function buildOpenAICompletionsParams(
  model: OpenAIModeModel,
  context: Context,
  options: OpenAICompletionsOptions | undefined,
) {
  const compat = getCompat(model);
  const compatDetection = detectOpenAICompletionsCompat(model);
  const completionsContext = context.systemPrompt
    ? {
        ...context,
        systemPrompt: stripSystemPromptCacheBoundary(context.systemPrompt),
      }
    : context;
  // 解决tool兼容问题：prompt-json 模式不调用 convertMessages 生成原生工具消息，而是生成文本工具协议。
  const messages =
    compat.toolCallMode === "prompt-json"
      ? convertPromptJsonToolShimMessages(model, completionsContext, compat)
      : convertMessages(model as never, completionsContext, compat as never);
  injectToolCallThoughtSignatures(messages as unknown[], context, model);
  const cacheRetention = resolveCacheRetention(options?.cacheRetention);
  const params: Record<string, unknown> = {
    model: model.id,
    messages: compat.requiresStringContent
      ? flattenCompletionMessagesToStringContent(messages)
      : messages,
    stream: compat.toolCallMode === "prompt-json" ? false : true,
    stream_options: { include_usage: true },
  };
  if (compat.supportsStore) {
    params.store = false;
  }
  if (compat.supportsPromptCacheKey && cacheRetention !== "none" && options?.sessionId) {
    params.prompt_cache_key = options.sessionId;
  }
  if (options?.maxTokens) {
    if (compat.maxTokensField === "maxTokens") {
      params.maxTokens = options.maxTokens;
    } else if (compat.maxTokensField === "max_tokens") {
      params.max_tokens = options.maxTokens;
    } else {
      params.max_completion_tokens = options.maxTokens;
    }
  }
  if (options?.temperature !== undefined) {
    params.temperature = options.temperature;
  }
  if (context.tools && compat.toolCallMode !== "prompt-json") {
    params.tools = convertTools(context.tools, compat, model);
    if (options?.toolChoice) {
      params.tool_choice = options.toolChoice;
    } else if (
      compatDetection.capabilities.usesExplicitProxyLikeEndpoint &&
      Array.isArray(params.tools) &&
      params.tools.length > 0
    ) {
      params.tool_choice = "auto";
    }
  } else if (compat.toolCallMode !== "prompt-json" && hasToolHistory(context.messages)) {
    params.tools = [];
  }
  if (compat.toolCallMode === "prompt-json") {
    // 解决tool兼容问题：参数构建阶段先去掉 tools；发送前还会再清一次，防止 onPayload 重新塞回去。
    forcePromptJsonCompletionParams(params);
  }
  const completionsReasoningEffort = resolveOpenAICompletionsReasoningEffort(options);
  const resolvedCompletionsReasoningEffort = completionsReasoningEffort
    ? resolveOpenAIReasoningEffortForModel({
        model,
        effort: completionsReasoningEffort,
        fallbackMap: compat.reasoningEffortMap,
      })
    : undefined;
  if (
    compat.thinkingFormat === "openrouter" &&
    model.reasoning &&
    resolvedCompletionsReasoningEffort
  ) {
    params.reasoning = {
      effort: resolvedCompletionsReasoningEffort,
    };
  } else if (
    resolvedCompletionsReasoningEffort &&
    model.reasoning &&
    compat.supportsReasoningEffort
  ) {
    params.reasoning_effort = resolvedCompletionsReasoningEffort;
  }
  return params;
}

export function parseTransportChunkUsage(
  rawUsage: NonNullable<ChatCompletionChunk["usage"]>,
  model: Model<Api>,
) {
  const cachedTokens = rawUsage.prompt_tokens_details?.cached_tokens || 0;
  const promptTokens = rawUsage.prompt_tokens || 0;
  const input = Math.max(0, promptTokens - cachedTokens);
  const outputTokens = rawUsage.completion_tokens || 0;
  const usage = {
    input,
    output: outputTokens,
    cacheRead: cachedTokens,
    cacheWrite: 0,
    totalTokens: input + outputTokens + cachedTokens,
    cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 },
  };
  calculateCost(model as never, usage as never);
  return usage;
}

function mapStopReason(reason: string | null) {
  if (reason === null) {
    return { stopReason: "stop" };
  }
  switch (reason) {
    case "stop":
    case "end":
      return { stopReason: "stop" };
    case "length":
      return { stopReason: "length" };
    case "function_call":
    case "tool_call":
    case "tool_calls":
      return { stopReason: "toolUse" };
    case "content_filter":
      return { stopReason: "error", errorMessage: "Provider finish_reason: content_filter" };
    case "network_error":
      return { stopReason: "error", errorMessage: "Provider finish_reason: network_error" };
    default:
      return {
        stopReason: "error",
        errorMessage: `Provider finish_reason: ${reason}`,
      };
  }
}

export const __testing = {
  buildOpenAIClientHeaders,
  buildOpenAISdkClientOptions,
  buildOpenAISdkRequestOptions,
  createAzureOpenAIClient,
  createOpenAICompletionsClient,
  createOpenAIResponsesClient,
  sanitizeOpenAICodexResponsesParams,
  buildOpenAICompletionsClientConfig,
  processOpenAICompletionsCompletion,
  processOpenAICompletionsStream,
};
