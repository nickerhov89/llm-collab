import { test } from "node:test";
import assert from "node:assert/strict";
import { EmployeeAdmission } from "./employee-admission.mjs";

test("parallel chats and independent accounts survive cancellation and duplicate settlement", async () => {
  const gate = new EmployeeAdmission(["marker", "ceo"], {
    perAccount: 2,
    maxActive: 3,
    maxPending: 2,
    maxBytes: 10,
    maxWaitMs: 1000,
  });
  const a = await gate.acquire("marker", 2);
  const b = await gate.acquire("marker", 2);
  const abort = new AbortController();
  const queued = gate.acquire("marker", 2, abort.signal);
  const rejected = assert.rejects(queued, /cancelled/);
  const c = await gate.acquire("ceo", 2);
  assert.equal(gate.active, 3);
  assert.equal(gate.queue.length, 1);
  abort.abort();
  await rejected;
  assert.equal(gate.queue.length, 0);
  a();
  a();
  assert.equal(gate.active, 2);
  assert.equal(gate.bytes, 4);
  const d = await gate.acquire("marker", 2);
  b();
  c();
  d();
  d();
  assert.equal(gate.active, 0);
  assert.equal(gate.bytes, 0);
});

test("memory backpressure queues without partial buffers and cancellation unblocks next account", async () => {
  const gate = new EmployeeAdmission(["a", "b", "c"], {
    maxBytes: 8,
    maxWaitMs: 1000,
  });
  const a = await gate.acquire("a", 6);
  const abort = new AbortController();
  const b = gate.acquire("b", 5, abort.signal);
  const cancelled = assert.rejects(b, /cancelled/);
  const c = gate.acquire("c", 1);
  assert.equal(gate.active, 1);
  assert.equal(gate.queue.length, 2);
  assert.equal(gate.bytes, 6);
  abort.abort();
  await cancelled;
  const releaseC = await c;
  assert.equal(gate.active, 2);
  a();
  releaseC();
  assert.equal(gate.bytes, 0);
});

test("pending bounds and wait deadline release all queue state", async () => {
  const gate = new EmployeeAdmission(["a"], {
    perAccount: 1,
    maxPending: 1,
    maxWaitMs: 15,
  });
  const a = await gate.acquire("a", 1);
  const waiting = gate.acquire("a", 1);
  await assert.rejects(gate.acquire("a", 1), /Too many queued/);
  await assert.rejects(waiting, /wait limit/);
  assert.equal(gate.queue.length, 0);
  a();
  const b = await gate.acquire("a", 1);
  b();
  assert.equal(gate.active, 0);
});

test("four employees each get four concurrent chats with independent pending queues", async () => {
  const names = ["ceo", "cfo", "cto", "marker"];
  const gate = new EmployeeAdmission(names);
  const releases = new Map();
  for (const name of names) {
    const list = [];
    for (let n = 0; n < 4; n++) list.push(await gate.acquire(name, 1));
    releases.set(name, list);
  }
  assert.equal(gate.active, 16);
  const fifth = gate.acquire("marker", 1);
  assert.equal(gate.queue.length, 1);
  releases.get("marker")[0]();
  const extra = await fifth;
  for (const name of names) assert.equal(gate.running.get(name), 4);
  for (const list of releases.values()) for (const release of list) release();
  extra();
  assert.equal(gate.active, 0);
  assert.equal(gate.bytes, 0);
});
