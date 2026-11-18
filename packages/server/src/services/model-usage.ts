import type { ModelUsageSummary } from "@yep-anywhere/shared";
import { readFile } from "node:fs/promises";
import { DEDICATED_EMPLOYEE_RUNTIME } from "../auth/dedicatedEmployeeRuntime.js";

/** Fixed loopback endpoint. Owner gets a status-only capability, never staff keys. */
export async function readModelUsage(
  token = DEDICATED_EMPLOYEE_RUNTIME
    ? process.env.OPENAI_API_KEY
    : process.env.POLZA_MODEL_USAGE_TOKEN,
): Promise<ModelUsageSummary | null> {
  try {
    token ??= (
      await readFile("/etc/polza-employees/owner-usage-token", "utf8")
    ).trim();
    if (!token) return null;
    const response = await fetch("http://127.0.0.1:3456/v1/status", {
      headers: { authorization: `Bearer ${token}` },
      signal: AbortSignal.timeout(7000),
    });
    if (!response.ok) return null;
    const text = await response.text();
    if (text.length > 16_384) return null;
    const data = JSON.parse(text) as ModelUsageSummary;
    if (!Number.isFinite(data.active) || !Number.isFinite(data.queued))
      return null;
    return data;
  } catch {
    return null;
  }
}
