// @vitest-environment jsdom
import { afterEach, expect, it, vi } from "vitest";
import { startNativeSpeechMeter } from "../speechProviders/nativeSpeechMeter";

const graph = vi.hoisted(() => ({ start: vi.fn(), stop: vi.fn() }));
vi.mock("../speechProviders/sharedMicCapture", () => ({
  speechMicConstraints: () => ({ audio: true }),
  startSpeechWaveformMonitor: (...args: unknown[]) => {
    graph.start(...args);
    return graph.stop;
  },
}));

afterEach(() => {
  vi.unstubAllGlobals();
  vi.clearAllMocks();
});

function pendingCapture() {
  let resolve!: (stream: MediaStream) => void;
  let reject!: (error: Error) => void;
  const promise = new Promise<MediaStream>((yes, no) => {
    resolve = yes;
    reject = no;
  });
  const getUserMedia = vi.fn(() => promise);
  vi.stubGlobal("navigator", { mediaDevices: { getUserMedia } });
  const stopTrack = vi.fn();
  const stream = {
    getTracks: () => [{ stop: stopTrack }],
  } as unknown as MediaStream;
  return { resolve, reject, stream, stopTrack, getUserMedia };
}

it("releases a late permission grant after stop without starting an audio graph", async () => {
  const capture = pendingCapture();
  const stop = startNativeSpeechMeter(vi.fn());
  stop();
  capture.resolve(capture.stream);
  await Promise.resolve();
  expect(capture.stopTrack).toHaveBeenCalledOnce();
  expect(graph.start).not.toHaveBeenCalled();
});

it("stops graph and tracks once and ignores samples arriving after disposal", async () => {
  const capture = pendingCapture();
  const samples = vi.fn();
  const stop = startNativeSpeechMeter(samples);
  capture.resolve(capture.stream);
  await Promise.resolve();
  const emit = graph.start.mock.calls[0]?.[1] as (data: Float32Array) => void;
  const data = new Float32Array([0.1, -0.4]);
  emit(data);
  expect(samples).toHaveBeenCalledWith(data);
  stop();
  stop();
  emit(data);
  expect(samples).toHaveBeenCalledOnce();
  expect(graph.stop).toHaveBeenCalledOnce();
  expect(capture.stopTrack).toHaveBeenCalledOnce();
});

it("contains metering permission failures and allows a fresh attempt", async () => {
  const capture = pendingCapture();
  const stop = startNativeSpeechMeter(vi.fn());
  capture.reject(new Error("denied"));
  await Promise.resolve();
  await Promise.resolve();
  stop();
  const retry = pendingCapture();
  const finish = startNativeSpeechMeter(vi.fn());
  retry.resolve(retry.stream);
  await Promise.resolve();
  expect(graph.start).toHaveBeenCalledOnce();
  finish();
  expect(retry.stopTrack).toHaveBeenCalledOnce();
});
