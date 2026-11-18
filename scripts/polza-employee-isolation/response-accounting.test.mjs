import assert from "node:assert/strict";
import test from "node:test";
import { ResponseAccounting } from "./response-accounting.mjs";

test("terminal SSE billing survives SDK cancellation and arbitrary chunk/UTF8 boundaries", () => {
  const tracker = new ResponseAccounting(true, false);
  const data = Buffer.from(
    'data: {"type":"response.created","response":{"id":"resp_gen-123-id"}}\n\ndata: {"type":"response.completed","response":{"usage":{"cost":0.003},"note":"готово"}}\r\n\r\n',
  );
  for (const byte of data) tracker.consume(Buffer.from([byte]));
  // No finish/EOF: the consumer may cancel the HTTP response immediately.
  assert.equal(tracker.cost, 0.003);
  assert.equal(tracker.generationId, "resp_gen-123-id");
});

test("partial usage is not billed as a completed generation", () => {
  const tracker = new ResponseAccounting(true, true);
  tracker.consume(
    Buffer.from(
      'data: {"type":"message_start","message":{"id":"gen-a","usage":{"cost":0.1}}}\n\n',
    ),
  );
  assert.equal(tracker.cost, null);
  tracker.consume(
    Buffer.from(
      'data: {"type":"message_delta","usage":{"cost":0.004}}\n\ndata: {"type":"message_stop"}\n\n',
    ),
  );
  assert.equal(tracker.cost, 0.004);
  const json = new ResponseAccounting(false, false);
  json.consume(Buffer.from('{"id":"gen-b","usage":{"cost":0}}'));
  json.finish();
  assert.equal(json.cost, 0);
});
