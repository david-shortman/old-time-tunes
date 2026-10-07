/** Key detection, tempo estimation, scale rows and note values for the editor grid. */
import type { OTTNote } from '@ot-tunes/notes';
import { midiToNoteName } from './fingering';

export const PC_NAMES = ['C', 'C#', 'D', 'D#', 'E', 'F', 'F#', 'G', 'G#', 'A', 'A#', 'B'];

export type Mode = 'major' | 'minor';
export type KeyInfo = { tonic: number; mode: Mode; name: string };
export type Tempo = { bpm: number; offset: number };

const MAJOR = [0, 2, 4, 5, 7, 9, 11];
const MINOR = [0, 2, 3, 5, 7, 8, 10];
// Krumhansl–Schmuckler key profiles
const KS_MAJOR = [6.35, 2.23, 3.48, 2.33, 4.38, 4.09, 2.52, 5.19, 2.39, 3.66, 2.29, 2.88];
const KS_MINOR = [6.33, 2.68, 3.52, 5.38, 2.6, 3.53, 2.54, 4.75, 3.98, 2.69, 3.34, 3.17];

export const makeKey = (tonic: number, mode: Mode): KeyInfo => ({ tonic, mode, name: `${PC_NAMES[tonic]} ${mode}` });

export const ALL_KEYS: KeyInfo[] = [
  ...Array.from({ length: 12 }, (_, t) => makeKey(t, 'major')),
  ...Array.from({ length: 12 }, (_, t) => makeKey(t, 'minor')),
];

function pearson(a: number[], b: number[]): number {
  const n = a.length;
  const ma = a.reduce((s, v) => s + v, 0) / n;
  const mb = b.reduce((s, v) => s + v, 0) / n;
  let num = 0;
  let da = 0;
  let db = 0;
  for (let i = 0; i < n; i++) {
    num += (a[i] - ma) * (b[i] - mb);
    da += (a[i] - ma) ** 2;
    db += (b[i] - mb) ** 2;
  }
  return da && db ? num / Math.sqrt(da * db) : 0;
}

/** Keys fiddlers actually play in, weighted; everything else gets no bonus. */
const FIDDLE_KEY_PRIOR: Record<string, number> = {
  'D major': 0.08, 'A major': 0.07, 'G major': 0.07, 'C major': 0.04, 'E major': 0.02, 'F major': 0.02, 'A# major': 0.02,
  'A minor': 0.04, 'E minor': 0.04, 'D minor': 0.04, 'B minor': 0.02, 'G minor': 0.02,
};

/**
 * Most likely key of a monophonic tune. Mostly "which scale covers the most playing time",
 * then the evidence a fiddler uses to hear the tonic: phrase endings and long held notes,
 * with a small prior for common fiddle keys. The pitch-class profile only breaks ties.
 */
export function detectKey(notes: ReadonlyArray<OTTNote>): KeyInfo {
  if (!notes.length) return makeKey(2, 'major'); // D major, the fiddler's default
  const pc = (m: number) => ((m % 12) + 12) % 12;
  const sorted = [...notes].sort((a, b) => a.startTimeSeconds - b.startTimeSeconds);

  const hist = new Array<number>(12).fill(0);
  const phraseEnd = new Array<number>(12).fill(0);
  const held = new Array<number>(12).fill(0);
  const durs = sorted.map((n) => n.durationSeconds).sort((a, b) => b - a);
  const longCut = durs[Math.floor(durs.length * 0.1)] ?? 0;
  for (let i = 0; i < sorted.length; i++) {
    const n = sorted[i];
    const w = n.durationSeconds * (0.5 + n.amplitude);
    hist[pc(n.pitchMidi)] += w;
    const next = sorted[i + 1];
    const gap = next ? next.startTimeSeconds - (n.startTimeSeconds + n.durationSeconds) : 1;
    if (gap > 0.2) phraseEnd[pc(n.pitchMidi)] += w;
    if (n.durationSeconds >= longCut) held[pc(n.pitchMidi)] += w;
  }
  const total = hist.reduce((a, b) => a + b, 0) || 1;
  const peTotal = phraseEnd.reduce((a, b) => a + b, 0) || 1;
  const heldTotal = held.reduce((a, b) => a + b, 0) || 1;

  let best = makeKey(2, 'major');
  let bestScore = -Infinity;
  for (let t = 0; t < 12; t++) {
    for (const [mode, degrees, profile] of [['major', MAJOR, KS_MAJOR], ['minor', MINOR, KS_MINOR]] as const) {
      const key = makeKey(t, mode);
      const scale = degrees.map((d) => (t + d) % 12);
      const coverage = scale.reduce((s, p) => s + hist[p], 0) / total;
      const tonic = 0.6 * (phraseEnd[t] / peTotal) + 0.4 * (held[t] / heldTotal);
      const fifth = (t + 7) % 12;
      const tonicOrFifth = 0.3 * (phraseEnd[fifth] / peTotal);
      const rotated = hist.map((_, i) => hist[(i + t) % 12]);
      const score = coverage + 0.3 * tonic + 0.1 * tonicOrFifth + (FIDDLE_KEY_PRIOR[key.name] ?? 0) + 0.05 * pearson(rotated, profile);
      if (score > bestScore) {
        bestScore = score;
        best = key;
      }
    }
  }
  return best;
}

export const scalePitchClasses = (key: KeyInfo): number[] => (key.mode === 'major' ? MAJOR : MINOR).map((d) => (key.tonic + d) % 12);

export const isInScale = (midi: number, key: KeyInfo): boolean => scalePitchClasses(key).includes(((midi % 12) + 12) % 12);

/** Ascending scale tones within [lo, hi]. */
export function scaleTones(key: KeyInfo, lo: number, hi: number): number[] {
  const out: number[] = [];
  for (let m = lo; m <= hi; m++) if (isInScale(m, key)) out.push(m);
  return out;
}

/** Degree label like "1", "♭3", "♯4" for a pitch relative to the key. */
export function degreeLabel(midi: number, key: KeyInfo): string {
  const pc = (((midi - key.tonic) % 12) + 12) % 12;
  const degrees = key.mode === 'major' ? MAJOR : MINOR;
  const idx = degrees.indexOf(pc);
  if (idx >= 0) return String(idx + 1);
  const below = degrees.filter((d) => d < pc).length; // degree number just below
  return `♯${below}`;
}

// ---------------------------------------------------------------- tempo

/** Beat estimate from inter-onset intervals. Treats the most common short interval as an eighth note. */
export function estimateTempo(notes: ReadonlyArray<OTTNote>): Tempo {
  const onsets = [...notes].map((n) => n.startTimeSeconds).sort((a, b) => a - b);
  const first = onsets[0] ?? 0;
  const iois: number[] = [];
  for (let i = 1; i < onsets.length; i++) {
    const d = onsets[i] - onsets[i - 1];
    if (d >= 0.09 && d <= 1.5) iois.push(d);
  }
  if (iois.length < 4) return { bpm: 120, offset: first };

  // mode of a 20 ms histogram
  const bins = new Map<number, number>();
  for (const d of iois) {
    const b = Math.round(d / 0.02);
    bins.set(b, (bins.get(b) ?? 0) + 1);
  }
  let modeBin = 0;
  let modeCount = -1;
  for (const [b, c] of bins) if (c > modeCount) [modeBin, modeCount] = [b, c];
  const mode = modeBin * 0.02;
  // refine with the mean of intervals near the mode
  const near = iois.filter((d) => Math.abs(d - mode) < mode * 0.15);
  const unit = near.reduce((s, v) => s + v, 0) / near.length;
  let beat = unit < 0.36 ? unit * 2 : unit; // short unit → eighth note
  while (60 / beat > 200) beat *= 2;
  while (60 / beat < 55) beat /= 2;
  const bpm = Math.round((60 / beat) * 10) / 10;

  // phase: which offset lines the most onsets up with an eighth-note grid
  const grid = beat / 2;
  let bestPhase = first % grid;
  let bestScore = -1;
  for (let phase = 0; phase < grid; phase += 0.005) {
    let score = 0;
    for (const o of onsets) {
      const r = (((o - phase) % grid) + grid) % grid;
      if (Math.min(r, grid - r) < 0.03) score++;
    }
    if (score > bestScore) [bestScore, bestPhase] = [score, phase];
  }
  // express the offset as the first grid point at or before the first note
  const offset = first - ((((first - bestPhase) % beat) + beat) % beat);
  return { bpm, offset: Math.max(0, offset) };
}

export const beatSeconds = (tempo: Tempo) => 60 / tempo.bpm;

/** Snap a time to the nearest grid point. `gridBeats` 1 = quarter, 0.5 = eighth, 0.25 = sixteenth. */
export function snapTime(t: number, tempo: Tempo, gridBeats: number): number {
  const unit = beatSeconds(tempo) * gridBeats;
  return Math.max(0, tempo.offset + Math.round((t - tempo.offset) / unit) * unit);
}

// ----------------------------------------------------------- note values

export type NoteValue = { beats: number; name: string; short: string };

export const NOTE_VALUES: NoteValue[] = [
  { beats: 4, name: 'whole', short: '1' },
  { beats: 3, name: 'dotted half', short: '½·' },
  { beats: 2, name: 'half', short: '½' },
  { beats: 1.5, name: 'dotted quarter', short: '¼·' },
  { beats: 1, name: 'quarter', short: '¼' },
  { beats: 0.75, name: 'dotted eighth', short: '⅛·' },
  { beats: 0.5, name: 'eighth', short: '⅛' },
  { beats: 0.25, name: 'sixteenth', short: '¹⁄₁₆' },
];

export function nearestNoteValue(durationSeconds: number, tempo: Tempo): NoteValue {
  const beats = durationSeconds / beatSeconds(tempo);
  let best = NOTE_VALUES[NOTE_VALUES.length - 1];
  let bestErr = Infinity;
  for (const v of NOTE_VALUES) {
    const err = Math.abs(Math.log(beats / v.beats)); // ratio error, so short notes aren't swamped
    if (err < bestErr) [bestErr, best] = [err, v];
  }
  return best;
}

/** Snap a duration to the nearest fixed note value. */
export const snapDuration = (durationSeconds: number, tempo: Tempo): number => nearestNoteValue(durationSeconds, tempo).beats * beatSeconds(tempo);

/** Snap every note's start to the grid and its length to a note value. */
export function quantize(notes: ReadonlyArray<OTTNote>, tempo: Tempo, gridBeats: number): OTTNote[] {
  return notes.map((n) => ({ ...n, startTimeSeconds: snapTime(n.startTimeSeconds, tempo, gridBeats), durationSeconds: snapDuration(n.durationSeconds, tempo) }));
}

export const withPitch = (n: OTTNote, pitchMidi: number): OTTNote => ({ ...n, pitchMidi, noteName: midiToNoteName(pitchMidi) });
