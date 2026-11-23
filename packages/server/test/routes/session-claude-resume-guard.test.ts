import type { ClaudeSessionEntry, UrlProjectId } from "@yep-anywhere/shared";
import { describe, expect, it } from "vitest";
import { getClaudeResumeBlockerFromReader } from "../../src/routes/session-claude-resume-guard.js";
import type { ISessionReader } from "../../src/sessions/types.js";

const projectId = "project" as UrlProjectId;
const sessionId = "same-session";

function entry(
  type: "user" | "assistant",
  uuid: string,
  parentUuid: string | null,
  apiErrorStatus?: number,
): ClaudeSessionEntry {
  return {
    type,
    uuid,
    parentUuid,
    sessionId,
    timestamp: "2026-11-20T00:00:00.000Z",
    isSidechain: false,
    ...(apiErrorStatus ? { isApiErrorMessage: true, apiErrorStatus } : {}),
    message: {
      id: uuid,
      role: type,
      content: [{ type: "text", text: apiErrorStatus ? "API error" : "task" }],
    },
  } as ClaudeSessionEntry;
}

function reader(messages: ClaudeSessionEntry[]): ISessionReader {
  return {
    getSession: async () => ({
      data: { provider: "claude", session: { messages } },
    }),
  } as unknown as ISessionReader;
}

describe("Claude first-turn API-error recovery", () => {
  it.each([402, 429, 500, 529])(
    "recovers after repeated %s errors without a successful assistant",
    async (status) => {
      const messages = [
        entry("user", "original-task", null),
        entry("assistant", "error-1", "original-task", status),
        entry("user", "additional-instruction", "error-1"),
        entry("assistant", "error-2", "additional-instruction", status),
      ];
      const blocker = await getClaudeResumeBlockerFromReader(
        reader(messages),
        sessionId,
        projectId,
      );
      expect(blocker?.resumeAtMessageId).toBe("additional-instruction");
      expect(blocker?.apiErrorStatus).toBe(status);
      expect(messages).toHaveLength(4);
      expect(messages[1]?.isApiErrorMessage).toBe(true);
    },
  );

  it("does not treat an error-only orphan as a resumable user turn", async () => {
    const blocker = await getClaudeResumeBlockerFromReader(
      reader([entry("assistant", "orphan-error", null, 402)]),
      sessionId,
      projectId,
    );
    expect(blocker?.resumeAtMessageId).toBeUndefined();
    expect(blocker?.recovery).toBe("handoff-required");
  });

  it("does not rewind an already successful continuation", async () => {
    expect(
      await getClaudeResumeBlockerFromReader(
        reader([
          entry("user", "task", null),
          entry("assistant", "error", "task", 402),
          entry("assistant", "success", "error"),
        ]),
        sessionId,
        projectId,
      ),
    ).toBeNull();
  });
});
