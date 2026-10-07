/** Key detection, tempo estimation, scale rows and note values for the editor grid. */
import type { OTTNote } from '@ot-tunes/notes';
import { midiToNoteName } from './fingering';

export const PC_NAMES = [
  'C',
  'C#',
  'D',
  'D#',
  'E',
  'F',
  'F#',
  'G',
  'G#',
  'A',
  'A#',
  'B',
];

export type Mode = 'major' | 'minor';
export type KeyInfo = { tonic: number; mode: Mode; name: string };
export type Tempo = { bpm: number; offset: number };

const MAJOR = [0, 2, 4, 5, 7, 9, 11];
const MINOR = [0, 2, 3, 5, 7, 8, 10];
// Krumhansl–Schmuckler key profiles
const KS_MAJOR = [
  6.35, 2.23, 3.48, 2.33, 4.38, 4.09, 2.52, 5.19, 2.39, 3.66, 2.29, 2.88,
];
const KS_MINOR = [
  6.33, 2.68, 3.52, 5.38, 2.6, 3.53, 2.54, 4.75, 3.98, 2.69, 3.34, 3.17,
];

export const makeKey = (tonic: number, mode: Mode): KeyInfo => ({
  tonic,
  mode,
  name: `${PC_NAMES[tonic]} ${mode}`,
});

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
  'D major': 0.08,
  'A major': 0.07,
  'G major': 0.07,
  'C major': 0.04,
  'E major': 0.02,
  'F major': 0.02,
  'A# major': 0.02,
  'A minor': 0.04,
  'E minor': 0.04,
  'D minor': 0.04,
  'B minor': 0.02,
  'G minor': 0.02,
};

/**
 * Most likely key of a monophonic tune. Mostly "which scale covers the most playing time",
 * then the evidence a fiddler uses to hear the tonic: phrase endings and long held notes,
 * with a small prior for common fiddle keys. The pitch-class profile only breaks ties.
 */
export function detectKey(notes: ReadonlyArray<OTTNote>): KeyInfo {
  if (!notes.length) return makeKey(2, 'major'); // D major, the fiddler's default
  const pc = (m: number) => ((m % 12) + 12) % 12;
  const sorted = [...notes].sort(
    (a, b) => a.startTimeSeconds - b.startTimeSeconds
  );

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
    const gap = next
      ? next.startTimeSeconds - (n.startTimeSeconds + n.durationSeconds)
      : 1;
    if (gap > 0.2) phraseEnd[pc(n.pitchMidi)] += w;
    if (n.durationSeconds >= longCut) held[pc(n.pitchMidi)] += w;
  }
  const total = hist.reduce((a, b) => a + b, 0) || 1;
  const peTotal = phraseEnd.reduce((a, b) => a + b, 0) || 1;
  const heldTotal = held.reduce((a, b) => a + b, 0) || 1;

  let best = makeKey(2, 'major');
  let bestScore = -Infinity;
  for (let t = 0; t < 12; t++) {
    for (const [mode, degrees, profile] of [
      ['major', MAJOR, KS_MAJOR],
      ['minor', MINOR, KS_MINOR],
    ] as const) {
      const key = makeKey(t, mode);
      const scale = degrees.map((d) => (t + d) % 12);
      const coverage = scale.reduce((s, p) => s + hist[p], 0) / total;
      const tonic =
        0.6 * (phraseEnd[t] / peTotal) + 0.4 * (held[t] / heldTotal);
      const fifth = (t + 7) % 12;
      const tonicOrFifth = 0.3 * (phraseEnd[fifth] / peTotal);
      const rotated = hist.map((_, i) => hist[(i + t) % 12]);
      const score =
        coverage +
        0.3 * tonic +
        0.1 * tonicOrFifth +
        (FIDDLE_KEY_PRIOR[key.name] ?? 0) +
        0.05 * pearson(rotated, profile);
      if (score > bestScore) {
        bestScore = score;
        best = key;
      }
    }
  }
  return best;
}

export const scalePitchClasses = (key: KeyInfo): number[] =>
  (key.mode === 'major' ? MAJOR : MINOR).map((d) => (key.tonic + d) % 12);

export const isInScale = (midi: number, key: KeyInfo): boolean =>
  scalePitchClasses(key).includes(((midi % 12) + 12) % 12);

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

/** How "simple" an inter-onset interval of k grid units (eighths) is: 1, 2, 4 beats-ish are cheap. */
const SIMPLICITY: Record<number, number> = {
  1: 1,
  2: 1,
  3: 0.6,
  4: 0.9,
  6: 0.5,
  8: 0.6,
};
const simplicity = (k: number) => SIMPLICITY[k] ?? (k > 8 ? 0.1 : 0.3);

/**
 * Fit a beat grid to the onsets. Tries beat periods from 40 to 220 BPM, scores each by how well
 * the inter-onset intervals land on whole eighth notes (favouring simple ratios and a human
 * tempo), refines the winner by least squares, then resolves the half/double ambiguity so that
 * the most common interval is a quarter or eighth. Works for plucked instruments where the
 * sounding length says nothing about rhythm: only onsets are used.
 */
export function estimateTempo(notes: ReadonlyArray<OTTNote>): Tempo {
  const onsets = [...notes]
    .map((n) => n.startTimeSeconds)
    .sort((a, b) => a - b);
  const first = onsets[0] ?? 0;
  const iois: number[] = [];
  for (let i = 1; i < onsets.length; i++) {
    const d = onsets[i] - onsets[i - 1];
    if (d >= 0.08 && d <= 2.5) iois.push(d);
  }
  if (iois.length < 3) return { bpm: 100, offset: first };

  let bestUnit = 0.3;
  let bestScore = -Infinity;
  for (let bpm = 40; bpm <= 220; bpm *= 1.01) {
    const unit = 60 / bpm / 2; // eighth note
    let score = 0;
    for (const d of iois) {
      const r = d / unit;
      const k = Math.max(1, Math.round(r));
      const err = Math.abs(r - k); // in units
      score += simplicity(k) * Math.exp(-(err * err) / (2 * 0.12 * 0.12));
    }
    // mild prior for human tempi
    score *= Math.exp(-((Math.log(bpm / 110) / 0.6) ** 2) / 2);
    if (score > bestScore) [bestScore, bestUnit] = [score, unit];
  }

  // refine: least-squares unit over the intervals that fit
  let num = 0;
  let den = 0;
  const ks: number[] = [];
  for (const d of iois) {
    const k = Math.max(1, Math.round(d / bestUnit));
    if (Math.abs(d / bestUnit - k) < 0.25) {
      num += d * k;
      den += k * k;
      ks.push(k);
    }
  }
  let unit = den ? num / den : bestUnit;

  // half/double: make the most common interval a quarter (k=2) or eighth (k=1)
  const counts = new Map<number, number>();
  for (const k of ks) counts.set(k, (counts.get(k) ?? 0) + 1);
  const modal = [...counts.entries()].sort((a, b) => b[1] - a[1])[0]?.[0] ?? 2;
  if (modal >= 4 && modal % 2 === 0) unit *= 2; // intervals were halves at this tempo → slower beat
  let bpm = 60 / (unit * 2);
  while (bpm > 190) bpm /= 2;
  while (bpm < 50) bpm *= 2;
  bpm = Math.round(bpm * 10) / 10;

  // phase: median residual of onsets against an eighth-note grid anchored on the first onset
  const u = 60 / bpm / 2;
  const residuals = onsets
    .map((o) => (((o - first) % u) + u) % u)
    .map((r) => (r > u / 2 ? r - u : r))
    .sort((a, b) => a - b);
  const phase = residuals[Math.floor(residuals.length / 2)] ?? 0;
  const beat = u * 2;
  const offset = first + phase - Math.floor((first + phase) / beat) * beat;
  return { bpm, offset: Math.max(0, offset) };
}

/** Suggest the grid: sixteenths when a good share of the intervals are shorter than an eighth. */
export function suggestGridBeats(
  notes: ReadonlyArray<OTTNote>,
  tempo: Tempo
): 0.5 | 0.25 {
  const onsets = [...notes]
    .map((n) => n.startTimeSeconds)
    .sort((a, b) => a - b);
  const eighth = 30 / tempo.bpm;
  let short = 0;
  let total = 0;
  for (let i = 1; i < onsets.length; i++) {
    const d = onsets[i] - onsets[i - 1];
    if (d < 0.09) continue; // glitches
    total++;
    if (d < 0.75 * eighth) short++;
  }
  return total > 0 && short / total >= 0.15 ? 0.25 : 0.5;
}

/**
 * Make the rhythm regular: snap every onset to the grid and give each note the width of the gap
 * to the next onset, in grid units, so a tune of quarter notes shows as even quarter-note blocks.
 * A gap longer than two beats is treated as a rest: the note keeps its own (quantised) length.
 */
export function normalizeRhythm(
  notes: ReadonlyArray<OTTNote>,
  tempo: Tempo,
  gridBeats: number
): OTTNote[] {
  const unit = (60 / tempo.bpm) * gridBeats;
  const beat = 60 / tempo.bpm;
  const sorted = [...notes].sort(
    (a, b) =>
      a.startTimeSeconds - b.startTimeSeconds || a.pitchMidi - b.pitchMidi
  );
  const snapStart = (t: number) =>
    Math.max(0, tempo.offset + Math.round((t - tempo.offset) / unit) * unit);

  // Two onsets within a few model frames of each other are one note with a pitch glitch (a
  // plucked attack often reads as a wrong pitch for ~30–70 ms): keep the longer one. The window
  // is capped so fast sixteenth-note runs (≈110 ms at 134 BPM) are never merged.
  const GLITCH_WINDOW = Math.min(unit / 2, 0.09);
  const kept: OTTNote[] = [];
  for (const n of sorted) {
    const prev = kept[kept.length - 1];
    if (prev && n.startTimeSeconds - prev.startTimeSeconds < GLITCH_WINDOW) {
      if (n.durationSeconds > prev.durationSeconds) kept[kept.length - 1] = n;
      continue;
    }
    kept.push(n);
  }

  const starts: number[] = [];
  for (const n of kept) {
    let st = snapStart(n.startTimeSeconds);
    const prev = starts[starts.length - 1];
    if (prev !== undefined && st <= prev + 1e-6) st = prev + unit; // keep order; no two notes on one slot
    starts.push(st);
  }
  return kept.map((n, i) => {
    const start = starts[i];
    const next = starts[i + 1];
    const own = Math.max(unit, Math.round(n.durationSeconds / unit) * unit);
    let duration: number;
    if (next === undefined) duration = own;
    else {
      const gap = next - start;
      duration = gap <= 2 * beat + 1e-6 ? gap : Math.min(gap, own);
    }
    return {
      ...n,
      startTimeSeconds: start,
      durationSeconds: Math.max(unit, duration),
    };
  });
}

export const beatSeconds = (tempo: Tempo) => 60 / tempo.bpm;

/** Snap a time to the nearest grid point. `gridBeats` 1 = quarter, 0.5 = eighth, 0.25 = sixteenth. */
export function snapTime(t: number, tempo: Tempo, gridBeats: number): number {
  const unit = beatSeconds(tempo) * gridBeats;
  return Math.max(
    0,
    tempo.offset + Math.round((t - tempo.offset) / unit) * unit
  );
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

export function nearestNoteValue(
  durationSeconds: number,
  tempo: Tempo
): NoteValue {
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
export const snapDuration = (durationSeconds: number, tempo: Tempo): number =>
  nearestNoteValue(durationSeconds, tempo).beats * beatSeconds(tempo);

/** Snap every note's start to the grid and its length to a note value. */
export function quantize(
  notes: ReadonlyArray<OTTNote>,
  tempo: Tempo,
  gridBeats: number
): OTTNote[] {
  return notes.map((n) => ({
    ...n,
    startTimeSeconds: snapTime(n.startTimeSeconds, tempo, gridBeats),
    durationSeconds: snapDuration(n.durationSeconds, tempo),
  }));
}

export const withPitch = (n: OTTNote, pitchMidi: number): OTTNote => ({
  ...n,
  pitchMidi,
  noteName: midiToNoteName(pitchMidi),
});
