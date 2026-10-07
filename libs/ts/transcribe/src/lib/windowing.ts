import { ANNOTATIONS_FPS, ANNOT_N_FRAMES, AUDIO_N_SAMPLES, AUDIO_SAMPLE_RATE, HOP_SIZE, N_OVERLAP_OVER_2, OVERLAP_LENGTH } from './constants';

/**
 * Split audio into overlapping model windows exactly as basic_pitch.inference does:
 * pad the front with half an overlap of silence, then take windows every HOP_SIZE samples,
 * zero-padding the last one. Returns one flat buffer of shape [nWindows, AUDIO_N_SAMPLES].
 */
export function windowAudio(samples: Float32Array): { data: Float32Array; nWindows: number } {
  const padded = new Float32Array(OVERLAP_LENGTH / 2 + samples.length);
  padded.set(samples, OVERLAP_LENGTH / 2);
  const nWindows = Math.ceil(padded.length / HOP_SIZE);
  const data = new Float32Array(nWindows * AUDIO_N_SAMPLES);
  for (let w = 0; w < nWindows; w++) {
    const start = w * HOP_SIZE;
    const slice = padded.subarray(start, Math.min(padded.length, start + AUDIO_N_SAMPLES));
    data.set(slice, w * AUDIO_N_SAMPLES);
  }
  return { data, nWindows };
}

/** Number of output frames the model should produce for `nSamples` of original audio. */
export const outputFramesFor = (nSamples: number): number => Math.floor(nSamples * (ANNOTATIONS_FPS / AUDIO_SAMPLE_RATE));

/**
 * Drop the overlapping frames from each window's output, concatenate, and trim to the
 * original audio length. Input is the model's flat output of shape [nWindows, ANNOT_N_FRAMES, bins].
 */
export function unwrapOutput(flat: Float32Array, nWindows: number, bins: number, nOriginalSamples: number): number[][] {
  const keep = ANNOT_N_FRAMES - 2 * N_OVERLAP_OVER_2;
  const nFrames = Math.min(nWindows * keep, outputFramesFor(nOriginalSamples));
  const out: number[][] = new Array(nFrames);
  for (let f = 0; f < nFrames; f++) {
    const w = Math.floor(f / keep);
    const frameInWindow = (f % keep) + N_OVERLAP_OVER_2;
    const base = (w * ANNOT_N_FRAMES + frameInWindow) * bins;
    out[f] = Array.from(flat.subarray(base, base + bins));
  }
  return out;
}
