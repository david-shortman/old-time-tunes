/** Staff geometry: key signatures, note spelling, and where a pitch sits on a treble staff. */
import type { KeyInfo } from './music';

export type Accidental = '' | '#' | 'b' | 'n';
export type Spelled = {
  letter: number;
  octave: number;
  accidental: '' | '#' | 'b';
  step: number;
};

const LETTER_OF_PC_SHARP: Array<[number, '' | '#']> = [
  [0, ''],
  [0, '#'],
  [1, ''],
  [1, '#'],
  [2, ''],
  [3, ''],
  [3, '#'],
  [4, ''],
  [4, '#'],
  [5, ''],
  [5, '#'],
  [6, ''],
];
const LETTER_OF_PC_FLAT: Array<[number, '' | 'b']> = [
  [0, ''],
  [1, 'b'],
  [1, ''],
  [2, 'b'],
  [2, ''],
  [3, ''],
  [4, 'b'],
  [4, ''],
  [5, 'b'],
  [5, ''],
  [6, 'b'],
  [6, ''],
];
/** letters C D E F G A B → semitone of the natural */
const NATURAL_PC = [0, 2, 4, 5, 7, 9, 11];
const SHARP_ORDER = [3, 0, 4, 1, 5, 2, 6]; // F C G D A E B
const FLAT_ORDER = [6, 2, 5, 1, 4, 0, 3]; // B E A D G C F
/** major tonic pitch class → sharps (negative = flats), choosing the common spelling */
const SHARPS_OF_MAJOR: Record<number, number> = {
  0: 0,
  7: 1,
  2: 2,
  9: 3,
  4: 4,
  11: 5,
  6: 6,
  1: -5,
  8: -4,
  3: -3,
  10: -2,
  5: -1,
};

/** Number of sharps (positive) or flats (negative) in the key signature. */
export function keySignatureSharps(key: KeyInfo): number {
  const majorTonic = key.mode === 'major' ? key.tonic : (key.tonic + 3) % 12;
  return SHARPS_OF_MAJOR[majorTonic] ?? 0;
}

/** Letters altered by the key signature, mapped to their accidental. */
export function signatureAccidentals(sharps: number): Map<number, '#' | 'b'> {
  const m = new Map<number, '#' | 'b'>();
  if (sharps > 0) SHARP_ORDER.slice(0, sharps).forEach((l) => m.set(l, '#'));
  if (sharps < 0) FLAT_ORDER.slice(0, -sharps).forEach((l) => m.set(l, 'b'));
  return m;
}

/** Spell a MIDI pitch in the key: letter 0–6 (C–B), octave, accidental, and diatonic step (C4 = 28). */
export function spell(midi: number, sharps: number): Spelled {
  const pc = ((midi % 12) + 12) % 12;
  const octave = Math.floor(midi / 12) - 1;
  const sig = signatureAccidentals(sharps);
  // prefer the key's own spelling for altered letters (e.g. F# in D major, Bb in F major)
  for (const [letter, acc] of sig) {
    const natural = NATURAL_PC[letter];
    if ((natural + (acc === '#' ? 1 : -1) + 12) % 12 === pc) {
      const letterOctave =
        letter === 6 && acc === '#'
          ? octave - 1
          : letter === 0 && acc === 'b'
          ? octave + 1
          : octave;
      return {
        letter,
        octave: letterOctave,
        accidental: acc,
        step: letter + 7 * letterOctave,
      };
    }
  }
  const [letter, accidental] =
    sharps < 0 ? LETTER_OF_PC_FLAT[pc] : LETTER_OF_PC_SHARP[pc];
  const letterOctave = letter === 0 && accidental === 'b' ? octave + 1 : octave;
  return {
    letter,
    octave: letterOctave,
    accidental,
    step: letter + 7 * letterOctave,
  };
}

/** The accidental to draw before a note, given the key signature: nothing when the signature already says so. */
export function displayedAccidental(s: Spelled, sharps: number): Accidental {
  const inSig = signatureAccidentals(sharps).get(s.letter) ?? '';
  if (s.accidental === inSig) return '';
  return s.accidental === '' ? 'n' : s.accidental;
}

/** Diatonic step of the treble staff's bottom line (E4). */
export const TREBLE_BOTTOM_STEP = 2 + 7 * 4; // letters C D E F G A B are 0–6

/** Ledger lines (as step numbers) needed for a note at `step` on a treble staff. */
export function ledgerSteps(step: number): number[] {
  const out: number[] = [];
  const top = TREBLE_BOTTOM_STEP + 8; // F5
  if (step < TREBLE_BOTTOM_STEP)
    for (let s = TREBLE_BOTTOM_STEP - 2; s >= step; s -= 2) out.push(s);
  if (step > top) for (let s = top + 2; s <= step; s += 2) out.push(s);
  return out;
}
