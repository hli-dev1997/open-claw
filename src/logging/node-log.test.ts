import { describe, expect, it } from "vitest";
import { formatNodeLog, previewLogValue, previewRedactedLogValue } from "./node-log.js";

describe("node log formatting", () => {
  it("formats semantic node logs with Chinese label and stable fields", () => {
    expect(
      formatNodeLog({
        id: "model.request",
        name: "请求模型",
        summary: "发送模型请求",
        fields: {
          model: "deepseek/deepseek-v4-flash",
          messages: 6,
          tools: 28,
          omitted: undefined,
        },
      }),
    ).toBe(
      '[model.request] 请求模型 | 发送模型请求 model="deepseek/deepseek-v4-flash" messages=6 tools=28',
    );
  });

  it("keeps previews compact and redacted", () => {
    expect(previewLogValue("  one\n two\tthree  ", 20)).toBe("one two three");
    expect(previewLogValue("abcdefghijklmnopqrstuvwxyz", 10)).toBe("abcdefg...");
    expect(
      previewRedactedLogValue({ apiKey: "sk-secret", url: "https://example.com" }, 120),
    ).not.toContain("sk-secret");
  });
});
