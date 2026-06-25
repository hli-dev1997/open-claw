import { redactToolDetail } from "./redact.js";

type LogFieldValue = string | number | boolean | null | undefined;

export type NodeLogFields = Record<string, LogFieldValue>;

export function previewLogValue(value: unknown, maxChars = 160): string {
  const raw =
    typeof value === "string"
      ? value
      : (() => {
          try {
            return JSON.stringify(value);
          } catch {
            return String(value);
          }
        })();
  const normalized = raw.replace(/\s+/g, " ").trim();
  return normalized.length > maxChars
    ? `${normalized.slice(0, Math.max(0, maxChars - 3))}...`
    : normalized;
}

export function previewRedactedLogValue(value: unknown, maxChars = 160): string {
  return previewLogValue(
    redactToolDetail(previewLogValue(value, Number.MAX_SAFE_INTEGER)),
    maxChars,
  );
}

function formatLogFieldValue(value: LogFieldValue): string {
  if (value === undefined) {
    return "undefined";
  }
  if (value === null) {
    return "null";
  }
  if (typeof value === "string") {
    return JSON.stringify(value);
  }
  return String(value);
}

export function formatNodeLog(params: {
  id: string;
  name: string;
  summary: string;
  fields?: NodeLogFields;
}): string {
  const fields = Object.entries(params.fields ?? {})
    .filter(([, value]) => value !== undefined)
    .map(([key, value]) => `${key}=${formatLogFieldValue(value)}`)
    .join(" ");
  return `[${params.id}] ${params.name} | ${params.summary}${fields ? ` ${fields}` : ""}`;
}
