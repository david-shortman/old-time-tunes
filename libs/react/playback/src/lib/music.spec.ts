import type { OTTNote } from '@ot-tunes/notes';
import { estimateTempo, normalizeRhythm } from './music';

/** Build notes from (pitch, beats) pairs at a tempo, with onset jitter and short plucked durations. */
function tune(bpm: number, pattern: Array<[number, number]>, jitterMs = 20, start = 0.4): OTTNote[] {
  const beat = 60 / bpm;
  let t = start;
  let seed = 7;
  const rnd = () => ((seed = (seed * 9301 + 49297) % 233280) / 233280 - 0.5) * 2;
  return pattern.map(([pitch, beats]) => {
    const n: OTTNote = {
      pitchMidi: pitch,
      noteName: '',
      startTimeSeconds: t + (rnd() * jitterMs) / 1000,
      durationSeconds: 0.12 + rnd() * 0.03, // a kalimba note the model hears as short
      amplitude: 0.8,
      pitchBends: [],
    };
    t += beats * beat;
    return n;
  });
}

// Mary Had a Little Lamb, first phrase: E D C D | E E E(2) | D D D(2) | E G G(2)
const MARY: Array<[number, number]> = [
  [64, 1], [62, 1], [60, 1], [62, 1],
  [64, 1], [64, 1], [64, 2],
  [62, 1], [62, 1], [62, 2],
  [64, 1], [67, 1], [67, 2],
];

describe('estimateTempo', () => {
  it.each([72, 96, 120])('recovers %i BPM from quarter-note onsets with jitter, ignoring durations', (bpm) => {
    const t = estimateTempo(tune(bpm, MARY));
    expect(Math.abs(t.bpm - bpm) / bpm).toBeLessThan(0.03);
  });

  it('does not double the tempo when every interval is a quarter note', () => {
    const t = estimateTempo(tune(100, MARY, 5));
    expect(t.bpm).toBeGreaterThan(90);
    expect(t.bpm).toBeLessThan(110);
  });

  it('handles a reel of eighth notes', () => {
    const reel: Array<[number, number]> = Array.from({ length: 32 }, (_, i) => [62 + (i % 5), i % 8 === 7 ? 1 : 0.5]);
    const t = estimateTempo(tune(112, reel, 10));
    expect(Math.abs(t.bpm - 112) / 112).toBeLessThan(0.03);
  });

  it('anchors the offset on the first onset', () => {
    const notes = tune(100, MARY, 0);
    const t = estimateTempo(notes);
    const beat = 60 / t.bpm;
    const phase = ((notes[0].startTimeSeconds - t.offset) % beat) / beat;
    expect(Math.min(phase, 1 - phase)).toBeLessThan(0.02);
  });
});

describe('normalizeRhythm', () => {
  it('gives quarter notes quarter widths and half notes half widths from onsets alone', () => {
    const notes = tune(100, MARY);
    const tempo = estimateTempo(notes);
    const out = normalizeRhythm(notes, tempo, 0.5);
    const beat = 60 / tempo.bpm;
    const widths = out.map((n) => Math.round((n.durationSeconds / beat) * 4) / 4);
    expect(widths.slice(0, 6)).toEqual([1, 1, 1, 1, 1, 1]);
    expect(widths[6]).toBe(2);
    expect(widths[9]).toBe(2);
    // onsets sit on the grid
    for (const n of out) {
      const r = ((n.startTimeSeconds - tempo.offset) / (beat / 2)) % 1;
      expect(Math.min(r, 1 - r)).toBeLessThan(1e-6);
    }
  });

  it('keeps a rest when the gap to the next note is long', () => {
    const pattern: Array<[number, number]> = [[64, 1], [62, 1], [60, 4], [62, 1]];
    const notes = tune(100, pattern, 0);
    const tempo = { bpm: 100, offset: notes[0].startTimeSeconds };
    const out = normalizeRhythm(notes, tempo, 0.5);
    const beat = 0.6;
    expect(out[2].durationSeconds).toBeLessThan(2 * beat + 1e-6); // not stretched across the 4-beat gap
    expect(out[1].durationSeconds).toBeCloseTo(beat, 5);
  });
});

// Real onsets: Katie's kalimba take of Mary Had a Little Lamb (2026-10-07), as transcribed in the browser.
const KALIMBA = 'F#4@1.58 E4@1.97 C#4@2.42 D4@2.49 F#4@3.29 F#4@3.68 E4@4.67 E4@5.06 E4@5.45 F#4@6.16 A4@6.58 A4@6.99 F#4@7.79 D4@8.46 F#4@9.85 F#4@10.22 F#4@10.56 E4@10.90 E4@11.29 F#4@11.77 E4@12.17 D4@12.70 E4@13.57 F#4@14.07 A4@14.56 C#5@15.16 A4@15.19 D5@15.93 D5@16.40';
const NAME_TO_MIDI: Record<string, number> = { C: 0, 'C#': 1, D: 2, 'D#': 3, E: 4, F: 5, 'F#': 6, G: 7, 'G#': 8, A: 9, 'A#': 10, B: 11 };
const kalimba: OTTNote[] = KALIMBA.split(' ').map((tok, i, all) => {
  const [name, t] = tok.split('@');
  const pc = name.slice(0, -1);
  const oct = Number(name.slice(-1));
  // the two glitch onsets (C#4 before D4, C#5 before A4) are very short; everything else rings ~0.12 s
  const glitch = i + 1 < all.length && parseFloat(all[i + 1].split('@')[1]) - parseFloat(t) < 0.1;
  return { pitchMidi: NAME_TO_MIDI[pc] + (oct + 1) * 12, noteName: name, startTimeSeconds: parseFloat(t), durationSeconds: glitch ? 0.05 : 0.12, amplitude: 0.7, pitchBends: [] };
});

describe('a real kalimba take of Mary Had a Little Lamb', () => {
  it('finds the pulse at ~75 or ~151 BPM (both are valid readings of 0.4 s notes)', () => {
    const t = estimateTempo(kalimba);
    const ratio = t.bpm / 75.5;
    expect(Math.min(Math.abs(ratio - 1), Math.abs(ratio - 2))).toBeLessThan(0.04);
  });

  it('fit-to-grid merges the attack glitches and yields widths of one or two grid units almost everywhere', () => {
    const tempo = estimateTempo(kalimba);
    const out = normalizeRhythm(kalimba, tempo, 0.5);
    const unit = (60 / tempo.bpm) * 0.5;
    expect(out.length).toBe(kalimba.length - 2); // C#4→D4 and C#5→A4 glitches merged
    expect(out.find((n) => n.noteName === 'C#4')).toBeUndefined();
    const units = out.map((n) => Math.round(n.durationSeconds / unit));
    const regular = units.filter((u) => u === 1 || u === 2 || u === 4).length;
    expect(regular / units.length).toBeGreaterThan(0.85);
    // starts on the grid
    for (const n of out) {
      const r = ((n.startTimeSeconds - tempo.offset) / unit) % 1;
      expect(Math.min(r, 1 - r)).toBeLessThan(1e-6);
    }
  });
});
