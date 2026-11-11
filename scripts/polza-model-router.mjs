#!/usr/bin/env node
import { spawn } from "node:child_process";
import { createHash, randomUUID } from "node:crypto";
import {
  appendFile,
  chmod,
  mkdir,
  mkdtemp,
  readFile,
  rm,
} from "node:fs/promises";
import { homedir, tmpdir } from "node:os";
import path from "node:path";
import { pathToFileURL } from "node:url";
import {
  findModelPrices,
  tokenCostUsd,
} from "../packages/shared/dist/model-prices.js";

export const POLICY_VERSION = "2026-11-10.3";
const model = (provider, id) => ({ provider, model: id });
const haiku = model("claude", "haiku");
const luna = model("codex", "gpt-6-luna");

export function chooseRoute({ task = "general", publicData = false }) {
  if (!["code", "writing", "analysis", "extract", "general"].includes(task))
    throw new Error("Unknown task category");
  if (publicData && task !== "code")
    return [
      model("gemini", "gemini-3.5-flash-lite"),
      task === "writing" ? haiku : luna,
    ];
  if (task === "code") return [luna, model("codex", "gpt-6.1-sol")];
  if (task === "writing") return [haiku, model("claude", "sonnet")];
  if (task === "analysis") return [haiku, model("claude", "opus")];
  return [haiku, luna];
}

export function classifyFailure(text) {
  if (
    /429|quota|rate.limit|usage.limit|resource.exhausted|capacity/i.test(text)
  )
    return "rate-limit";
  if (/401|403|unauth|not.logged.in|api.key|authentication|oauth/i.test(text))
    return "auth-required";
  if (
    /404|model.*(not found|unavailable|not supported)|not found.*model/i.test(
      text,
    )
  )
    return "model-unavailable";
  if (/network|ECONN|ETIMEDOUT|ENOTFOUND|fetch failed/i.test(text))
    return "transport";
  if (/untrusted|trusted directory|trust.workspace/i.test(text))
    return "workspace-trust";
  if (/sandbox|namespace|Operation not permitted|bwrap/i.test(text))
    return "sandbox";
  if (/database|sqlite|lock|already in use|busy/i.test(text))
    return "runtime-busy";
  if (
    /unexpected argument|unrecognized|unknown argument|invalid argument|unknown option/i.test(
      text,
    )
  )
    return "invocation";
  return "provider-error";
}

export function parseAnswer(provider, stdout) {
  if (provider === "codex") {
    const rows = stdout
      .trim()
      .split("\n")
      .flatMap((line) => {
        try {
          return [JSON.parse(line)];
        } catch {
          return [];
        }
      });
    return rows
      .filter(
        (row) =>
          row.type === "item.completed" && row.item?.type === "agent_message",
      )
      .map((row) => row.item.text)
      .join("\n");
  }
  const data = JSON.parse(stdout);
  if (data.is_error || data.error)
    throw new Error("Provider returned an error");
  return provider === "claude" ? (data.result ?? "") : (data.response ?? "");
}

export function parseUsage(provider, stdout) {
  const number = (value) =>
    typeof value === "number" && Number.isFinite(value) && value >= 0
      ? value
      : null;
  const safeModel = (value) =>
    typeof value === "string" && /^[a-z0-9/._-]{1,100}$/i.test(value)
      ? value
      : null;
  try {
    const rows =
      provider === "codex"
        ? stdout
            .trim()
            .split("\n")
            .flatMap((line) => {
              try {
                return [JSON.parse(line)];
              } catch {
                return [];
              }
            })
        : [];
    const data = provider === "codex" ? rows.at(-1) : JSON.parse(stdout);
    const modelUsage = data?.modelUsage ?? data?.stats?.models ?? {};
    const models = Object.keys(modelUsage);
    const modelCounts = Object.values(modelUsage).filter(
      (v) => v && typeof v === "object",
    );
    const sum = (keys) =>
      modelCounts.reduce(
        (total, item) =>
          total +
          (number(keys.map((k) => item[k]).find((v) => number(v) !== null)) ??
            0),
        0,
      );
    let usage = data?.usage;
    if (provider === "codex") {
      const tokenRows = rows.filter(
        (row) =>
          row.type === "event_msg" && row.payload?.type === "token_count",
      );
      usage =
        tokenRows.at(-1)?.payload?.info?.last_token_usage ??
        tokenRows.at(-1)?.payload?.info?.total_token_usage;
    }
    if (provider === "claude" && modelCounts.length) {
      usage = {
        input_tokens: sum(["inputTokens", "input_tokens"]),
        output_tokens: sum(["outputTokens", "output_tokens"]),
        cache_read_input_tokens: sum([
          "cacheReadInputTokens",
          "cache_read_input_tokens",
        ]),
        cache_creation_input_tokens: sum([
          "cacheCreationInputTokens",
          "cache_creation_input_tokens",
        ]),
      };
      if (Object.values(usage).every((value) => value === 0))
        usage = data?.usage;
    }
    if (provider === "gemini" && modelCounts.length) {
      // Gemini CLI's JSON output reports per-model token classes under stats.models.
      const tokens = modelCounts.map((item) => item.tokens ?? item);
      usage = {
        input_tokens: tokens.reduce(
          (n, item) =>
            n +
            (number(
              item.prompt ??
                item.input ??
                item.inputTokens ??
                item.input_tokens ??
                item.promptTokenCount,
            ) ?? 0),
          0,
        ),
        output_tokens: tokens.reduce(
          (n, item) =>
            n +
            (number(
              item.response ??
                item.output ??
                item.outputTokens ??
                item.output_tokens ??
                item.candidatesTokenCount,
            ) ?? 0),
          0,
        ),
        cached_input_tokens: tokens.reduce(
          (n, item) =>
            n +
            (number(
              item.cached ??
                item.cachedInput ??
                item.cachedContentTokenCount ??
                item.cached_input_tokens,
            ) ?? 0),
          0,
        ),
      };
    }
    const input = number(usage?.input_tokens ?? usage?.inputTokens) ?? 0;
    const cached =
      number(
        usage?.cached_input_tokens ??
          usage?.cache_read_input_tokens ??
          usage?.cachedInputTokens,
      ) ?? 0;
    const cacheWrite =
      number(
        usage?.cache_creation_input_tokens ??
          usage?.cacheCreationInputTokens ??
          usage?.cache_write_input_tokens,
      ) ?? 0;
    const output = number(usage?.output_tokens ?? usage?.outputTokens) ?? 0;
    const reportedCost =
      number(data?.total_cost_usd) ?? sum(["costUSD", "cost_usd"]);
    return {
      reportedModel: models.length === 1 ? safeModel(models[0]) : null,
      reportedModels: models.map(safeModel).filter(Boolean),
      apiEquivalentCostUsd: reportedCost || null,
      apiEquivalentCostBasis: reportedCost
        ? "provider-reported-list-equivalent"
        : null,
      tokenUsage: usage
        ? {
            freshInput: Math.max(0, input - cached - cacheWrite),
            cachedInput: cached,
            cacheWrite,
            output,
          }
        : null,
    };
  } catch {
    return {};
  }
}

function apiEquivalentCost(provider, modelId, tokenUsage) {
  if (!tokenUsage) return null;
  const prices = findModelPrices(provider, modelId);
  if (!prices) return null;
  return tokenCostUsd(
    {
      freshInputTokens: tokenUsage.freshInput ?? 0,
      cachedInputTokens: tokenUsage.cachedInput ?? 0,
      cacheWriteTokens: tokenUsage.cacheWrite ?? 0,
      outputTokens: tokenUsage.output ?? 0,
    },
    prices,
    { provider, model: modelId },
  );
}

export function checkJsonAnswer(answer, requiredKeys = []) {
  if (!requiredKeys.length) return answer.trim().length > 0;
  try {
    const value = JSON.parse(
      answer.trim().replace(/^```(?:json)?\s*|\s*```$/g, ""),
    );
    return (
      !!value &&
      typeof value === "object" &&
      requiredKeys.every((key) => Object.hasOwn(value, key))
    );
  } catch {
    return false;
  }
}

function eligibleAttempts(options) {
  return options.escalate
    ? chooseRoute(options).slice(1, 2)
    : chooseRoute(options).slice(0, options.maxAttempts ?? 2);
}

export async function routeTask(options, { run, record = async () => {} }) {
  const chain = eligibleAttempts(options);
  const taskId = options.taskId ?? randomUUID();
  const promptHash = createHash("sha256").update(options.prompt).digest("hex");
  const events = [];
  for (const [index, selected] of chain.entries()) {
    const start = Date.now();
    let result;
    try {
      result = await run(selected, options.prompt);
    } catch {
      result = { exitCode: 1, answer: "" };
    }
    const accepted =
      result.exitCode === 0 &&
      checkJsonAnswer(result.answer ?? "", options.requiredKeys);
    const event = {
      eventType: "attempt",
      taskId,
      policyVersion: POLICY_VERSION,
      at: new Date().toISOString(),
      task: options.task ?? "general",
      routeSource: options.escalate ? "helper-escalation" : "helper-auto",
      publicData: options.publicData === true,
      promptHash,
      promptChars: options.prompt.length,
      attempt: index + 1,
      ...selected,
      reportedModel: result.reportedModel ?? null,
      reportedModels: result.reportedModels ?? [],
      durationMs: Date.now() - start,
      exitCode: result.exitCode,
      acceptance: options.requiredKeys?.length
        ? "json-required-keys"
        : "nonempty-output",
      passed: options.requiredKeys?.length ? accepted : null,
      executionSucceeded: result.exitCode === 0,
      reviewRequired: true,
      routeStep: options.escalate ? 2 : index + 1,
      reason: options.escalate
        ? "explicit-escalation-after-review"
        : index
          ? "previous-attempt-failed"
          : "lowest-cost-eligible",
      billingMode:
        selected.provider === "gemini"
          ? "api-key-free-tier-or-paid-unknown"
          : "cli-account-billing-unknown",
      actualCostUsd: null,
      apiEquivalentCostUsd:
        result.apiEquivalentCostUsd ??
        apiEquivalentCost(
          selected.provider,
          result.reportedModel ?? selected.model,
          result.tokenUsage,
        ),
      apiEquivalentCostBasis:
        result.apiEquivalentCostBasis ??
        (result.tokenUsage &&
        apiEquivalentCost(
          selected.provider,
          result.reportedModel ?? selected.model,
          result.tokenUsage,
        ) !== null
          ? "shared-published-price-table"
          : null),
      actualCostStatus: "not-reported-by-provider-cli",
      tokenUsage: result.tokenUsage ?? null,
      failureCode: accepted
        ? null
        : (result.failureCode ??
          (result.exitCode === 0 ? "acceptance-failed" : "provider-error")),
    };
    events.push(event);
    await record(event);
    if (accepted) return { taskId, selected, answer: result.answer, events };
  }
  return { taskId, selected: null, answer: "", events };
}

async function runCli(selected, prompt, directory, requiredKeys) {
  const env = {
    ...process.env,
    UV_THREADPOOL_SIZE: "1",
    NODE_OPTIONS: "--v8-pool-size=1",
    GOMAXPROCS: "2",
  };
  // The subscription helpers must not silently inherit pay-as-you-go API keys.
  if (selected.provider !== "gemini")
    for (const key of [
      "ANTHROPIC_API_KEY",
      "OPENAI_API_KEY",
      "OPENROUTER_API_KEY",
    ])
      delete env[key];
  if (selected.provider === "gemini") {
    // This explicitly trusted folder is empty and private, not the agency repo.
    // A separate CLI home prevents implicit inclusion of the owner's context.
    env.GEMINI_CLI_TRUST_WORKSPACE = "true";
    env.GEMINI_CLI_HOME = directory;
    for (const key of [
      "GEMINI_SYSTEM_MD",
      "GEMINI_WRITE_SYSTEM_MD",
      "GOOGLE_GENAI_USE_VERTEXAI",
      "GOOGLE_GENAI_USE_GCA",
    ])
      delete env[key];
    await appendFile(
      path.join(directory, "tools-disabled.toml"),
      '[[rule]]\ntoolName = "*"\ndecision = "deny"\npriority = 999\n',
      { mode: 0o600 },
    );
    const config = path.join(directory, ".gemini");
    await mkdir(config, { recursive: true, mode: 0o700 });
    await appendFile(
      path.join(config, "settings.json"),
      JSON.stringify({
        security: { auth: { selectedType: "gemini-api-key" } },
        context: { fileName: [] },
      }),
      { mode: 0o600 },
    );
  }
  const args =
    selected.provider === "claude"
      ? [
          "-p",
          "--model",
          selected.model,
          "--tools",
          "",
          "--output-format",
          "json",
          "--no-session-persistence",
        ]
      : selected.provider === "codex"
        ? [
            "exec",
            "--model",
            selected.model,
            "--sandbox",
            "read-only",
            "--ephemeral",
            "--skip-git-repo-check",
            "--json",
            "-",
          ]
        : [
            "--model",
            selected.model,
            "--output-format",
            "json",
            "--policy",
            path.join(directory, "tools-disabled.toml"),
            "-p",
            "Answer the task provided on standard input.",
          ];
  const executable =
    process.env[`POLZA_${selected.provider.toUpperCase().replaceAll("-", "_")}_CLI_BIN`] ??
    selected.provider;
  const input = requiredKeys.length
    ? `${prompt}\nReturn only valid JSON containing keys: ${requiredKeys.join(", ")}.`
    : prompt;
  return new Promise((resolve) => {
    const child = spawn(executable, args, {
      cwd: directory,
      env,
      stdio: ["pipe", "pipe", "pipe"],
      detached: true,
    });
    let stderr = "",
      stdout = "",
      settled = false;
    const finish = (result) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      resolve(result);
    };
    const terminate = () => {
      try {
        process.kill(-child.pid, "SIGKILL");
      } catch {}
    };
    const timer = setTimeout(() => {
      terminate();
      finish({ exitCode: 124, answer: "", failureCode: "timeout" });
    }, 90_000);
    child.stdout.on("data", (chunk) => {
      stdout += chunk;
      if (stdout.length > 2_000_000) {
        terminate();
        finish({ exitCode: 125, answer: "" });
      }
    });
    child.stderr.on("data", (chunk) => {
      if (stderr.length < 16000) stderr += chunk;
    });
    child.stdin.on("error", () => {});
    child.on("error", () => finish({ exitCode: 127, answer: "" }));
    child.on("close", (code) => {
      try {
        finish({
          ...parseUsage(selected.provider, stdout),
          exitCode: code ?? 1,
          failureCode: code === 0 ? null : classifyFailure(stdout + stderr),
          answer: code === 0 ? parseAnswer(selected.provider, stdout) : "",
        });
      } catch {
        finish({ exitCode: 1, answer: "" });
      }
    });
    child.stdin.end(input);
  });
}

async function main() {
  process.umask(0o077);
  const args = process.argv.slice(2);
  const value = (name) => {
    const i = args.indexOf(name);
    return i >= 0 ? args[i + 1] : undefined;
  };
  if (args.includes("--help")) {
    console.log(
      "polza-model-router --task code|writing|analysis|extract|general --input-file FILE [--public] [--expect-json key1,key2] [--dry-run]\nPrivate data stays on Claude/Codex. --public explicitly allows Gemini on public/synthetic data. Two attempts maximum; existing chats do not change provider. Metadata-only journal; no prompt or answer text. --escalate selects the stronger eligible candidate after your own failed review; reuse --task-id UUID to link attempts. Nonempty output/valid JSON is not a verified result. Use --record --provider NAME --model ID --task KIND --check tests|review|none --outcome passed|failed|unverified [--route-source helper-auto|helper-escalation|ui-auto|manual-agent] to record a real review without another model call. API-equivalent cost is an estimate, never actual spend.",
    );
    return;
  }
  const options = {
    task: value("--task") ?? "general",
    publicData: args.includes("--public"),
    requiredKeys: (value("--expect-json") ?? "").split(",").filter(Boolean),
    maxAttempts: Number(value("--max-attempts") ?? 2),
    escalate: args.includes("--escalate"),
    taskId: value("--task-id"),
  };
  if (
    options.taskId &&
    !/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(
      options.taskId,
    )
  )
    throw new Error("--task-id must be a UUID");
  if (![1, 2].includes(options.maxAttempts))
    throw new Error("--max-attempts must be 1 or 2");
  const chain = eligibleAttempts(options);
  if (args.includes("--dry-run")) {
    console.log(
      JSON.stringify({ policyVersion: POLICY_VERSION, ...options, chain }),
    );
    return;
  }
  if (args.includes("--record")) {
    const provider = value("--provider");
    const modelId = value("--model");
    const check = value("--check") ?? "none";
    const outcome = value("--outcome") ?? "unverified";
    const routeSource = value("--route-source") ?? "manual-agent";
    if (
      !["claude", "codex", "gemini", "codex-oss"].includes(provider) ||
      !/^[a-z0-9/._-]{1,100}$/i.test(modelId ?? "") ||
      !["tests", "review", "none"].includes(check) ||
      !["passed", "failed", "unverified"].includes(outcome) ||
      !["helper-auto", "helper-escalation", "ui-auto", "manual-agent"].includes(
        routeSource,
      ) ||
      (outcome === "passed" && check === "none")
    )
      throw new Error(
        "Record requires a valid provider, model, outcome and a real check for passed results",
      );
    const stateDir =
      process.env.POLZA_ROUTER_STATE_DIR ??
      path.join(homedir(), ".local", "state", "polza-model-router");
    await mkdir(stateDir, { recursive: true, mode: 0o700 });
    await appendFile(
      path.join(stateDir, "events.jsonl"),
      `${JSON.stringify({ eventType: "review", taskId: options.taskId ?? randomUUID(), policyVersion: POLICY_VERSION, at: new Date().toISOString(), task: options.task, publicData: options.publicData, routeSource, provider, model: modelId, reportedModel: null, acceptance: check, outcome, passed: outcome === "unverified" ? null : outcome === "passed", actualCostUsd: null, actualCostStatus: "not-reconciled", apiEquivalentCostUsd: null, billingMode: "manual-run-billing-unknown", reason: "agent-observed-result" })}\n`,
      { mode: 0o600 },
    );
    console.log("Recorded task metadata; no prompt or answer text.");
    return;
  }
  const inputFile = value("--input-file");
  if (!inputFile) throw new Error("--input-file is required");
  const prompt = await readFile(inputFile, "utf8");
  if (!prompt.trim() || prompt.length > 120_000)
    throw new Error("Prompt must contain 1–120000 characters");
  const stateDir = path.join(
    process.env.POLZA_ROUTER_STATE_DIR ??
      path.join(homedir(), ".local", "state", "polza-model-router"),
  );
  await mkdir(stateDir, { recursive: true, mode: 0o700 });
  await chmod(stateDir, 0o700);
  const journal = path.join(stateDir, "events.jsonl");
  const directory = await mkdtemp(path.join(tmpdir(), "polza-model-task-"));
  try {
    const result = await routeTask(
      { ...options, prompt },
      {
        run: (selected, text) =>
          runCli(selected, text, directory, options.requiredKeys),
        record: (event) =>
          appendFile(journal, `${JSON.stringify(event)}\n`, { mode: 0o600 }),
      },
    );
    if (!result.selected) {
      console.error(
        "Both eligible attempts failed. See the metadata journal; no successful result was recorded.",
      );
      process.exitCode = 1;
      return;
    }
    console.error(
      `Task: ${result.taskId}; Model: ${result.selected.provider}/${result.selected.model}; attempts: ${result.events.length}; journal: ${journal}`,
    );
    console.log(result.answer);
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
}
if (
  process.argv[1] &&
  import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href
)
  main().catch((error) => {
    console.error(error.message);
    process.exitCode = 1;
  });
