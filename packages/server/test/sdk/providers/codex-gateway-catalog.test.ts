import { createServer } from "node:http";
import { once } from "node:events";
import { mkdtemp, readFile, readdir, rm, stat } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, expect, it } from "vitest";
import { prepareCodexGatewayCatalog } from "../../../src/sdk/providers/codex-gateway-catalog.js";

const cleanup: Array<() => Promise<unknown>> = [];
afterEach(async () => {
  for (const dispose of cleanup.splice(0).reverse()) await dispose();
});
async function fixture(status = 200) {
  const directory = await mkdtemp(join(tmpdir(), "codex-catalog-"));
  cleanup.push(() => rm(directory, { recursive: true, force: true }));
  const server = createServer((req, res) => {
    expect(req.url).toBe("/v1/models");
    expect(req.headers.authorization).toBeUndefined();
    res.writeHead(status, { "content-type": "application/json" });
    res.end(
      JSON.stringify({
        data: [
          { id: "vendor/other", max_model_len: 1000 },
          {
            id: "vendor/selected",
            name: "Selected",
            max_model_len: 262144,
            input_modalities: ["text", "image"],
          },
        ],
      }),
    );
  });
  server.listen(0, "127.0.0.1");
  await once(server, "listening");
  cleanup.push(
    () =>
      new Promise<void>((resolve) => {
        server.closeAllConnections();
        server.close(() => resolve());
      }),
  );
  const address = server.address();
  if (!address || typeof address === "string") throw Error("Missing address");
  return { directory, url: `http://127.0.0.1:${address.port}` };
}
it("publishes selected native metadata privately and releases only its own launch directory", async () => {
  const f = await fixture();
  const a = await prepareCodexGatewayCatalog(
    f.url,
    "vendor/selected",
    { levels: ["low", "high"], defaultLevel: "low" },
    f.directory,
  );
  const b = await prepareCodexGatewayCatalog(
    f.url,
    "vendor/selected",
    undefined,
    f.directory,
  );
  expect(a.path).not.toBe(b.path);
  const data = JSON.parse(await readFile(a.path, "utf8"));
  expect(data.models).toHaveLength(1);
  expect(data.models[0]).toMatchObject({
    slug: "vendor/selected",
    context_window: 262144,
    max_context_window: 262144,
    input_modalities: ["text", "image"],
    supports_reasoning_summary_parameter: false,
    support_verbosity: false,
    supported_reasoning_levels: [
      { effort: "low", description: "low" },
      { effort: "high", description: "high" },
    ],
  });
  expect(
    data.models[0].model_messages.instructions_template.length,
  ).toBeGreaterThan(10000);
  expect((await stat(a.path)).mode & 0o777).toBe(0o600);
  await a.dispose();
  await expect(stat(a.path)).rejects.toMatchObject({ code: "ENOENT" });
  expect((await stat(b.path)).isFile()).toBe(true);
  await b.dispose();
  expect(await readdir(f.directory)).toEqual([]);
});
it("does not claim missing models or leak launch files on catalog failures and abort", async () => {
  const f = await fixture();
  await expect(
    prepareCodexGatewayCatalog(f.url, "missing", undefined, f.directory),
  ).rejects.toThrow("absent");
  await expect(
    prepareCodexGatewayCatalog(
      f.url,
      "vendor/selected",
      undefined,
      f.directory,
      AbortSignal.abort(),
    ),
  ).rejects.toMatchObject({ name: "AbortError" });
  expect(await readdir(f.directory)).toEqual([]);
  const unavailable = await fixture(503);
  await expect(
    prepareCodexGatewayCatalog(
      unavailable.url,
      "vendor/selected",
      undefined,
      unavailable.directory,
    ),
  ).rejects.toThrow("metadata unavailable");
  expect(await readdir(unavailable.directory)).toEqual([]);
});
