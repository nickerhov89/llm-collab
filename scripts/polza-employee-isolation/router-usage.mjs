/** Read-only OpenRouter billing; never forwards credentials or prompt content. */
export class RouterUsage {
  constructor(key, fetcher = fetch) {
    this.key = key;
    this.fetcher = fetcher;
    this.snapshot = null;
    this.pending = null;
  }

  async read(path) {
    const response = await this.fetcher(
      `https://openrouter.ai/api/v1/${path}`,
      {
        headers: { authorization: `Bearer ${this.key}` },
        signal: AbortSignal.timeout(5000),
      },
    );
    if (!response.ok) throw new Error("OpenRouter billing unavailable");
    return (await response.json()).data;
  }

  async get() {
    if (
      this.snapshot &&
      Date.now() - Date.parse(this.snapshot.fetchedAt) < 60_000
    )
      return this.snapshot;
    if (!this.pending)
      this.pending = this.load().finally(() => {
        this.pending = null;
      });
    try {
      return await this.pending;
    } catch {
      return this.snapshot ? { ...this.snapshot, stale: true } : null;
    }
  }

  async load() {
    const [key, credits] = await Promise.all([
      this.read("key"),
      this.read("credits"),
    ]);
    const number = (value) =>
      typeof value === "number" && Number.isFinite(value) && value >= 0
        ? value
        : null;
    if (number(key.usage_daily) === null)
      throw new Error("Invalid Router billing");
    this.snapshot = {
      source: "openrouter-api",
      fetchedAt: new Date().toISOString(),
      utcDay: new Date().toISOString().slice(0, 10),
      spentToday: key.usage_daily,
      spentTotal: number(key.usage),
      keyLimit: number(key.limit),
      keyRemaining: number(key.limit_remaining),
      creditBalance:
        number(credits.total_credits) !== null &&
        number(credits.total_usage) !== null
          ? Math.max(0, credits.total_credits - credits.total_usage)
          : null,
      stale: false,
    };
    return this.snapshot;
  }

  async generation(id) {
    const generation = id?.replace(/^resp_/, "");
    if (!/^gen-[A-Za-z0-9_-]{1,150}$/.test(generation ?? "")) return null;
    try {
      const data = await this.read(
        `generation?id=${encodeURIComponent(generation)}`,
      );
      return data.id === generation &&
        typeof data.total_cost === "number" &&
        Number.isFinite(data.total_cost) &&
        data.total_cost >= 0
        ? data.total_cost
        : null;
    } catch {
      return null;
    }
  }
}
