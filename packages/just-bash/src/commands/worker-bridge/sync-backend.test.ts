import { Worker } from "node:worker_threads";
import { afterEach, describe, expect, it } from "vitest";
import { createSharedBuffer } from "./protocol.js";
import { SyncBackend } from "./sync-backend.js";

// Stand-in for the main thread, written against the buffer layout in
// protocol.ts: status at Int32 index 1, result length at index 4, result
// bytes at offset 4128. Once the request is READY it wakes the waiting
// thread without changing the status, which is what the notify for the
// previous operation does when it lands late. After `delayMs` it answers
// the request, unless `answer` is false.
const HOST_SOURCE = `
const { workerData } = require("node:worker_threads");
const { sharedBuffer, answer, delayMs } = workerData;
const control = new Int32Array(sharedBuffer);
const bytes = new Uint8Array(sharedBuffer);
const STATUS = 1, RESULT_LENGTH = 4, DATA_BUFFER = 4128;
const READY = 1, SUCCESS = 2;
const sleep = (ms) => Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, ms);
const giveUpAt = Date.now() + 5000;
while (Atomics.load(control, STATUS) !== READY) {
  if (Date.now() > giveUpAt) throw new Error("request never became READY");
  sleep(1);
}
while (Atomics.notify(control, STATUS, 1) === 0) {
  if (Date.now() > giveUpAt) throw new Error("backend never waited");
}
sleep(delayMs);
if (answer) {
  bytes.set([111, 107], DATA_BUFFER);
  Atomics.store(control, RESULT_LENGTH, 2);
  Atomics.store(control, STATUS, SUCCESS);
  Atomics.notify(control, STATUS);
}
`;

let host: Worker | undefined;

afterEach(async () => {
  await host?.terminate();
  host = undefined;
});

function startHost(
  sharedBuffer: SharedArrayBuffer,
  options: { answer: boolean; delayMs: number },
): void {
  host = new Worker(HOST_SOURCE, {
    eval: true,
    workerData: { sharedBuffer, ...options },
  });
}

describe("SyncBackend", () => {
  it("keeps waiting when woken before the request is answered", () => {
    const sharedBuffer = createSharedBuffer();
    const backend = new SyncBackend(sharedBuffer, 5000);
    startHost(sharedBuffer, { answer: true, delayMs: 100 });

    const content = backend.readFile("/home/user/file.txt");

    expect(new TextDecoder().decode(content)).toBe("ok");
  });

  it("times out at the operation deadline when woken without an answer", () => {
    const sharedBuffer = createSharedBuffer();
    const backend = new SyncBackend(sharedBuffer, 300);
    startHost(sharedBuffer, { answer: false, delayMs: 0 });

    const start = Date.now();
    expect(() => backend.readFile("/home/user/file.txt")).toThrow(
      "Operation timed out",
    );
    expect(Date.now() - start).toBeGreaterThanOrEqual(250);
  });
});
