import { AUDIO_SAMPLE_RATE } from './constants';

/**
 * Decode any browser-supported audio file to mono samples at the model's sample rate.
 * Decoding through an OfflineAudioContext at 22.05 kHz makes the browser do the resampling.
 */
export async function decodeToModelRate(data: ArrayBuffer): Promise<Float32Array> {
  const ctx = new OfflineAudioContext(1, 1, AUDIO_SAMPLE_RATE);
  const buffer = await ctx.decodeAudioData(data.slice(0));
  const n = buffer.length;
  const mono = new Float32Array(n);
  for (let ch = 0; ch < buffer.numberOfChannels; ch++) {
    const d = buffer.getChannelData(ch);
    for (let i = 0; i < n; i++) mono[i] += d[i];
  }
  if (buffer.numberOfChannels > 1) for (let i = 0; i < n; i++) mono[i] /= buffer.numberOfChannels;
  return mono;
}
