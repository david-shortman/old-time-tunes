import { ANNOT_N_FRAMES, AUDIO_N_SAMPLES, HOP_SIZE, N_OVERLAP_OVER_2, OVERLAP_LENGTH } from './constants';
import { outputFramesFor, unwrapOutput, windowAudio } from './windowing';

describe('windowing', () => {
  it('pads the front with half an overlap and hops by HOP_SIZE like basic_pitch.inference', () => {
    const samples = Float32Array.from({ length: HOP_SIZE + 1000 }, (_, i) => i + 1);
    const { data, nWindows } = windowAudio(samples);
    expect(nWindows).toBe(Math.ceil((OVERLAP_LENGTH / 2 + samples.length) / HOP_SIZE));
    expect(data.length).toBe(nWindows * AUDIO_N_SAMPLES);
    expect(data[OVERLAP_LENGTH / 2 - 1]).toBe(0);
    expect(data[OVERLAP_LENGTH / 2]).toBe(1);
    // second window starts HOP_SIZE into the padded audio
    expect(data[AUDIO_N_SAMPLES]).toBe(samples[HOP_SIZE - OVERLAP_LENGTH / 2]);
  });

  it('unwraps by dropping 15 frames each side of every window and trimming to the audio length', () => {
    const nWindows = 2;
    const bins = 3;
    const flat = new Float32Array(nWindows * ANNOT_N_FRAMES * bins);
    for (let i = 0; i < flat.length; i++) flat[i] = Math.floor(i / bins); // value = global frame index
    const nSamples = 22050 * 3; // 3 s -> 258 frames, fewer than 2 * 142 available
    const out = unwrapOutput(flat, nWindows, bins, nSamples);
    expect(out.length).toBe(outputFramesFor(nSamples));
    expect(out[0][0]).toBe(N_OVERLAP_OVER_2);
    const keep = ANNOT_N_FRAMES - 2 * N_OVERLAP_OVER_2;
    expect(out[keep][0]).toBe(ANNOT_N_FRAMES + N_OVERLAP_OVER_2);
  });

  it('matches the Python frame count for a 72 s recording', () => {
    expect(outputFramesFor(Math.round(71.97 * 22050))).toBe(Math.floor(71.97 * 22050 * (86 / 22050)));
  });
});
