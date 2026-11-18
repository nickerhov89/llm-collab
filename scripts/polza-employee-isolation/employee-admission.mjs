/** Bounded, cancellable request admission; no per-session polling or retries. */
export class AdmissionError extends Error {
  constructor(code, message) {
    super(message);
    this.code = code;
  }
}

export class EmployeeAdmission {
  constructor(
    accounts,
    {
      perAccount = 4,
      maxActive = 16,
      maxPending = 6,
      maxBytes = 24 * 1024 * 1024,
      maxWaitMs = 90_000,
    } = {},
  ) {
    this.running = new Map(accounts.map((name) => [name, 0]));
    this.perAccount = perAccount;
    this.maxActive = maxActive;
    this.maxPending = maxPending;
    this.maxBytes = maxBytes;
    this.maxWaitMs = maxWaitMs;
    this.queue = [];
    this.active = 0;
    this.bytes = 0;
  }

  acquire(account, bytes, signal) {
    if (
      !this.running.has(account) ||
      !Number.isSafeInteger(bytes) ||
      bytes < 0 ||
      bytes > this.maxBytes
    )
      return Promise.reject(
        new AdmissionError("invalid", "Invalid model admission"),
      );
    if (signal?.aborted)
      return Promise.reject(
        new AdmissionError("cancelled", "Model request cancelled"),
      );
    if (
      this.queue.filter((item) => item.account === account).length >=
      this.maxPending
    )
      return Promise.reject(
        new AdmissionError(
          "full",
          "Too many queued model requests; wait for current chats to finish",
        ),
      );
    return new Promise((resolve, reject) => {
      const entry = { account, bytes, resolve, reject, signal };
      const cancel = (error) => {
        const index = this.queue.indexOf(entry);
        if (index < 0) return;
        this.queue.splice(index, 1);
        entry.cleanup();
        reject(error);
        this.drain();
      };
      const aborted = () =>
        cancel(new AdmissionError("cancelled", "Model request cancelled"));
      const timer = setTimeout(
        () =>
          cancel(
            new AdmissionError(
              "timeout",
              "Model queue wait limit reached; current requests took too long",
            ),
          ),
        this.maxWaitMs,
      );
      entry.cleanup = () => {
        clearTimeout(timer);
        signal?.removeEventListener("abort", aborted);
      };
      signal?.addEventListener("abort", aborted, { once: true });
      this.queue.push(entry);
      this.drain();
    });
  }

  drain() {
    while (this.active < this.maxActive) {
      // FIFO among eligible accounts: a saturated account cannot block others.
      const index = this.queue.findIndex(
        (item) => this.running.get(item.account) < this.perAccount,
      );
      if (index < 0) return;
      const entry = this.queue[index];
      // Preserve the oldest eligible large request rather than starving it
      // behind a perpetual stream of small ones. Existing owners will release.
      if (this.bytes + entry.bytes > this.maxBytes) return;
      this.queue.splice(index, 1);
      entry.cleanup();
      this.active++;
      this.bytes += entry.bytes;
      this.running.set(entry.account, this.running.get(entry.account) + 1);
      let released = false;
      entry.resolve(() => {
        if (released) return;
        released = true;
        this.active--;
        this.bytes -= entry.bytes;
        this.running.set(entry.account, this.running.get(entry.account) - 1);
        this.drain();
      });
    }
  }
}
