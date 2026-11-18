import { createHash, randomBytes } from "node:crypto";
import { readFile, open, rename, unlink } from "node:fs/promises";
import { dirname } from "node:path";

export const integrations = [
  { id: "cowork", label: "Коворк · доступные чаты", write: false },
  { id: "portal", label: "Портал · производство", write: false },
  { id: "docs", label: "Google Docs", write: false },
  { id: "gmail", label: "Корпоративный Gmail", write: true },
  { id: "media", label: "СМИ и публикации", write: true },
  { id: "search_console", label: "Google Search Console", write: false },
  { id: "metrika", label: "Яндекс Метрика", write: false },
  { id: "webmaster", label: "Яндекс Вебмастер", write: false },
  { id: "telegram", label: "Telegram", write: true },
  { id: "direct", label: "Яндекс Директ", write: true },
  { id: "proxy", label: "Мобильный прокси", write: false },
  { id: "images", label: "Генератор изображений", write: true },
];

export async function readPolicy(file) {
  if (!file) return null;
  const bytes = await readFile(file);
  if (bytes.length > 1024 * 1024) throw Error("Access policy too large");
  const policy = JSON.parse(bytes);
  if (policy.version !== 1 || !policy.users || !policy.connections)
    throw Error("Invalid access policy");
  return {
    policy,
    revision: createHash("sha256").update(bytes).digest("hex"),
  };
}

export function publicAccess(policy, username) {
  return integrations.map((item) => ({
    ...item,
    mode: policy.users[username]?.[item.id] ?? "none",
    configured: policy.connections[item.id]?.configured === true,
    note: policy.connections[item.id]?.note ?? "Не подключено",
  }));
}

// A single service process serializes bounded policy mutations. The revision
// comparison happens inside the queue, so two stale editors cannot both win.
let mutationTail = Promise.resolve();
export function saveAccess(file, username, modes, expectedRevision) {
  const result = mutationTail.then(() =>
    saveAccessNow(file, username, modes, expectedRevision),
  );
  mutationTail = result.catch(() => {});
  return result;
}

async function saveAccessNow(file, username, modes, expectedRevision) {
  const current = await readPolicy(file);
  if (!current || current.revision !== expectedRevision)
    return { conflict: true };
  if (!Object.hasOwn(current.policy.users, username))
    throw Error("Unknown access principal");
  if (!modes || typeof modes !== "object" || Array.isArray(modes))
    throw Error("Invalid integration grants");
  const next = {};
  for (const item of integrations) {
    const mode = modes[item.id] ?? "none";
    if (!["none", "read", ...(item.write ? ["write"] : [])].includes(mode))
      throw Error("Invalid integration mode");
    if (mode !== "none" && !current.policy.connections[item.id]?.configured)
      throw Error("Integration is not configured");
    next[item.id] = mode;
  }
  if (Object.keys(modes).some((id) => !integrations.some((x) => x.id === id)))
    throw Error("Unknown integration");
  current.policy.users[username] = next;
  current.policy.updatedAt = new Date().toISOString();
  const temporary = `${file}.${randomBytes(12).toString("hex")}.tmp`;
  try {
    // Parent directory is private and owned by the trusted team service.
    const output = await open(temporary, "wx", 0o600);
    try {
      await output.writeFile(JSON.stringify(current.policy, null, 2) + "\n");
      // systemd's UMask=0077 must not strip the broker's read permission.
      await output.chmod(0o640);
      await output.sync();
    } finally {
      await output.close();
    }
    await rename(temporary, file);
    const directory = await open(dirname(file), "r");
    try {
      await directory.sync();
    } finally {
      await directory.close();
    }
  } finally {
    await unlink(temporary).catch(() => {});
  }
  return { success: true };
}
