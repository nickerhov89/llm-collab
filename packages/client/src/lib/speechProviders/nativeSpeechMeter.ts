import {
  speechMicConstraints,
  startSpeechWaveformMonitor,
} from "./sharedMicCapture";

/** Web Speech does not expose its audio. This local-only tap measures level;
 * recognition remains independent if metering is denied or unavailable. */
export function startNativeSpeechMeter(
  onSamples: (samples: Float32Array) => void,
  micDeviceId?: string | null,
  reducePlayback?: boolean,
): () => void {
  let stopped = false;
  let stream: MediaStream | null = null;
  let stopGraph: (() => void) | null = null;
  const stop = () => {
    if (stopped) return;
    stopped = true;
    stopGraph?.();
    stream?.getTracks().forEach((track) => {
      track.stop();
    });
    stream = null;
  };
  if (!navigator.mediaDevices?.getUserMedia) return stop;
  void navigator.mediaDevices
    .getUserMedia(speechMicConstraints(micDeviceId, reducePlayback))
    .then((acquired) => {
      if (stopped) {
        acquired.getTracks().forEach((track) => {
          track.stop();
        });
        return;
      }
      stream = acquired;
      stopGraph = startSpeechWaveformMonitor(stream, (samples) => {
        if (!stopped) onSamples(samples);
      });
    })
    .catch(stop);
  return stop;
}
