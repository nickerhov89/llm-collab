import { readFile, writeFile, mkdir, rename } from "node:fs/promises";
import { homedir } from "node:os";
import { join } from "node:path";

// Local-only maintenance: no prompts, inference, credentials or chat changes.
const directory = join(homedir(), ".local/state/polza-model-catalog");
const snapshot = join(directory, "snapshot.json");
let previous;
try {
  previous = JSON.parse(await readFile(snapshot, "utf8"));
} catch (error) {
  if (error.code !== "ENOENT") throw Error("Catalog snapshot unavailable");
}
try {
  const response = await fetch("http://127.0.0.1:3451/catalog/refresh", {
    method: "POST",
    headers: { authorization: "Bearer dummy" },
    signal: AbortSignal.timeout(20000),
  });
  const result = await response.json();
  if (!response.ok || !result.data?.length) {
    console.log(
      JSON.stringify({
        ok: false,
        status: response.status,
        catalog: result.catalog,
        lastSuccessfulCheck: previous?.checkedAt ?? null,
      }),
    );
    process.exitCode = 1;
  } else {
    const ids = result.data.map((row) => row.id);
    const before = new Set(previous?.models ?? []);
    const after = new Set(ids);
    const added = ids.filter((id) => !before.has(id));
    const removed = [...before].filter((id) => !after.has(id));
    const checkedAt = new Date().toISOString();
    await mkdir(directory, { recursive: true, mode: 0o700 });
    const temporary = snapshot + "." + process.pid;
    await writeFile(
      temporary,
      JSON.stringify({ checkedAt, models: ids }) + "\n",
      { mode: 0o600 },
    );
    await rename(temporary, snapshot);
    console.log(
      JSON.stringify({
        ok: true,
        checkedAt,
        count: ids.length,
        imageCapable: result.data.filter((row) =>
          row.input_modalities?.includes("image"),
        ).length,
        baseline: !previous,
        added,
        removed,
        catalog: result.catalog,
      }),
    );
  }
} catch {
  console.log(
    JSON.stringify({
      ok: false,
      error: "Catalog refresh unavailable",
      lastSuccessfulCheck: previous?.checkedAt ?? null,
    }),
  );
  process.exitCode = 1;
}
