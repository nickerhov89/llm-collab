import { test } from "node:test";
import assert from "node:assert/strict";
import { mediaBrokerCall, legacyMediaRequest } from "./broker-client.mjs";

test("media MCP preserves open URL and uses UID broker without actor/bearer", async () => {
  let call;
  const result = await mediaBrokerCall(
    "media_open",
    {
      site: "workspace",
      url: "https://workspace.ru/personal/cases/",
      actor: "owner",
      token: "never-send",
    },
    async (...args) => {
      call = args;
      return { stdout: JSON.stringify({ ok: true, result: { opened: true } }) };
    },
  );
  assert.deepEqual(result, { opened: true });
  assert.equal(call[0], "/usr/local/bin/polza-integration");
  assert.deepEqual(JSON.parse(call[1][1]), {
    site: "workspace",
    url: "https://workspace.ru/personal/cases/",
  });
  assert.deepEqual(legacyMediaRequest("/media/agent/sites/workspace/open"), [
    "media_open",
    { site: "workspace" },
  ]);
});

test("a rejected UID request fails closed and is never replayed", async () => {
  let calls = 0;
  await assert.rejects(
    mediaBrokerCall("media_status", {}, async () => {
      calls++;
      throw Object.assign(new Error("exit"), {
        stdout: JSON.stringify({
          ok: false,
          error: "Integration access denied",
        }),
      });
    }),
    /Integration access denied/,
  );
  assert.equal(calls, 1);
  assert.throws(
    () => legacyMediaRequest("/media/agent/agents"),
    /unknown_media_route/,
  );
});
