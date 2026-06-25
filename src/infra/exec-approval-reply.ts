import type { ReplyPayload } from "../auto-reply/types.js";
import { formatHumanList } from "../shared/human-list.js";
import {
  normalizeOptionalLowercaseString,
  normalizeOptionalString,
} from "../shared/string-coerce.js";
import type { ExecApprovalReplyDecision } from "./exec-approval-pending-reply.js";
import {
  describeNativeExecApprovalClientSetup,
  listNativeExecApprovalClientLabels,
  supportsNativeExecApprovalClient,
} from "./exec-approval-surface.js";

export {
  buildApprovalInteractiveReply,
  buildApprovalInteractiveReplyFromActionDescriptors,
  buildExecApprovalActionDescriptors,
  buildExecApprovalCommandText,
  buildExecApprovalInteractiveReply,
  buildExecApprovalPendingReplyPayload,
  formatExecApprovalExpiresIn,
  type ExecApprovalActionDescriptor,
  type ExecApprovalPendingReplyParams,
  type ExecApprovalReplyDecision,
} from "./exec-approval-pending-reply.js";
export type ExecApprovalUnavailableReason =
  | "initiating-platform-disabled"
  | "initiating-platform-unsupported"
  | "no-approval-route";

export type ExecApprovalReplyMetadata = {
  approvalId: string;
  approvalSlug: string;
  approvalKind: "exec" | "plugin";
  agentId?: string;
  allowedDecisions?: readonly ExecApprovalReplyDecision[];
  sessionKey?: string;
};

export type ExecApprovalUnavailableReplyParams = {
  warningText?: string;
  channel?: string;
  channelLabel?: string;
  accountId?: string;
  reason: ExecApprovalUnavailableReason;
  sentApproverDms?: boolean;
};

function resolveNativeExecApprovalClientList(params?: { excludeChannel?: string }): string {
  return formatHumanList(
    listNativeExecApprovalClientLabels({
      excludeChannel: params?.excludeChannel,
    }),
  );
}

function buildGenericNativeExecApprovalFallbackText(params?: { excludeChannel?: string }): string {
  const clients = resolveNativeExecApprovalClientList({
    excludeChannel: params?.excludeChannel,
  });
  return clients
    ? `Approve it from the Web UI or terminal UI, or enable a native chat approval client such as ${clients}. If those accounts already know your owner ID via allowFrom or owner config, OpenClaw can often infer approvers automatically.`
    : "Approve it from the Web UI or terminal UI.";
}

export function getExecApprovalApproverDmNoticeText(): string {
  return "Approval required. I sent approval DMs to the approvers for this account.";
}

export function parseExecApprovalCommandText(
  raw: string,
): { approvalId: string; decision: ExecApprovalReplyDecision } | null {
  const trimmed = raw.trim();
  const match = trimmed.match(
    /^\/?approve(?:@[^\s]+)?\s+([A-Za-z0-9][A-Za-z0-9._:-]*)\s+(allow-once|allow-always|always|deny)\b/i,
  );
  if (!match) {
    return null;
  }
  const rawDecision = normalizeOptionalLowercaseString(match[2]) ?? "";
  return {
    approvalId: match[1],
    decision:
      rawDecision === "always" ? "allow-always" : (rawDecision as ExecApprovalReplyDecision),
  };
}

export function getExecApprovalReplyMetadata(
  payload: ReplyPayload,
): ExecApprovalReplyMetadata | null {
  const channelData = payload.channelData;
  if (!channelData || typeof channelData !== "object" || Array.isArray(channelData)) {
    return null;
  }
  const execApproval = channelData.execApproval;
  if (!execApproval || typeof execApproval !== "object" || Array.isArray(execApproval)) {
    return null;
  }
  const record = execApproval as Record<string, unknown>;
  const approvalId = normalizeOptionalString(record.approvalId) ?? "";
  const approvalSlug = normalizeOptionalString(record.approvalSlug) ?? "";
  if (!approvalId || !approvalSlug) {
    return null;
  }
  const approvalKind = record.approvalKind === "plugin" ? "plugin" : "exec";
  const allowedDecisions = Array.isArray(record.allowedDecisions)
    ? record.allowedDecisions.filter(
        (value): value is ExecApprovalReplyDecision =>
          value === "allow-once" || value === "allow-always" || value === "deny",
      )
    : undefined;
  const agentId = normalizeOptionalString(record.agentId);
  const sessionKey = normalizeOptionalString(record.sessionKey);
  return {
    approvalId,
    approvalSlug,
    approvalKind,
    agentId,
    allowedDecisions,
    sessionKey,
  };
}

export function buildExecApprovalUnavailableReplyPayload(
  params: ExecApprovalUnavailableReplyParams,
): ReplyPayload {
  const lines: string[] = [];
  const warningText = params.warningText?.trim();
  if (warningText) {
    lines.push(warningText);
  }

  if (params.sentApproverDms) {
    lines.push(getExecApprovalApproverDmNoticeText());
    return {
      text: lines.join("\n\n"),
    };
  }

  if (params.reason === "initiating-platform-disabled") {
    lines.push(
      `Exec approval is required, but native chat exec approvals are not configured on ${params.channelLabel ?? "this platform"}.`,
    );
    const channel = normalizeOptionalLowercaseString(params.channel);
    const setupText =
      channel && params.channelLabel && supportsNativeExecApprovalClient(channel)
        ? describeNativeExecApprovalClientSetup({
            channel,
            channelLabel: params.channelLabel,
            accountId: params.accountId,
          })
        : null;
    if (setupText) {
      lines.push(setupText);
    } else {
      lines.push(buildGenericNativeExecApprovalFallbackText());
    }
  } else if (params.reason === "initiating-platform-unsupported") {
    lines.push(
      `Exec approval is required, but ${params.channelLabel ?? "this platform"} does not support chat exec approvals.`,
    );
    lines.push(
      buildGenericNativeExecApprovalFallbackText({
        excludeChannel: params.channel,
      }),
    );
  } else {
    lines.push(
      "Exec approval is required, but no interactive approval client is currently available.",
    );
    lines.push(
      `${buildGenericNativeExecApprovalFallbackText()} Then retry the command. You can usually leave execApprovals.approvers unset when owner config already identifies the approvers.`,
    );
  }

  return {
    text: lines.join("\n\n"),
  };
}
