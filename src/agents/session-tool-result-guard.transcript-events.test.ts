import type { AgentMessage } from "@mariozechner/pi-agent-core";
import { SessionManager } from "@mariozechner/pi-coding-agent";
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  onSessionTranscriptUpdate,
  type SessionTranscriptUpdate,
} from "../sessions/transcript-events.js";
import { guardSessionManager } from "./session-tool-result-guard-wrapper.js";

const listeners: Array<() => void> = [];

afterEach(() => {
  vi.restoreAllMocks();
  while (listeners.length > 0) {
    listeners.pop()?.();
  }
});

describe("guardSessionManager transcript updates", () => {
  it("logs user persistence at the SessionManager append boundary", () => {
    const consoleLog = vi.spyOn(console, "log").mockImplementation(() => undefined);
    const sm = SessionManager.inMemory();
    const guarded = guardSessionManager(sm, {
      runId: "run-user",
      agentId: "main",
      sessionKey: "agent:main:worker",
    });

    (guarded as any).appendMessage({
      role: "user",
      content: [{ type: "text", text: "hello" }],
      timestamp: Date.now(),
    } as AgentMessage);

    expect(consoleLog).toHaveBeenCalledWith(
      expect.stringContaining(
        '[transcript.write.user] 写入用户消息 | 用户 turn 已持久化到 transcript runId="run-user" sessionKey="agent:main:worker"',
      ),
    );
  });

  it("logs only final assistant persistence while broadcasting assistant transcript messages", () => {
    const consoleLog = vi.spyOn(console, "log").mockImplementation(() => undefined);
    const updates: SessionTranscriptUpdate[] = [];
    listeners.push(onSessionTranscriptUpdate((update) => updates.push(update)));

    const sm = SessionManager.inMemory();
    const sessionFile = "/tmp/openclaw-session-message-events.jsonl";
    Object.assign(sm, {
      getSessionFile: () => sessionFile,
    });

    const guarded = guardSessionManager(sm, {
      runId: "run-transcript",
      agentId: "main",
      sessionKey: "agent:main:worker",
    });
    const appendMessage = guarded.appendMessage.bind(guarded) as unknown as (
      message: AgentMessage,
    ) => void;

    appendMessage({
      role: "assistant",
      content: [
        {
          type: "toolCall",
          id: "call-1",
          name: "read",
          arguments: { path: "/tmp/example.txt" },
        },
      ],
      timestamp: Date.now(),
    } as unknown as AgentMessage);
    appendMessage({
      role: "assistant",
      content: [{ type: "text", text: "hello from subagent" }],
      timestamp: Date.now(),
    } as AgentMessage);

    expect(updates).toHaveLength(2);
    expect(updates[1]).toMatchObject({
      sessionFile,
      sessionKey: "agent:main:worker",
      message: {
        role: "assistant",
      },
    });
    const logs = consoleLog.mock.calls.map((call) => String(call[0]));
    expect(logs.filter((line) => line.includes("[transcript.write.assistant]"))).toEqual([
      expect.stringContaining(
        '[transcript.write.assistant] 写入助手消息 | assistant final reply 已持久化到 transcript runId="run-transcript" sessionKey="agent:main:worker"',
      ),
    ]);
  });
});
