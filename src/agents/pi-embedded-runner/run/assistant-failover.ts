import type { AssistantMessage } from "@mariozechner/pi-ai";
import type { OpenClawConfig } from "../../../config/types.openclaw.js";
import { formatNodeLog } from "../../../logging/node-log.js";
import { sanitizeForLog } from "../../../terminal/ansi.js";
import type { AuthProfileFailureReason } from "../../auth-profiles.js";
import { FailoverError, resolveFailoverStatus } from "../../failover-error.js";
import {
  formatAssistantErrorText,
  formatBillingErrorMessage,
  isTimeoutErrorMessage,
  type FailoverReason,
} from "../../pi-embedded-helpers.js";
import {
  mergeRetryFailoverReason,
  resolveRunFailoverDecision,
  type AssistantFailoverDecision,
} from "./failover-policy.js";

type AssistantFailoverOutcome =
  | {
      action: "continue_normal";
      overloadProfileRotations: number;
    }
  | {
      action: "retry";
      overloadProfileRotations: number;
      lastRetryFailoverReason: FailoverReason | null;
      retryKind?: "same_model_idle_timeout";
    }
  | {
      action: "throw";
      overloadProfileRotations: number;
      error: FailoverError;
    };

export async function handleAssistantFailover(params: {
  initialDecision: AssistantFailoverDecision;
  aborted: boolean;
  externalAbort: boolean;
  fallbackConfigured: boolean;
  failoverFailure: boolean;
  failoverReason: FailoverReason | null;
  timedOut: boolean;
  idleTimedOut: boolean;
  timedOutDuringCompaction: boolean;
  allowSameModelIdleTimeoutRetry: boolean;
  assistantProfileFailureReason: AuthProfileFailureReason | null;
  lastProfileId?: string;
  modelId: string;
  provider: string;
  activeErrorContext: { provider: string; model: string };
  lastAssistant: AssistantMessage | undefined;
  config: OpenClawConfig | undefined;
  sessionKey?: string;
  authFailure: boolean;
  rateLimitFailure: boolean;
  billingFailure: boolean;
  cloudCodeAssistFormatError: boolean;
  isProbeSession: boolean;
  overloadProfileRotations: number;
  overloadProfileRotationLimit: number;
  previousRetryFailoverReason: FailoverReason | null;
  logAssistantFailoverDecision: (
    decision: "rotate_profile" | "fallback_model" | "surface_error",
    extra?: { status?: number },
  ) => void;
  warn: (message: string) => void;
  maybeMarkAuthProfileFailure: (failure: {
    profileId?: string;
    reason?: AuthProfileFailureReason | null;
    modelId?: string;
  }) => Promise<void>;
  maybeEscalateRateLimitProfileFallback: (params: {
    failoverProvider: string;
    failoverModel: string;
    logFallbackDecision: (decision: "fallback_model", extra?: { status?: number }) => void;
  }) => void;
  maybeBackoffBeforeOverloadFailover: (reason: FailoverReason | null) => Promise<void>;
  advanceAuthProfile: () => Promise<boolean>;
}): Promise<AssistantFailoverOutcome> {
  // 作用：LLM 调用失败时的降级决策中枢，统一处理重试/换Profile/升级Fallback/抛出错误
  const _failoverStartedAt = Date.now();
  let overloadProfileRotations = params.overloadProfileRotations;
  let decision = params.initialDecision;
  const sameModelIdleTimeoutRetry = (): AssistantFailoverOutcome => {
    params.warn(
      `[llm-idle-timeout] ${sanitizeForLog(params.provider)}/${sanitizeForLog(params.modelId)} produced no reply before the idle watchdog; retrying same model`,
    );
    console.log(
      formatNodeLog({
        id: "agent.failover.check",
        name: "降级检查",
        summary: "LLM 长时间无响应，触发同模型重试",
        fields: {
          provider: params.provider,
          model: params.modelId,
          elapsedMs: Date.now() - _failoverStartedAt,
        },
      }),
    );
    return {
      action: "retry",
      overloadProfileRotations,
      retryKind: "same_model_idle_timeout",
      lastRetryFailoverReason: mergeRetryFailoverReason({
        previous: params.previousRetryFailoverReason,
        failoverReason: params.failoverReason,
        timedOut: true,
      }),
    };
  };

  if (decision.action === "rotate_profile") {
    if (params.lastProfileId) {
      const reason = params.timedOut ? "timeout" : params.assistantProfileFailureReason;
      await params.maybeMarkAuthProfileFailure({
        profileId: params.lastProfileId,
        reason,
        modelId: params.modelId,
      });
      if (params.timedOut && !params.isProbeSession) {
        params.warn(`Profile ${params.lastProfileId} timed out. Trying next account...`);
      }
      if (params.cloudCodeAssistFormatError) {
        params.warn(
          `Profile ${params.lastProfileId} hit Cloud Code Assist format error. Tool calls will be sanitized on retry.`,
        );
      }
    }

    if (params.failoverReason === "overloaded") {
      overloadProfileRotations += 1;
      if (
        overloadProfileRotations > params.overloadProfileRotationLimit &&
        params.fallbackConfigured
      ) {
        const status = resolveFailoverStatus("overloaded");
        params.warn(
          `overload profile rotation cap reached for ${sanitizeForLog(params.provider)}/${sanitizeForLog(params.modelId)} after ${overloadProfileRotations} rotations; escalating to model fallback`,
        );
        params.logAssistantFailoverDecision("fallback_model", { status });
        console.log(
          formatNodeLog({
            id: "agent.failover.check",
            name: "降级检查",
            summary: "轮换次数已达上限，升级为模型级 Fallback",
            fields: {
              provider: params.provider,
              model: params.modelId,
              rotations: overloadProfileRotations,
              limit: params.overloadProfileRotationLimit,
              status,
              elapsedMs: Date.now() - _failoverStartedAt,
            },
          }),
        );
        return {
          action: "throw",
          overloadProfileRotations,
          error: new FailoverError(
            "The AI service is temporarily overloaded. Please try again in a moment.",
            {
              reason: "overloaded",
              provider: params.activeErrorContext.provider,
              model: params.activeErrorContext.model,
              profileId: params.lastProfileId,
              status,
              rawError: params.lastAssistant?.errorMessage?.trim(),
            },
          ),
        };
      }
    }

    if (params.failoverReason === "rate_limit") {
      console.log(
        formatNodeLog({
          id: "agent.failover.check",
          name: "降级检查",
          summary: "触发 rate_limit，尝试 Profile 级 Fallback 升级",
          fields: {
            provider: params.provider,
            model: params.modelId,
            failoverReason: params.failoverReason,
            elapsedMs: Date.now() - _failoverStartedAt,
          },
        }),
      );
      params.maybeEscalateRateLimitProfileFallback({
        failoverProvider: params.activeErrorContext.provider,
        failoverModel: params.activeErrorContext.model,
        logFallbackDecision: params.logAssistantFailoverDecision,
      });
    }

    const rotated = await params.advanceAuthProfile();
    if (rotated) {
      params.logAssistantFailoverDecision("rotate_profile");
      console.log(
        formatNodeLog({
          id: "agent.failover.check",
          name: "降级检查",
          summary: "成功轮换到下一个 Auth Profile，准备重试",
          fields: {
            provider: params.provider,
            model: params.modelId,
            failoverReason: params.failoverReason ?? "none",
            overloadRotations: overloadProfileRotations,
            elapsedMs: Date.now() - _failoverStartedAt,
          },
        }),
      );
      await params.maybeBackoffBeforeOverloadFailover(params.failoverReason);
      return {
        action: "retry",
        overloadProfileRotations,
        lastRetryFailoverReason: mergeRetryFailoverReason({
          previous: params.previousRetryFailoverReason,
          failoverReason: params.failoverReason,
          timedOut: params.timedOut,
        }),
      };
    }
    if (params.idleTimedOut && params.allowSameModelIdleTimeoutRetry) {
      return sameModelIdleTimeoutRetry();
    }

    decision = resolveRunFailoverDecision({
      stage: "assistant",
      aborted: params.aborted,
      externalAbort: params.externalAbort,
      fallbackConfigured: params.fallbackConfigured,
      failoverFailure: params.failoverFailure,
      failoverReason: params.failoverReason,
      timedOut: params.timedOut,
      timedOutDuringCompaction: params.timedOutDuringCompaction,
      profileRotated: true,
    });
  }

  if (decision.action === "fallback_model") {
    await params.maybeBackoffBeforeOverloadFailover(params.failoverReason);
    const message = resolveAssistantFailoverErrorMessage(params);
    const status =
      resolveFailoverStatus(decision.reason) ?? (isTimeoutErrorMessage(message) ? 408 : undefined);
    params.logAssistantFailoverDecision("fallback_model", { status });
    return {
      action: "throw",
      overloadProfileRotations,
      error: new FailoverError(message, {
        reason: decision.reason,
        provider: params.activeErrorContext.provider,
        model: params.activeErrorContext.model,
        profileId: params.lastProfileId,
        status,
        rawError: params.lastAssistant?.errorMessage?.trim(),
      }),
    };
  }

  if (decision.action === "surface_error") {
    if (!params.externalAbort && params.idleTimedOut && params.allowSameModelIdleTimeoutRetry) {
      return sameModelIdleTimeoutRetry();
    }
    params.logAssistantFailoverDecision("surface_error");
    // Two surface_error shapes already have downstream synthesis and
    // must keep falling through to `continue_normal`:
    //   1. External abort (user pressed stop) — partial assistant
    //      output carries the turn; no provider error to synthesize.
    //   2. Timeout without an idle-retry — run.ts emits a dedicated
    //      timeout payload when buildEmbeddedRunPayloads produces no
    //      assistant content (see the `timedOut &&
    //      !timedOutDuringCompaction && !payloadsWithToolMedia.length`
    //      block in run.ts). Throwing here would short-circuit that
    //      synthesis and break timeout-compaction retry coverage.
    // Every other surface_error is a concrete provider failure that
    // continue_normal would silently drop before the payload builder
    // sees it (openclaw#70124: billing errors reached the gateway
    // but never the webchat because stopReason was not "error" and
    // no other synthesis path caught them). Throw a FailoverError so
    // the client surface can render it the same way it already
    // renders fallback_model failures.
    if (!params.externalAbort && !params.timedOut) {
      const message = resolveAssistantFailoverErrorMessage(params);
      const reason = resolveSurfaceErrorReason(decision.reason, params);
      const status =
        resolveFailoverStatus(reason) ?? (isTimeoutErrorMessage(message) ? 408 : undefined);
      return {
        action: "throw",
        overloadProfileRotations,
        error: new FailoverError(message, {
          reason,
          provider: params.activeErrorContext.provider,
          model: params.activeErrorContext.model,
          profileId: params.lastProfileId,
          status,
          rawError: params.lastAssistant?.errorMessage?.trim(),
        }),
      };
    }
  }

  console.log(
    formatNodeLog({
      id: "agent.failover.check",
      name: "降级检查",
      summary: "无需切换模型或 Auth Profile，正常流程继续",
      fields: {
        provider: params.provider,
        model: params.modelId,
        elapsedMs: Date.now() - _failoverStartedAt,
      },
    }),
  );
  return {
    action: "continue_normal",
    overloadProfileRotations,
  };
}

function resolveAssistantFailoverErrorMessage(params: {
  lastAssistant: AssistantMessage | undefined;
  config: OpenClawConfig | undefined;
  sessionKey?: string;
  activeErrorContext: { provider: string; model: string };
  timedOut: boolean;
  rateLimitFailure: boolean;
  billingFailure: boolean;
  authFailure: boolean;
}): string {
  return (
    (params.lastAssistant
      ? formatAssistantErrorText(params.lastAssistant, {
          cfg: params.config,
          sessionKey: params.sessionKey,
          provider: params.activeErrorContext.provider,
          model: params.activeErrorContext.model,
        })
      : undefined) ||
    params.lastAssistant?.errorMessage?.trim() ||
    (params.timedOut
      ? "LLM request timed out."
      : params.rateLimitFailure
        ? "LLM request rate limited."
        : params.billingFailure
          ? formatBillingErrorMessage(
              params.activeErrorContext.provider,
              params.activeErrorContext.model,
            )
          : params.authFailure
            ? "LLM request unauthorized."
            : "LLM request failed.")
  );
}

// surface_error decisions can arrive with `reason: null` when
// shouldRotateAssistant fired on `failoverFailure` without a classified
// upstream reason. FailoverError requires a concrete reason, so map
// null onto the most specific failure the run observed, falling back
// to "unknown" when no signal is set. Callers only hit this helper on
// the non-timeout throw branch, so timeouts don't need a case here.
function resolveSurfaceErrorReason(
  declared: FailoverReason | null,
  params: {
    billingFailure: boolean;
    authFailure: boolean;
    rateLimitFailure: boolean;
  },
): FailoverReason {
  if (declared) {
    return declared;
  }
  if (params.billingFailure) {
    return "billing";
  }
  if (params.authFailure) {
    return "auth";
  }
  if (params.rateLimitFailure) {
    return "rate_limit";
  }
  return "unknown";
}
