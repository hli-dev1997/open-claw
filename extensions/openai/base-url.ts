import { normalizeOptionalString } from "openclaw/plugin-sdk/text-runtime";

export function isOpenAIApiBaseUrl(baseUrl?: string): boolean {
  const trimmed = normalizeOptionalString(baseUrl);
  if (!trimmed) {
    console.log(`[DEBUG] isOpenAIApiBaseUrl: empty baseUrl`);
    return false;
  }
  const isMatch = /^https?:\/\/api\.openai\.com(?:\/v1)?\/?$/i.test(trimmed);
  console.log(`[DEBUG] isOpenAIApiBaseUrl: ${trimmed} => ${isMatch}`);
  return isMatch;
}

export function isOpenAICodexBaseUrl(baseUrl?: string): boolean {
  const trimmed = normalizeOptionalString(baseUrl);
  if (!trimmed) {
    return false;
  }
  return /^https?:\/\/chatgpt\.com\/backend-api(?:\/codex)?(?:\/v1)?\/?$/i.test(trimmed);
}
