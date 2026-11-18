import { StringDecoder } from "node:string_decoder";

/** Capture billing before forwarding terminal SSE bytes to a cancelling SDK. */
export class ResponseAccounting {
  constructor(stream, anthropic) {
    this.stream = stream;
    this.anthropic = anthropic;
    this.decoder = new StringDecoder("utf8");
    this.pending = "";
    this.bytes = 0;
    this.completed = false;
  }

  consume(chunk) {
    this.bytes += chunk.length;
    if (this.bytes > 2_000_000) throw new Error("Response too large");
    this.pending += this.decoder.write(chunk);
    if (!this.stream) return;
    let newline = this.pending.indexOf("\n");
    while (newline >= 0) {
      const line = this.pending.slice(0, newline).trimEnd();
      this.pending = this.pending.slice(newline + 1);
      if (line.startsWith("data:")) {
        try {
          this.event(JSON.parse(line.slice(5).trimStart()));
        } catch {}
      }
      newline = this.pending.indexOf("\n");
    }
  }

  event(event) {
    this.generationId =
      event.response?.id ?? event.message?.id ?? this.generationId;
    if (event.type === "response.completed") {
      this.usage = event.response?.usage;
      this.completed = true;
    }
    if (this.anthropic && event.type === "message_start")
      this.usage = event.message?.usage;
    if (this.anthropic && event.type === "message_delta")
      this.usage = { ...this.usage, ...event.usage };
    if (this.anthropic && event.type === "message_stop") this.completed = true;
  }

  finish() {
    this.pending += this.decoder.end();
    try {
      if (this.stream) {
        if (this.pending.startsWith("data:"))
          this.event(JSON.parse(this.pending.slice(5).trim()));
      } else {
        const response = JSON.parse(this.pending);
        this.generationId = response.id;
        this.usage = response.usage;
        this.completed = true;
      }
    } catch {}
    this.pending = "";
  }

  get cost() {
    const cost = this.usage?.cost;
    return this.completed &&
      typeof cost === "number" &&
      Number.isFinite(cost) &&
      cost >= 0
      ? cost
      : null;
  }
}
