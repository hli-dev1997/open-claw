import type { AgentTool } from "@mariozechner/pi-agent-core";
import { Type } from "typebox";
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  logDebug: vi.fn(),
  logError: vi.fn(),
}));

vi.mock("../logger.js", () => ({
  logDebug: mocks.logDebug,
  logError: mocks.logError,
}));

let toToolDefinitions: typeof import("./pi-tool-definition-adapter.js").toToolDefinitions;
let BeforeToolCallBlockedError: typeof import("./pi-tools.before-tool-call.js").BeforeToolCallBlockedError;
let wrapToolParamValidation: typeof import("./pi-tools.params.js").wrapToolParamValidation;
let REQUIRED_PARAM_GROUPS: typeof import("./pi-tools.params.js").REQUIRED_PARAM_GROUPS;
let logError: typeof import("../logger.js").logError;

type ToolExecute = ReturnType<
  typeof import("./pi-tool-definition-adapter.js").toToolDefinitions
>[number]["execute"];
const extensionContext = {} as Parameters<ToolExecute>[4];

describe("pi tool definition adapter logging", () => {
  beforeAll(async () => {
    ({ toToolDefinitions } = await import("./pi-tool-definition-adapter.js"));
    ({ BeforeToolCallBlockedError } = await import("./pi-tools.before-tool-call.js"));
    ({ wrapToolParamValidation, REQUIRED_PARAM_GROUPS } = await import("./pi-tools.params.js"));
    ({ logError } = await import("../logger.js"));
  });

  beforeEach(() => {
    vi.mocked(logError).mockReset();
    mocks.logDebug.mockReset();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("logs summarized malformed edit params when required aliases are missing", async () => {
    const baseTool = {
      name: "edit",
      label: "Edit",
      description: "edits files",
      parameters: Type.Object({
        path: Type.String(),
        edits: Type.Array(
          Type.Object({
            oldText: Type.String(),
            newText: Type.String(),
          }),
        ),
      }),
      execute: async () => ({
        content: [{ type: "text" as const, text: "ok" }],
        details: { ok: true },
      }),
    } satisfies AgentTool;

    const tool = wrapToolParamValidation(baseTool, REQUIRED_PARAM_GROUPS.edit);
    const [def] = toToolDefinitions([tool]);
    if (!def) {
      throw new Error("missing tool definition");
    }

    await def.execute("call-edit-1", { path: "notes.txt" }, undefined, undefined, extensionContext);

    expect(logError).toHaveBeenCalledWith(
      expect.stringContaining(
        '[tools] edit failed: Missing required parameter: edits (received: path). Supply correct parameters before retrying. paramsPreview={"path":"notes.txt"} paramsChars=20',
      ),
    );
  });

  it("does not log params for intentional before_tool_call blocks", async () => {
    const baseTool = {
      name: "bash",
      label: "Bash",
      description: "runs commands",
      parameters: Type.Object({
        command: Type.String(),
      }),
      execute: async () => {
        throw new BeforeToolCallBlockedError("blocked by policy");
      },
    } satisfies AgentTool;
    const [def] = toToolDefinitions([baseTool], {
      runId: "run-fetch-1",
      sessionKey: "agent:main:webchat",
    });
    if (!def) {
      throw new Error("missing tool definition");
    }

    const result = await def.execute(
      "call-blocked-1",
      { command: "secret-value" },
      undefined,
      undefined,
      extensionContext,
    );

    expect(result).toEqual(
      expect.objectContaining({
        details: expect.objectContaining({
          status: "blocked",
          deniedReason: "plugin-before-tool-call",
          reason: "blocked by policy",
        }),
      }),
    );
    expect(logError).not.toHaveBeenCalled();
    expect(mocks.logDebug).toHaveBeenCalledWith(
      expect.stringContaining("[tool.call.policy_denied]"),
    );
    expect(mocks.logDebug).toHaveBeenCalledWith(expect.stringContaining("reasonPreview"));
    expect(mocks.logDebug).not.toHaveBeenCalledWith(expect.stringContaining("secret-value"));
  });

  it("accepts nested edits arrays for the current edit schema", async () => {
    const execute = vi.fn(async (_toolCallId: string, params: unknown) => ({
      content: [{ type: "text" as const, text: JSON.stringify(params) }],
      details: { ok: true },
    }));
    const baseTool = {
      name: "edit",
      label: "Edit",
      description: "edits files",
      parameters: Type.Object({
        path: Type.String(),
        edits: Type.Array(
          Type.Object({
            oldText: Type.String(),
            newText: Type.String(),
          }),
        ),
      }),
      execute,
    } satisfies AgentTool;

    const tool = wrapToolParamValidation(baseTool, REQUIRED_PARAM_GROUPS.edit);
    const [def] = toToolDefinitions([tool]);
    if (!def) {
      throw new Error("missing tool definition");
    }

    const payload = {
      path: "notes.txt",
      edits: [
        { oldText: "alpha", newText: "beta" },
        { oldText: "gamma", newText: "" },
      ],
    };

    await def.execute("call-edit-batch", payload, undefined, undefined, extensionContext);

    expect(execute).toHaveBeenCalledWith("call-edit-batch", payload, undefined, undefined);
    expect(logError).not.toHaveBeenCalled();
  });

  it("logs summarized tool size and result instead of full raw payloads", async () => {
    const consoleLog = vi.spyOn(console, "log").mockImplementation(() => undefined);
    const execute = vi.fn(async () => ({
      content: [{ type: "text" as const, text: "done" }],
      details: { ok: true, token: "sk-secret-tool-result" },
    }));
    const baseTool = {
      name: "web_fetch",
      label: "Fetch",
      description: "fetches URLs",
      parameters: Type.Object({
        url: Type.String(),
      }),
      execute,
    } satisfies AgentTool;
    const [def] = toToolDefinitions([baseTool], {
      runId: "run-fetch-1",
      sessionKey: "agent:main:webchat",
    });
    if (!def) {
      throw new Error("missing tool definition");
    }

    await def.execute(
      "call-fetch-1",
      { url: "https://example.com/path", apiKey: "sk-secret-tool-param" },
      undefined,
      undefined,
      extensionContext,
    );

    const logs = consoleLog.mock.calls.map((call) => String(call[0]));
    expect(logs).toEqual(
      expect.arrayContaining([
        expect.stringContaining("[tool.call.start] 执行工具"),
        expect.stringContaining("[tool.call.done] 工具完成"),
      ]),
    );
    expect(logs.find((line) => line.includes("[tool.call.start]"))).toContain("paramsChars=");
    expect(logs.find((line) => line.includes("[tool.call.start]"))).toContain(
      'runId="run-fetch-1"',
    );
    expect(logs.find((line) => line.includes("[tool.call.done]"))).toContain('runId="run-fetch-1"');
    expect(logs.join("\n")).not.toContain("sk-secret-tool-param");
    expect(logs.join("\n")).not.toContain("sk-secret-tool-result");
  });
});
