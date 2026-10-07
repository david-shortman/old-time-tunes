/** Turn transcribed notes back into sound in the browser, and pull waveform peaks out of audio. */
import type { OTTNote } from '@ot-tunes/notes';

const SAMPLE_RATE = 22050;

export function notesEnd(notes: ReadonlyArray<OTTNote>): number {
  return notes.reduce(
    (m, n) => Math.max(m, n.startTimeSeconds + n.durationSeconds),
    0
  );
}

/**
 * Render notes to an AudioBuffer with a simple bowed-string-ish voice
 * (sawtooth → low-pass → envelope). `rate` time-stretches without changing pitch.
 */
export async function renderNotes(
  notes: ReadonlyArray<OTTNote>,
  durationSeconds: number,
  rate = 1
): Promise<AudioBuffer> {
  const length = Math.max(
    1,
    Math.ceil(((durationSeconds + 0.5) / rate) * SAMPLE_RATE)
  );
  const ctx = new OfflineAudioContext(1, length, SAMPLE_RATE);
  const master = ctx.createGain();
  master.gain.value = 0.9;
  master.connect(ctx.destination);

  for (const n of notes) {
    const start = n.startTimeSeconds / rate;
    const dur = Math.max(0.03, n.durationSeconds / rate);
    const osc = ctx.createOscillator();
    osc.type = 'sawtooth';
    osc.frequency.value = 440 * Math.pow(2, (n.pitchMidi - 69) / 12);
    if (n.pitchBends && n.pitchBends.length > 1) {
      // bends are in semitones relative to the note; detune is in cents
      const cents = Float32Array.from(n.pitchBends, (b) =>
        Math.max(-200, Math.min(200, b * 100))
      );
      osc.detune.setValueCurveAtTime(cents, start, dur);
    }
    const filter = ctx.createBiquadFilter();
    filter.type = 'lowpass';
    filter.frequency.value = Math.min(8000, osc.frequency.value * 6);
    filter.Q.value = 0.7;

    const env = ctx.createGain();
    const level = 0.18 * (0.4 + 0.6 * Math.min(1, n.amplitude));
    const attack = Math.min(0.02, dur / 3);
    const release = Math.min(0.05, dur / 3);
    env.gain.setValueAtTime(0, start);
    env.gain.linearRampToValueAtTime(level, start + attack);
    env.gain.setValueAtTime(level, start + dur - release);
    env.gain.linearRampToValueAtTime(0, start + dur);

    osc.connect(filter).connect(env).connect(master);
    osc.start(start);
    osc.stop(start + dur + 0.01);
  }
  return ctx.startRendering();
}

/** Decode a URL (or object URL) to an AudioBuffer. */
export async function decodeAudioUrl(url: string): Promise<AudioBuffer> {
  const res = await fetch(url);
  const data = await res.arrayBuffer();
  const ctx = new AudioContext();
  try {
    return await ctx.decodeAudioData(data);
  } finally {
    void ctx.close();
  }
}

/** Max-abs amplitude per bin across `bins` equal time slices covering `durationSeconds`. */
export function waveformPeaks(
  buffer: AudioBuffer,
  bins: number,
  durationSeconds: number
): Float32Array {
  const peaks = new Float32Array(bins);
  const samplesPerBin = (durationSeconds * buffer.sampleRate) / bins;
  for (let ch = 0; ch < buffer.numberOfChannels; ch++) {
    const data = buffer.getChannelData(ch);
    for (let b = 0; b < bins; b++) {
      const s0 = Math.floor(b * samplesPerBin);
      const s1 = Math.min(data.length, Math.floor((b + 1) * samplesPerBin));
      let max = 0;
      for (let i = s0; i < s1; i++) {
        const v = Math.abs(data[i]);
        if (v > max) max = v;
      }
      if (max > peaks[b]) peaks[b] = max;
    }
  }
  return peaks;
}
