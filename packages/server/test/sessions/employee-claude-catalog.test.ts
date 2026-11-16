import { mkdtemp, mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { toUrlProjectId } from "@yep-anywhere/shared";
import { expect, it, vi } from "vitest";
import { SessionIndexService } from "../../src/indexes/SessionIndexService.js";
import { SessionReader } from "../../src/sessions/reader.js";

const boundary = vi.hoisted(() => ({ dedicated: false }));
vi.mock("../../src/auth/dedicatedEmployeeRuntime.js", () => ({
  get DEDICATED_EMPLOYEE_RUNTIME() {
    return boundary.dedicated;
  },
}));

it("repairs cached Qwen provider inference once without touching native history or shared routing", async () => {
  const directory = await mkdtemp(join(tmpdir(), "employee-catalog-"));
  try {
    const sessionDir = join(directory, "sessions");
    await mkdir(sessionDir);
    const file = join(sessionDir, "chat.jsonl");
    const history =
      [
        {
          type: "user",
          uuid: "u1",
          parentUuid: null,
          timestamp: "2026-11-16T00:00:00.000Z",
          message: { role: "user", content: "Test" },
        },
        {
          type: "assistant",
          uuid: "a1",
          parentUuid: "u1",
          timestamp: "2026-11-16T00:00:01.000Z",
          message: {
            role: "assistant",
            model: "qwen/qwen3-coder",
            content: [{ type: "text", text: "OK" }],
          },
        },
      ]
        .map((x) => JSON.stringify(x))
        .join("\n") + "\n";
    await writeFile(file, history);
    const options = {
      dataDir: join(directory, "indexes"),
      projectsDir: directory,
    };
    const projectId = toUrlProjectId("/private/project");
    boundary.dedicated = false;
    const original = new SessionIndexService(options);
    await original.initialize();
    const shared = await original.getSessionsWithCache(
      sessionDir,
      projectId,
      new SessionReader({ sessionDir }),
    );
    expect(shared[0]?.provider).toBe("claude-ollama");
    boundary.dedicated = true;
    const corrected = new SessionIndexService(options);
    await corrected.initialize();
    const first = await corrected.getSessionsWithCache(
      sessionDir,
      projectId,
      new SessionReader({ sessionDir }),
    );
    expect(first[0]?.provider).toBe("claude");
    const reloaded = new SessionIndexService(options);
    await reloaded.initialize();
    const reader = new SessionReader({ sessionDir });
    const parse = vi.spyOn(reader, "getSessionSummary");
    const second = await reloaded.getSessionsWithCache(
      sessionDir,
      projectId,
      reader,
    );
    expect(second[0]?.provider).toBe("claude");
    expect(parse).not.toHaveBeenCalled();
    expect(await readFile(file, "utf8")).toBe(history);
  } finally {
    boundary.dedicated = false;
    await rm(directory, { recursive: true, force: true });
  }
});
