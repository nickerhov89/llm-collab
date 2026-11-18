// Operator setup, run once with the service environment. Never prints keys.
import fs from "node:fs/promises";
import path from "node:path";
import { configuration } from "./config.mjs";
import { activeActor } from "./authority.mjs";
import { createStore } from "./store.mjs";

const config = configuration();
if (!config.origin.startsWith("https://"))
  throw new Error("MEDIA_ORIGIN is required");
const store = await createStore(config, { recover: false });
try {
  for (const actor of ["owner", "marker"]) {
    if (!(await activeActor(config, actor))) continue;
    const directory = path.join(config.state, "agents");
    await fs.mkdir(directory, { recursive: true, mode: 0o700 });
    const file = path.join(directory, `${actor}.json`);
    let existing;
    try {
      existing = JSON.parse(await fs.readFile(file, "utf8"));
    } catch {
      /* First setup. */
    }
    if (
      !existing ||
      existing.origin !== config.origin ||
      existing.expires < Date.now() + 86_400_000 ||
      !store.token(existing.token) ||
      JSON.stringify([...(existing.sites || [])].sort()) !==
        JSON.stringify(Object.keys(config.sites).sort())
    ) {
      const grant = store.issue(actor, Object.keys(config.sites));
      await fs.writeFile(
        file,
        JSON.stringify({ ...grant, origin: config.origin }, null, 2),
        { mode: 0o600 },
      );
    }
    console.info(`Chat capability configured: ${actor}`);
  }
} finally {
  store.close();
}

const start = "<!-- polza-media-browser:begin -->";
const end = "<!-- polza-media-browser:end -->";
const block = `${start}
## Публикация статей прямо из чата

Если пользователь просит «залей статьи», «опубликуй кейсы» или «отправь на модерацию»,
выполняй работу в этом чате через браузерный сервис. Не отправляй пользователя
в отдельный интерфейс, не проси его готовить JSON или запускать команды.
Сначала прочитай MEDIA-BROWSER-CHAT.md и MEDIA-ACCESS-PLAN.md. Используй MCP
polza-media-browser: media_status → media_open → media_snapshot → media_login →
media_submit_job → media_job_status. Пароль подставляет сервер, не модель.
Если MCP ещё не загрузился в старый чат, есть /home/manager/.local/bin/polza-media.
CLI сам читает закрытую конфигурацию; не читай и не печатай файлы токенов.
Кабинеты и сессии находятся на VPS; пароль не требуется при живой сессии.
Человека подключай только для входа, кода/капчи или действительно отсутствующих
исходных данных. По готовности верни ссылки на материалы и фактические статусы.
Завершённый браузерный план не равен одобренной модерации.
${end}`;
const agentsFile = path.join(config.project, "AGENTS.md");
let previous = "";
try {
  previous = await fs.readFile(agentsFile, "utf8");
} catch {
  /* New project. */
}
if (!previous.includes(start))
  await fs
    .writeFile(`${agentsFile}.before-media-browser-20261112`, previous, {
      mode: 0o600,
      flag: "wx",
    })
    .catch((error) => {
      if (error.code !== "EEXIST") throw error;
    });
const begin = previous.indexOf(start);
const finish = previous.indexOf(end);
const content =
  begin >= 0 && finish > begin
    ? previous.slice(0, begin) + block + previous.slice(finish + end.length)
    : previous.trimEnd() + "\n\n" + block + "\n";
await fs.writeFile(agentsFile, content, { mode: 0o600 });
await fs.copyFile(
  new URL("./CHAT-INSTRUCTIONS.md", import.meta.url),
  path.join(config.project, "MEDIA-BROWSER-CHAT.md"),
);
await fs.copyFile(
  new URL("./ROOT-SERGEY.md", import.meta.url),
  path.join(config.project, "MEDIA-BROWSER-SERGEY.md"),
);
await fs.copyFile(
  new URL("./ACCESS-PLAN.md", import.meta.url),
  path.join(config.project, "MEDIA-ACCESS-PLAN.md"),
);
const codexDirectory = path.join(config.project, ".codex");
await fs.mkdir(codexDirectory, { recursive: true, mode: 0o700 });
const codexFile = path.join(codexDirectory, "config.toml");
let codex = await fs.readFile(codexFile, "utf8").catch(() => "");
if (!codex.includes("[mcp_servers.polza-media-browser]")) {
  codex += `\n[mcp_servers.polza-media-browser]\ncommand = "/usr/local/bin/node"\nargs = ["${new URL("./mcp.mjs", import.meta.url).pathname}"]\ncwd = "${config.project}"\nenabled = true\nstartup_timeout_sec = 20\ntool_timeout_sec = 90\n`;
  await fs.writeFile(codexFile, codex, { mode: 0o600 });
}
const mcpFile = path.join(config.project, ".mcp.json");
const mcp = JSON.parse(await fs.readFile(mcpFile, "utf8").catch(() => "{}"));
mcp.mcpServers ??= {};
mcp.mcpServers["polza-media-browser"] ??= {
  command: "/usr/local/bin/node",
  args: [new URL("./mcp.mjs", import.meta.url).pathname],
  cwd: config.project,
};
await fs.writeFile(mcpFile, JSON.stringify(mcp, null, 2), { mode: 0o600 });
console.info(
  "SEO & PR chat instructions installed; no separate project App or dashboard added.",
);
