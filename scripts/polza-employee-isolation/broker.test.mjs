import { spawn } from "node:child_process";
import { once } from "node:events";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import assert from "node:assert/strict";

test("broker admits native-sized JSON while retaining payload, model and budget gates", async () => {
  const directory = await mkdtemp(join(tmpdir(), "employee-broker-"));
  const config = join(directory, "config.json");
  const ledger = join(directory, "ledger.json");
  await writeFile(
    config,
    JSON.stringify({
      model: "allowed-model",
      upstreamKey: "unused-synthetic-key",
      accounts: { marker: { token: "synthetic-capability", dailyLimit: 0 } },
    }),
  );
  // Run the real broker on an ephemeral test port, leaving production binding
  // unchanged. None of these requests may reach an upstream provider.
  const source = await readFile(
    new URL("./broker.mjs", import.meta.url),
    "utf8",
  );
  const fixture = join(directory, "broker.mjs");
  assert.ok(source.includes('server.listen(3456, "127.0.0.1");'));
  await writeFile(
    fixture,
    source.replace(
      'server.listen(3456, "127.0.0.1");',
      'server.listen(0, "127.0.0.1", () => process.send(server.address().port));',
    ),
  );
  const child = spawn(process.execPath, [fixture], {
    env: { ...process.env, BROKER_CONFIG: config, BROKER_LEDGER: ledger },
    stdio: ["ignore", "ignore", "inherit", "ipc"],
  });
  try {
    const [port] = await once(child, "message");
    const call = (body, token = "synthetic-capability") =>
      fetch(`http://127.0.0.1:${port}/v1/responses`, {
        method: "POST",
        headers: {
          authorization: `Bearer ${token}`,
          "content-type": "application/json",
        },
        body: JSON.stringify(body),
      });
    const largeHistory = "x".repeat(200000);
    assert.equal(
      (await call({ model: "wrong-model", input: largeHistory })).status,
      403,
    );
    // A payload that passed parsing still cannot spend beyond its daily cap.
    assert.equal(
      (await call({ model: "allowed-model", input: largeHistory })).status,
      429,
    );
    assert.equal(
      (await call({ model: "allowed-model" }, "wrong-capability")).status,
      401,
    );
    assert.equal(
      (
        await call({
          model: "allowed-model",
          input: "x".repeat(2 * 1024 * 1024),
        })
      ).status,
      413,
    );
    assert.equal((await call({ model: "wrong-model" })).status, 403);
  } finally {
    const exited = once(child, "exit");
    child.kill();
    await exited;
    await rm(directory, { recursive: true, force: true });
  }
});
